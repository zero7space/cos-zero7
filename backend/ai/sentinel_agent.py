"""
Zero7 CRM — 24/7 Autonomous Pipeline Sentinel & Accountability Nagger Agent
Slug: pipeline_sentinel

Continuously audits all CRM leads, deals, call logs, notes, and WhatsApp messages.
Detects pipeline aberrations (unmade calls, dormant proposals, uncontacted leads, missed deadlines)
and relentlessly nags the team on the Zero7 WhatsApp group with sharp, proactive questions.

SECURITY GUARANTEE:
Restricted strictly to the Zero7 WhatsApp group (JID: 120363426285521103@g.us).
Cannot send messages to any external prospect or outside phone number.
"""

import os
import sys
import json
import time
import logging
import re
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, List, Optional

from backend.database import Repository
from backend.ai.client import chat_completion

logger = logging.getLogger("zero7_sentinel")

ZERO7_GROUP_JID = "120363426285521103@g.us"
ZERO7_GROUP_NAME = "Zero7"
# Backward-compatibility aliases
ZDRO7_GROUP_JID = ZERO7_GROUP_JID
ZDRO7_GROUP_NAME = ZERO7_GROUP_NAME
WA_DAEMON_URL = os.getenv("WA_DAEMON_URL", "http://172.17.0.1:8085")
DEFAULT_COOLDOWN_HOURS = float(os.getenv("SENTINEL_COOLDOWN_HOURS", "168.0"))  # 7 days per lead cooldown
CYCLE_INTERVAL_SECONDS = int(os.getenv("SENTINEL_CYCLE_SECONDS", "3600"))  # 60 minutes default

COMMITMENT_REGEX_PATTERNS = [
    (r"(?:profile|portfolio)\s+(?:send|bhej|share|de|do|bhejna)", "send_profile", "Send profile/portfolio"),
    (r"(?:proposal|quote|quotation|pricing|estimate)\s+(?:send|bhej|share|de|do|bhejna)", "send_proposal", "Send proposal/pricing"),
    (r"(?:send|bhej|share)\s+(?:profile|portfolio|proposal|quote|deck|brochure)", "send_proposal", "Send proposal/profile"),
    (r"(?:call\s+(?:kar|karo|karna|lo|do)|phone\s+(?:kar|karo|karna|lo|do)|will\s+call|call\s+him|dial)", "make_call", "Call prospect"),
    (r"(?:demo|meeting)\s+(?:set|schedule|arrange|fix|dena|karo)", "schedule_demo", "Schedule demo/meeting"),
    (r"(?:visit\s+(?:karo|karna|karein|plan)|aana\s+hai|visit\s+kare)", "visit_client", "Visit client in person"),
    (r"(?:follow\s*up|update\s+le|update\s+lo|pucho|status\s+lo)", "follow_up", "Take follow-up update"),
    (r"(?:sample|samples|deck|presentation)\s+(?:bhej|send|share)", "share_collateral", "Share presentation/samples"),
]


class AberrationType:
    UNCONTACTED_LEAD = "uncontacted_lead"
    PROPOSAL_WITHOUT_UPDATE = "proposal_without_update"
    CALL_CONNECTED_NO_NEXT_ACTION = "call_connected_no_next_action"
    DNP_ABANDONED = "dnp_abandoned"
    HOT_LEAD_NEGLECTED = "hot_lead_neglected"
    OVERDUE_DEADLINE = "overdue_deadline"
    STALLED_QUALIFIED = "stalled_qualified"
    BROKEN_GROUP_COMMITMENT = "broken_group_commitment"
    UNANSWERED_PROSPECT_QUERY = "unanswered_prospect_query"


class SentinelAgent:
    """
    Autonomous Pipeline Sentinel & Accountability Agent.
    Audits the entire CRM database and proactively reminds the team in the ZDRO7 WhatsApp group.
    """

    def __init__(self, daemon_url: Optional[str] = None):
        self.daemon_url = (daemon_url or WA_DAEMON_URL).rstrip("/")
        self.last_run_time: Optional[datetime] = None
        self.last_audit_summary: Dict[str, Any] = {}

    def _parse_iso(self, ts_str: Optional[str]) -> Optional[datetime]:
        """Safely parses ISO timestamp strings to timezone-aware UTC datetime."""
        if not ts_str:
            return None
        clean = ts_str.strip()
        # Handle formats like 2026-10-04T10:32:30Z or 2026-10-04 10:32:30
        try:
            if clean.endswith("Z"):
                clean = clean[:-1] + "+00:00"
            dt = datetime.fromisoformat(clean)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt
        except Exception:
            try:
                # Fallback for sqlite 'YYYY-MM-DD HH:MM:SS'
                dt = datetime.strptime(clean[:19], "%Y-%m-%d %H:%M:%S")
                return dt.replace(tzinfo=timezone.utc)
            except Exception:
                return None

    def _extract_commitments(self, text: str, sender: str = "Team", timestamp: Optional[str] = None) -> List[Dict[str, Any]]:
        """Extracts actionable team commitments from message or note text."""
        if not text:
            return []
        commitments = []
        clean = text.strip()
        for pattern, action_type, label in COMMITMENT_REGEX_PATTERNS:
            if re.search(pattern, clean, re.IGNORECASE):
                commitments.append({
                    "text": clean,
                    "action_type": action_type,
                    "label": label,
                    "sender": sender,
                    "timestamp": timestamp or datetime.now(timezone.utc).isoformat(),
                    "status": "pending"
                })
                break  # one primary commitment per line/message
        return commitments

    def record_group_mention(
        self,
        lead_id: str,
        text: str,
        sender_name: str,
        timestamp: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Records a team message mentioning or discussing a lead in the Zero7 group.
        Detects commitments made (e.g. 'profile send kar de', 'call karo') and stores
        them in sentinel_lead_context for autonomous memory tracking.
        """
        if not lead_id:
            return {}

        now_iso = datetime.now(timezone.utc).isoformat()
        ts = timestamp or now_iso
        existing = Repository.get_sentinel_lead_context(lead_id) or {}
        lead = Repository.get_lead(lead_id) or {}

        lead_name = lead.get("name") or existing.get("lead_name") or "Lead"
        biz_name = lead.get("business_name") or existing.get("business_name") or lead_name

        detected_commitments = self._extract_commitments(text, sender=sender_name, timestamp=ts)
        commitments = existing.get("commitments_made") or []
        if not isinstance(commitments, list):
            commitments = []

        for dc in detected_commitments:
            if not any(c.get("text", "").strip().lower() == dc["text"].strip().lower() and c.get("sender") == dc["sender"] for c in commitments):
                commitments.append(dc)

        clean_text = text.strip()
        new_entry = f"• [{ts[:16].replace('T', ' ')}] {sender_name}: \"{clean_text}\""
        existing_summary = existing.get("group_mentions_summary") or ""
        lines = [line.strip() for line in existing_summary.split("\n") if line.strip()]
        if new_entry not in lines:
            lines.append(new_entry)
        mentions_summary = "\n".join(lines[-25:])

        context_data = {
            "lead_name": lead_name,
            "business_name": biz_name,
            "synthesized_context": existing.get("synthesized_context") or f"Active discussions in Zero7 group regarding {lead_name}.",
            "group_mentions_summary": mentions_summary,
            "call_insights_summary": existing.get("call_insights_summary") or "",
            "commitments_made": commitments,
            "unresolved_questions": existing.get("unresolved_questions") or []
        }

        updated = Repository.save_sentinel_lead_context(lead_id, context_data)
        return updated or context_data

    def synthesize_lead_context(self, lead_id: str) -> Dict[str, Any]:
        """
        Synthesizes a 360-degree autonomous memory dossier for a lead by aggregating:
        1. Zero7 team group chatter and commitments
        2. CRM notes (including WhatsApp audio logs and group discussions)
        3. Call logs & Deepgram/Whisper speech-to-text transcripts
        4. 1-on-1 prospect WhatsApp conversations
        5. Deals, proposals, and pipeline status
        """
        now = datetime.now(timezone.utc)
        lead = Repository.get_lead(lead_id)
        if not lead:
            return {}

        name = lead.get("name") or "Lead"
        biz = lead.get("business_name") or name
        status = (lead.get("status") or "new").lower()
        call_stage = (lead.get("call_stage") or "uncontacted").lower()
        temp = (lead.get("temperature") or "warm").lower()
        deal_val = float(lead.get("deal_value") or 0.0)
        next_act = lead.get("next_action") or ""
        next_act_date = lead.get("next_action_date") or ""

        # 1. Gather Zero7 Group Messages & Group Notes
        group_msgs = Repository.list_zero7_group_messages(limit=50, linked_lead_id=lead_id)
        if name and len(name) >= 3:
            unlinked = Repository._execute("""
                SELECT * FROM zero7_group_messages
                WHERE (message_text LIKE ? OR matched_lead_name LIKE ?) AND (linked_lead_id IS NULL OR linked_lead_id = '')
                ORDER BY timestamp DESC LIMIT 20
            """, (f"%{name}%", f"%{name}%"), fetchall=True) or []
            existing_mids = {m.get("wa_message_id") for m in group_msgs}
            for u in unlinked:
                if u.get("wa_message_id") not in existing_mids:
                    group_msgs.append(dict(u))

        lead_notes = Repository._execute(
            "SELECT * FROM notes WHERE lead_id = ? ORDER BY created_at DESC", (lead_id,), fetchall=True
        ) or []

        mention_lines = []
        all_commitments: List[Dict[str, Any]] = []

        # Parse group messages
        for gm in sorted(group_msgs, key=lambda x: str(x.get("timestamp", ""))):
            ts = gm.get("timestamp") or ""
            sender = gm.get("sender_name") or "Team"
            txt = (gm.get("message_text") or "").strip()
            if txt:
                mention_lines.append(f"• [{ts[:16].replace('T', ' ')}] {sender}: \"{txt}\"")
                comms = self._extract_commitments(txt, sender=sender, timestamp=ts)
                all_commitments.extend(comms)

        # Parse notes for Zero7 chatter and commitments
        for n in lead_notes:
            content = (n.get("content") or "").strip()
            ts = n.get("created_at") or ""
            if "Zero7 Group" in content or "ZDRO7" in content:
                for line in content.split("\n"):
                    l_str = line.strip()
                    if l_str and not l_str.startswith("[WhatsApp"):
                        mention_lines.append(f"• [{ts[:16].replace('T', ' ')}] Group: \"{l_str}\"")
                        comms = self._extract_commitments(l_str, sender="Team", timestamp=ts)
                        all_commitments.extend(comms)
            else:
                comms = self._extract_commitments(content, sender="CRM Note", timestamp=ts)
                all_commitments.extend(comms)

        # 2. Gather Call Logs & Transcripts
        call_logs = Repository._execute(
            "SELECT * FROM call_logs WHERE lead_id = ? ORDER BY called_at DESC", (lead_id,), fetchall=True
        ) or []

        call_summary_parts = []
        latest_transcript_snippet = ""
        has_transcripts = False

        if call_logs:
            call_count = len(call_logs)
            latest_call = call_logs[0]
            outcome = latest_call.get("outcome") or "Unknown"
            c_date = latest_call.get("called_at") or ""
            dur = latest_call.get("duration_minutes") or 0
            c_notes = (latest_call.get("notes") or "").strip()
            c_trans = (latest_call.get("transcription_text") or "").strip()

            call_summary_parts.append(f"{call_count} call(s) logged. Latest: {outcome} on {c_date[:10]} ({dur} min).")
            if c_trans:
                has_transcripts = True
                latest_transcript_snippet = c_trans[:250].replace("\n", " ")
                call_summary_parts.append(f"Transcript highlight: \"{latest_transcript_snippet}...\"")
            elif c_notes:
                call_summary_parts.append(f"Call note: \"{c_notes[:180]}\"")
        else:
            call_summary_parts.append("Zero calls logged in CRM.")

        call_insights_summary = " ".join(call_summary_parts)

        # 3. Gather Deals and Prospect WhatsApp Messages (Across Central 9479007951 & Personal 9993202900)
        deals = Repository.list_deals(filters={"lead_id": lead_id}) or []
        wa_messages = Repository.get_whatsapp_messages(lead_id) or []

        has_proposal = (status == "proposal") or any(
            (d.get("stage") or "").lower() in ("proposal", "negotiation", "won") or bool(d.get("proposal_url"))
            for d in deals
        )

        # Detect if lead has an unanswered incoming WhatsApp query (especially on Central WhatsApp)
        unanswered_incoming_wa = None
        if wa_messages:
            # Sorted chronologically ascending by Repository.get_whatsapp_messages
            last_wa = wa_messages[-1]
            last_dir = (last_wa.get("direction") or "").lower()
            if last_dir in ("incoming", "in"):
                last_wa_dt = self._parse_iso(last_wa.get("timestamp"))
                unanswered_wa_hrs = (now - last_wa_dt).total_seconds() / 3600.0 if last_wa_dt else 24.0
                if unanswered_wa_hrs >= 2.0:
                    acc_phone = last_wa.get("account_phone") or ""
                    acc_label = "Central WhatsApp (Zero7 Consultancy: 9479007951)" if "9479007951" in acc_phone else "WhatsApp"
                    unanswered_incoming_wa = {
                        "hours": round(unanswered_wa_hrs, 1),
                        "snippet": (last_wa.get("message_text") or "").strip()[:100],
                        "account": acc_label
                    }

        # 4. Evaluate Commitments Fulfillment
        evaluated_commitments = []
        seen_texts = set()

        existing_ctx = Repository.get_sentinel_lead_context(lead_id) or {}
        existing_comms = existing_ctx.get("commitments_made") or []
        if isinstance(existing_comms, list):
            all_commitments.extend(existing_comms)

        for comm in all_commitments:
            c_text = comm.get("text", "").strip()
            if not c_text or c_text in seen_texts:
                continue
            seen_texts.add(c_text)

            c_type = comm.get("action_type")
            c_ts = self._parse_iso(comm.get("timestamp"))
            age_hrs = (now - c_ts).total_seconds() / 3600.0 if c_ts else 24.0

            fulfilled = False
            if c_type in ("send_proposal", "send_profile", "share_collateral"):
                if has_proposal:
                    fulfilled = True
                else:
                    for wm in wa_messages:
                        wm_txt = (wm.get("message_text") or "").lower()
                        wm_dir = (wm.get("direction") or "").lower()
                        if wm_dir in ("outgoing", "out", "outbound") and ("proposal" in wm_txt or "profile" in wm_txt or "http" in wm_txt):
                            wm_dt = self._parse_iso(wm.get("timestamp"))
                            if not c_ts or (wm_dt and wm_dt >= c_ts):
                                fulfilled = True
                                break
            elif c_type == "make_call":
                if call_logs:
                    for cl in call_logs:
                        cl_dt = self._parse_iso(cl.get("called_at"))
                        if not c_ts or (cl_dt and cl_dt >= c_ts):
                            fulfilled = True
                            break
            elif c_type in ("schedule_demo", "visit_client", "follow_up"):
                if next_act and ("demo" in next_act.lower() or "visit" in next_act.lower() or "meeting" in next_act.lower()):
                    fulfilled = True
                elif call_logs:
                    for cl in call_logs:
                        cl_dt = self._parse_iso(cl.get("called_at"))
                        if not c_ts or (cl_dt and cl_dt >= c_ts):
                            fulfilled = True
                            break

            if fulfilled:
                comm_status = "fulfilled"
            elif age_hrs >= 12.0:
                comm_status = "broken"
            else:
                comm_status = "pending"

            evaluated_commitments.append({
                "text": c_text,
                "action_type": c_type,
                "label": comm.get("label") or "Team commitment",
                "sender": comm.get("sender") or "Team",
                "timestamp": comm.get("timestamp") or (c_ts.isoformat() if c_ts else now.isoformat()),
                "status": comm_status,
                "age_hours": round(age_hrs, 1)
            })

        # 5. Formulate Unresolved Questions
        unresolved_questions = []
        for ec in evaluated_commitments:
            if ec["status"] == "broken":
                sender = ec["sender"]
                unresolved_questions.append(
                    f"Why has the commitment by {sender} to '{ec['text']}' not been fulfilled in CRM after {ec['age_hours']}h?"
                )

        if unanswered_incoming_wa:
            unresolved_questions.append(
                f"Prospect sent an incoming message {unanswered_incoming_wa['hours']}h ago on {unanswered_incoming_wa['account']}: \"{unanswered_incoming_wa['snippet']}\" — why has NO ONE replied?"
            )

        if has_proposal and not wa_messages:
            unresolved_questions.append(f"Proposal is out for {name} ({biz}), but no WhatsApp follow-up or client reaction is recorded.")
        elif call_stage == "connected" and not next_act:
            unresolved_questions.append(f"Call was connected with {name} ({biz}), but what was agreed as the next step?")

        # 6. Formulate Synthesized Context Narrative
        recent_mentions_str = "\n".join(mention_lines[-15:]) if mention_lines else "No group discussions recorded yet."
        broken_count = sum(1 for ec in evaluated_commitments if ec["status"] == "broken")

        wa_summary_str = f"WhatsApp: {len(wa_messages)} msg(s) on file."
        if unanswered_incoming_wa:
            wa_summary_str += f" ⚠️ UNANSWERED INQUIRY ({unanswered_incoming_wa['hours']}h ago on {unanswered_incoming_wa['account']})!"

        context_narrative = (
            f"Lead '{name}' ({biz}): Status is '{status}', call stage '{call_stage}', temperature '{temp}'. "
            f"Value: ₹{deal_val:,.0f} if deal_val else 'TBD'. "
            f"Calls: {call_insights_summary} "
            f"{wa_summary_str} "
            f"Team commitments: {len(evaluated_commitments)} tracked ({broken_count} broken/overdue). "
            f"Next action: '{next_act}' (Due: '{next_act_date}')."
        )

        context_data = {
            "lead_name": name,
            "business_name": biz,
            "synthesized_context": context_narrative,
            "group_mentions_summary": recent_mentions_str,
            "call_insights_summary": call_insights_summary,
            "commitments_made": evaluated_commitments,
            "unresolved_questions": unresolved_questions,
            "has_transcripts": has_transcripts,
            "transcript_excerpt": latest_transcript_snippet
        }

        saved = Repository.save_sentinel_lead_context(lead_id, context_data)
        return saved or context_data

    def audit_all_leads(self) -> List[Dict[str, Any]]:
        """
        Performs a full 360-degree audit across all leads in the CRM.
        Returns a list of detected aberrations with severity, stalled duration, and context.
        """
        now = datetime.now(timezone.utc)
        # Ensure any unlinked WhatsApp messages matching lead phones are linked
        try:
            Repository.auto_link_whatsapp_messages()
        except Exception as e:
            logger.debug(f"[SENTINEL] Auto-link WhatsApp warning: {e}")

        leads = Repository._execute("SELECT * FROM leads ORDER BY created_at DESC", fetchall=True) or []
        aberrations: List[Dict[str, Any]] = []

        # Batch load related entities for fast in-memory cross-referencing
        call_logs = Repository._execute("SELECT * FROM call_logs ORDER BY called_at DESC", fetchall=True) or []
        deals = Repository._execute("SELECT * FROM deals ORDER BY updated_at DESC", fetchall=True) or []
        notes = Repository._execute("SELECT * FROM notes ORDER BY created_at DESC", fetchall=True) or []
        wa_messages = Repository._execute("""
            SELECT id, lead_id, lead_phone, account_phone, direction, message_text, timestamp 
            FROM whatsapp_messages 
            ORDER BY timestamp DESC
        """, fetchall=True) or []
        lead_contexts_raw = Repository._execute("SELECT * FROM sentinel_lead_context", fetchall=True) or []
        contexts_by_lead: Dict[str, Dict] = {c["lead_id"]: dict(c) for c in lead_contexts_raw if c.get("lead_id")}

        # Index by lead_id
        calls_by_lead: Dict[str, List[Dict]] = {}
        for c in call_logs:
            lid = c.get("lead_id")
            if lid:
                calls_by_lead.setdefault(lid, []).append(c)

        deals_by_lead: Dict[str, List[Dict]] = {}
        for d in deals:
            lid = d.get("lead_id")
            if lid:
                deals_by_lead.setdefault(lid, []).append(d)

        notes_by_lead: Dict[str, List[Dict]] = {}
        for n in notes:
            lid = n.get("lead_id")
            if lid:
                notes_by_lead.setdefault(lid, []).append(n)

        # Index WhatsApp messages across both lead_id AND normalized phone (Central 9479007951 & Personal)
        wa_by_lead: Dict[str, List[Dict]] = {}
        wa_by_phone: Dict[str, List[Dict]] = {}
        for m in wa_messages:
            lid_val = m.get("lead_id")
            if lid_val:
                wa_by_lead.setdefault(lid_val, []).append(m)
            lphone = Repository.normalize_phone(m.get("lead_phone"))
            if lphone:
                wa_by_phone.setdefault(lphone, []).append(m)

        for raw_lead in leads:
            lead = Repository._format_lead(raw_lead)
            lid = lead.get("id")
            name = lead.get("name") or "Unknown Lead"
            biz = lead.get("business_name") or name
            call_stage = (lead.get("call_stage") or "uncontacted").lower()
            status = (lead.get("status") or "new").lower()
            temp = (lead.get("temperature") or "warm").lower()
            priority = (lead.get("priority") or "unexplored").lower()
            deal_val = float(lead.get("deal_value") or 0.0)
            next_act = lead.get("next_action") or ""
            next_act_date = lead.get("next_action_date") or ""

            lead_calls = calls_by_lead.get(lid, [])
            lead_deals = deals_by_lead.get(lid, [])
            lead_notes = notes_by_lead.get(lid, [])
            
            # Combine messages matched by lead_id and by phone
            lead_phone_10 = Repository.normalize_phone(lead.get("phone") or "")
            lead_wa = list(wa_by_lead.get(lid, []))
            if lead_phone_10 and lead_phone_10 in wa_by_phone:
                existing_wa_ids = {wm.get("id") for wm in lead_wa if wm.get("id")}
                for pwm in wa_by_phone[lead_phone_10]:
                    if pwm.get("id") not in existing_wa_ids:
                        lead_wa.append(pwm)
                lead_wa.sort(key=lambda x: str(x.get("timestamp") or ""), reverse=True)

            created_dt = self._parse_iso(lead.get("created_at"))
            updated_dt = self._parse_iso(lead.get("updated_at"))

            # Calculate time since creation
            age_hours = (now - created_dt).total_seconds() / 3600.0 if created_dt else 999.0

            # Latest activity timestamp across calls, notes, messages
            latest_touch_dt = created_dt
            if lead_calls:
                c_dt = self._parse_iso(lead_calls[0].get("called_at"))
                if c_dt and (not latest_touch_dt or c_dt > latest_touch_dt):
                    latest_touch_dt = c_dt
            if lead_notes:
                n_dt = self._parse_iso(lead_notes[0].get("created_at"))
                if n_dt and (not latest_touch_dt or n_dt > latest_touch_dt):
                    latest_touch_dt = n_dt
            if lead_wa:
                w_dt = self._parse_iso(lead_wa[0].get("timestamp"))
                if w_dt and (not latest_touch_dt or w_dt > latest_touch_dt):
                    latest_touch_dt = w_dt

            idle_hours = (now - latest_touch_dt).total_seconds() / 3600.0 if latest_touch_dt else age_hours
            idle_days = round(idle_hours / 24.0, 1)

            # -------------------------------------------------------------
            # Rule 1: UNCONTACTED_LEAD
            # Fresh lead ingested within 48 hours, no calls made, no WhatsApp messages sent
            # -------------------------------------------------------------
            if call_stage in ("uncontacted", "first_call") and len(lead_calls) == 0 and len(lead_wa) == 0:
                if 1.0 <= age_hours <= 48.0:  # Fresh leads ingested within last 48 hours (not stale backlog)
                    sev = "critical" if (priority == "high" or temp == "hot" or age_hours > 24) else "high"
                    aberrations.append({
                        "lead_id": lid,
                        "lead_name": name,
                        "business_name": biz,
                        "aberration_type": AberrationType.UNCONTACTED_LEAD,
                        "severity": sev,
                        "idle_hours": round(age_hours, 1),
                        "deal_value": deal_val,
                        "description": f"Lead '{name}' ({biz}) was ingested {round(age_hours, 1)}h ago with ZERO calls or WhatsApp messages logged.",
                        "lead_summary": {
                            "status": status,
                            "call_stage": call_stage,
                            "temperature": temp,
                            "priority": priority,
                            "source": lead.get("source")
                        }
                    })

            # -------------------------------------------------------------
            # Rule 2: PROPOSAL_WITHOUT_UPDATE
            # Deal in 'proposal' or status 'proposal', or proposal link exists, but no update in > 24 hours (within 5 days)
            # -------------------------------------------------------------
            has_proposal = (status == "proposal") or any(
                (d.get("stage") or "").lower() in ("proposal", "negotiation") or bool(d.get("proposal_url"))
                for d in lead_deals
            )
            if has_proposal:
                if 24.0 <= idle_hours <= 120.0:  # Active proposal within last 5 days
                    sev = "critical" if (deal_val >= 25000 or temp == "hot" or idle_hours > 72) else "high"
                    grp_snip = ""
                    for n in lead_notes:
                        cnt = n.get("content") or ""
                        if "Zero7 Group" in cnt or "ZDRO7" in cnt:
                            lines = [l.strip() for l in cnt.split("\n") if l.strip() and not l.startswith("[WhatsApp")]
                            if lines:
                                grp_snip = lines[0][:120]
                                break
                    aberrations.append({
                        "lead_id": lid,
                        "lead_name": name,
                        "business_name": biz,
                        "aberration_type": AberrationType.PROPOSAL_WITHOUT_UPDATE,
                        "severity": sev,
                        "idle_hours": round(idle_hours, 1),
                        "deal_value": deal_val,
                        "description": f"Proposal out for '{name}' ({biz}, value: ₹{deal_val:,.0f} if deal_val else 'TBD'), but no update logged for {idle_days} days.",
                        "lead_summary": {
                            "status": status,
                            "temperature": temp,
                            "deal_value": deal_val,
                            "last_notes": lead.get("last_update_notes"),
                            "group_mention": grp_snip
                        }
                    })

            # -------------------------------------------------------------
            # Rule 3: CALL_CONNECTED_NO_NEXT_ACTION
            # Call outcome was Connected, but no next action or deadline defined (within 48 hours)
            # -------------------------------------------------------------
            latest_call = lead_calls[0] if lead_calls else None
            call_outcome = (latest_call.get("outcome") or "").lower() if latest_call else ""
            if (call_outcome == "connected" or call_stage == "connected"):
                if not next_act or next_act.lower() in ("review account and plan outreach", "speed to lead call (< 5 mins)"):
                    if not next_act_date or next_act_date.lower() in ("tomorrow", "today, 2 pm"):
                        # If call happened between 2 and 48 hours ago and still no custom task or deal progress
                        c_dt = self._parse_iso(latest_call.get("called_at")) if latest_call else None
                        c_age_hrs = (now - c_dt).total_seconds() / 3600.0 if c_dt else idle_hours
                        if 2.0 <= c_age_hrs <= 48.0:
                            trans_text = (latest_call.get("transcription_text") or "").strip() if latest_call else ""
                            aberrations.append({
                                "lead_id": lid,
                                "lead_name": name,
                                "business_name": biz,
                                "aberration_type": AberrationType.CALL_CONNECTED_NO_NEXT_ACTION,
                                "severity": "high",
                                "idle_hours": round(c_age_hrs, 1),
                                "deal_value": deal_val,
                                "description": f"Discovery call with '{name}' ({biz}) was connected {round(c_age_hrs, 1)}h ago, but no next action or follow-up deadline is scheduled.",
                                "lead_summary": {
                                    "call_notes": latest_call.get("notes") if latest_call else "",
                                    "transcript_excerpt": trans_text[:150] if trans_text else "",
                                    "temperature": temp
                                }
                            })

            # -------------------------------------------------------------
            # Rule 4: DNP_ABANDONED
            # Lead marked DNP / Did Not Pick between 24 and 72 hours ago, no retry or WhatsApp follow-up
            # -------------------------------------------------------------
            if (call_stage == "dnp" or call_outcome in ("did not pick", "dnp")):
                if 24.0 <= idle_hours <= 72.0:  # Within last 1 to 3 days
                    aberrations.append({
                        "lead_id": lid,
                        "lead_name": name,
                        "business_name": biz,
                        "aberration_type": AberrationType.DNP_ABANDONED,
                        "severity": "medium",
                        "idle_hours": round(idle_hours, 1),
                        "deal_value": deal_val,
                        "description": f"'{name}' ({biz}) was marked DNP {idle_days} days ago with no subsequent call or WhatsApp follow-up attempt.",
                        "lead_summary": {
                            "call_stage": call_stage,
                            "temperature": temp
                        }
                    })

            # -------------------------------------------------------------
            # Rule 5: HOT_LEAD_NEGLECTED
            # Must have prior engagement (calls, WA, or moved past new/uncontacted stage)
            # and been neglected for 24-120 hours (1 to 5 days). Never flag untouched backlog leads!
            # -------------------------------------------------------------
            has_prior_engagement = (
                len(lead_calls) > 0 or
                len(lead_wa) > 0 or
                status in ("contacted", "qualified", "proposal", "negotiation")
            )
            if has_prior_engagement and (temp == "hot" or deal_val >= 25000 or priority == "high"):
                if 24.0 <= idle_hours <= 120.0 and status not in ("won", "lost"):
                    # Check if already caught by proposal rule
                    if not any(a["lead_id"] == lid and a["aberration_type"] == AberrationType.PROPOSAL_WITHOUT_UPDATE for a in aberrations):
                        aberrations.append({
                            "lead_id": lid,
                            "lead_name": name,
                            "business_name": biz,
                            "aberration_type": AberrationType.HOT_LEAD_NEGLECTED,
                            "severity": "critical",
                            "idle_hours": round(idle_hours, 1),
                            "deal_value": deal_val,
                            "description": f"Hot/High-Value lead '{name}' ({biz}, ₹{deal_val:,.0f} if deal_val else 'Priority') has had zero touchpoints for {idle_days} days.",
                            "lead_summary": {
                                "status": status,
                                "call_stage": call_stage,
                                "temperature": temp,
                                "deal_value": deal_val
                            }
                        })

            # -------------------------------------------------------------
            # Rule 6: OVERDUE_DEADLINE
            # next_action_date is set and overdue within last 72 hours
            # -------------------------------------------------------------
            if next_act and next_act_date:
                is_overdue = False
                target_dt = self._parse_iso(next_act_date)
                if target_dt:
                    od_hrs = (now - target_dt).total_seconds() / 3600.0
                    if 0.0 < od_hrs <= 72.0:  # Overdue recently (within 3 days)
                        is_overdue = True
                else:
                    nad_lower = next_act_date.lower()
                    if ("yesterday" in nad_lower or "days ago" in nad_lower) and idle_hours <= 72.0:
                        is_overdue = True
                if is_overdue:
                    aberrations.append({
                        "lead_id": lid,
                        "lead_name": name,
                        "business_name": biz,
                        "aberration_type": AberrationType.OVERDUE_DEADLINE,
                        "severity": "high",
                        "idle_hours": round(idle_hours, 1),
                        "deal_value": deal_val,
                        "description": f"Action '{next_act}' for '{name}' ({biz}) was due on '{next_act_date}' and is overdue.",
                        "lead_summary": {
                            "next_action": next_act,
                            "next_action_date": next_act_date
                        }
                    })

            # -------------------------------------------------------------
            # Rule 7: BROKEN_GROUP_COMMITMENT
            # Team made a commitment in Zero7 group (e.g. 'profile send kar de')
            # but it was never fulfilled in CRM (> 6 hours, within 72 hours)
            # -------------------------------------------------------------
            ctx = contexts_by_lead.get(lid)
            unfulfilled_commitments = []
            if ctx:
                comms = ctx.get("commitments_made")
                if isinstance(comms, str):
                    try:
                        comms = json.loads(comms)
                    except Exception:
                        comms = []
                if isinstance(comms, list):
                    for c in comms:
                        c_ts = self._parse_iso(c.get("timestamp"))
                        c_age = (now - c_ts).total_seconds() / 3600.0 if c_ts else idle_hours
                        c["age_hours"] = round(c_age, 1)
                        # Check if fulfilled in CRM
                        c_type = c.get("action_type")
                        fulfilled = False
                        if c_type in ("send_proposal", "send_profile", "share_collateral") and has_proposal:
                            fulfilled = True
                        elif c_type == "make_call" and len(lead_calls) > 0:
                            for cl in lead_calls:
                                cl_dt = self._parse_iso(cl.get("called_at"))
                                if not c_ts or (cl_dt and cl_dt >= c_ts):
                                    fulfilled = True
                                    break
                        if not fulfilled:
                            if c.get("status") == "broken" or c_age >= 12.0:
                                c["status"] = "broken" if c_age >= 12.0 else "pending"
                                unfulfilled_commitments.append(c)

            # If not yet in sentinel_lead_context, scan group notes on the fly
            if not unfulfilled_commitments and lead_notes:
                for n in lead_notes:
                    cnt = n.get("content") or ""
                    if "Zero7 Group" in cnt or "ZDRO7" in cnt:
                        n_dt = self._parse_iso(n.get("created_at"))
                        n_age = (now - n_dt).total_seconds() / 3600.0 if n_dt else idle_hours
                        if 6.0 <= n_age <= 72.0:
                            extracted = self._extract_commitments(cnt, sender="Team", timestamp=n.get("created_at"))
                            for ec in extracted:
                                if ec.get("action_type") in ("send_proposal", "send_profile") and not has_proposal:
                                    ec["age_hours"] = round(n_age, 1)
                                    ec["status"] = "broken"
                                    unfulfilled_commitments.append(ec)
                                elif ec.get("action_type") == "make_call" and len(lead_calls) == 0:
                                    ec["age_hours"] = round(n_age, 1)
                                    ec["status"] = "broken"
            if unfulfilled_commitments:
                unfulfilled_commitments.sort(key=lambda c: (0 if c.get("sender") not in ("CRM Note", "System") else 1, -c.get("age_hours", 0)))

            for comm in unfulfilled_commitments:
                comm_age = comm.get("age_hours", 24.0)
                if not (6.0 <= comm_age <= 72.0):
                    continue
                sender = comm.get("sender") or "Team"
                comm_text = comm.get("text") or "Follow-up"
                sev = "critical" if (comm_age >= 24.0 or temp == "hot" or deal_val >= 25000) else "high"
                aberrations.append({
                    "lead_id": lid,
                    "lead_name": name,
                    "business_name": biz,
                    "aberration_type": AberrationType.BROKEN_GROUP_COMMITMENT,
                    "severity": sev,
                    "idle_hours": round(comm_age, 1),
                    "deal_value": deal_val,
                    "commitment_text": comm_text,
                    "commitment_sender": sender,
                    "description": f"In Zero7 group, {sender} promised: '{comm_text}' {round(comm_age, 1)}h ago, but ZERO follow-up or CRM action was recorded.",
                    "lead_summary": {
                        "status": status,
                        "call_stage": call_stage,
                        "temperature": temp,
                        "commitment": comm,
                        "group_mention": comm_text
                    }
                })
                break

            # -------------------------------------------------------------
            # Rule 8: UNANSWERED_PROSPECT_QUERY
            # Prospect sent an incoming WhatsApp message (Central 9479007951 or Personal),
            # but NO subsequent outgoing reply has been sent by the team (between 2 and 48 hours)
            # -------------------------------------------------------------
            if lead_wa:
                most_recent_wa = lead_wa[0]
                m_dir = (most_recent_wa.get("direction") or "").lower()
                if m_dir in ("incoming", "in"):
                    m_ts = self._parse_iso(most_recent_wa.get("timestamp"))
                    m_age_hrs = (now - m_ts).total_seconds() / 3600.0 if m_ts else 24.0
                    if 2.0 <= m_age_hrs <= 48.0:  # Recent active inquiries (between 2 and 48 hours old)
                        m_txt = (most_recent_wa.get("message_text") or "").strip()
                        m_acc = most_recent_wa.get("account_phone") or ""
                        acc_name = "Central WhatsApp (Zero7 Consultancy: 9479007951)" if "9479007951" in m_acc else "WhatsApp"
                        sev = "critical" if (m_age_hrs >= 12.0 or temp == "hot" or deal_val >= 25000) else "high"
                        aberrations.append({
                            "lead_id": lid,
                            "lead_name": name,
                            "business_name": biz,
                            "aberration_type": AberrationType.UNANSWERED_PROSPECT_QUERY,
                            "severity": sev,
                            "idle_hours": round(m_age_hrs, 1),
                            "deal_value": deal_val,
                            "incoming_text": m_txt[:200],
                            "account_name": acc_name,
                            "description": f"Prospect '{name}' ({biz}) sent an incoming message {round(m_age_hrs, 1)}h ago on {acc_name} with ZERO response: '{m_txt[:80]}...'",
                            "lead_summary": {
                                "status": status,
                                "call_stage": call_stage,
                                "temperature": temp,
                                "incoming_snippet": m_txt[:120],
                                "account_name": acc_name
                            }
                        })

        # Sort by severity (critical first, then high, then medium)
        sev_rank = {"critical": 0, "high": 1, "medium": 2, "low": 3}
        aberrations.sort(key=lambda x: (sev_rank.get(x["severity"], 4), -x["idle_hours"]))

        self.last_audit_summary = {
            "total_leads_scanned": len(leads),
            "total_aberrations_found": len(aberrations),
            "critical_count": sum(1 for a in aberrations if a["severity"] == "critical"),
            "high_count": sum(1 for a in aberrations if a["severity"] == "high"),
            "medium_count": sum(1 for a in aberrations if a["severity"] == "medium"),
            "timestamp": now.isoformat()
        }
        self.last_run_time = now
        return aberrations

    def calculate_aberration_impact(self, aberration: Dict[str, Any]) -> int:
        """
        Calculates a priority impact score (0 to 100) for a detected pipeline aberration.
        Ensures group messages are strictly high-signal (score >= 50).
        """
        atype = aberration.get("aberration_type")
        idle_hrs = aberration.get("idle_hours", 0.0)
        deal_val = float(aberration.get("deal_value") or 0.0)
        sev = aberration.get("severity", "medium")

        score = 0
        if atype == AberrationType.UNANSWERED_PROSPECT_QUERY:
            score = 90  # Critical: direct prospect inquiry sitting unreplied
        elif atype == AberrationType.UNCONTACTED_LEAD:
            score = 80 if idle_hrs <= 24.0 else 60
        elif atype == AberrationType.BROKEN_GROUP_COMMITMENT:
            score = 75  # Direct promise made by team member
        elif atype == AberrationType.CALL_CONNECTED_NO_NEXT_ACTION:
            score = 65  # Fresh momentum lost after call
        elif atype == AberrationType.PROPOSAL_WITHOUT_UPDATE:
            score = 60 if deal_val >= 25000 else 50
        elif atype == AberrationType.HOT_LEAD_NEGLECTED:
            score = 60 if deal_val >= 25000 else 50
        elif atype == AberrationType.DNP_ABANDONED:
            score = 45  # Lower urgency
        elif atype == AberrationType.OVERDUE_DEADLINE:
            score = 50
        else:
            score = 40

        # High deal value boosts urgency
        if deal_val >= 50000:
            score = min(100, score + 15)
        elif deal_val >= 25000:
            score = min(100, score + 10)

        if sev == "critical":
            score = min(100, score + 10)

        return score

    def filter_cooldown_aberrations(
        self,
        aberrations: List[Dict[str, Any]],
        cooldown_hours: float = DEFAULT_COOLDOWN_HOURS
    ) -> List[Dict[str, Any]]:
        """
        Comprehensive anti-spam & deduplication filter:
        1. Ensures each lead is alerted at most ONCE per cooldown window (default 168h / 7 days).
        2. Checks recent Zero7 WhatsApp group chatter (last 72 hours): If lead was discussed, skips.
        3. Checks recent CRM activity: If any note, call log, or update occurred within 24 hours, skips.
        4. Calculates Aberration Impact Score (0-100) and filters out low-signal items (< 50).
        5. Deduplicates within the current audit batch.
        """
        now = datetime.now(timezone.utc)
        cooldown_delta = timedelta(hours=cooldown_hours)
        unalerted = []
        seen_in_batch = set()

        # 1. Fetch recent Sentinel alerts from DB
        if cooldown_hours > 0:
            recent_cutoff = (now - cooldown_delta).isoformat()
            recent_alerts = Repository._execute("""
                SELECT lead_id, created_at, nag_message FROM sentinel_alerts_log
                WHERE created_at >= ? AND status = 'sent'
            """, (recent_cutoff,), fetchall=True) or []
            
            alerted_lead_ids = {r["lead_id"] for r in recent_alerts if r.get("lead_id")}
            alerted_text_corpus = " ".join((r.get("nag_message") or "") for r in recent_alerts).lower()
        else:
            recent_alerts = []
            alerted_lead_ids = set()
            alerted_text_corpus = ""

        # 2. Fetch Zero7 group chatter in last 72 hours (3 days)
        group_lookback = (now - timedelta(hours=72.0)).isoformat()
        recent_group_msgs = Repository._execute("""
            SELECT message_text, sender_name, timestamp FROM zero7_group_messages
            WHERE timestamp >= ?
        """, (group_lookback,), fetchall=True) or []
        recent_chatter_corpus = " ".join((m.get("message_text") or "") for m in recent_group_msgs).lower()

        # 3. Fetch recent calls and notes in last 24 hours
        activity_lookback = (now - timedelta(hours=24.0)).isoformat()
        recent_calls = Repository._execute("SELECT lead_id FROM call_logs WHERE called_at >= ?", (activity_lookback,), fetchall=True) or []
        recent_notes = Repository._execute("SELECT lead_id FROM notes WHERE created_at >= ?", (activity_lookback,), fetchall=True) or []
        active_crm_lead_ids = {c["lead_id"] for c in recent_calls if c.get("lead_id")}.union(
            {n["lead_id"] for n in recent_notes if n.get("lead_id")}
        )

        for item in aberrations:
            lid = item.get("lead_id")
            if not lid or lid in seen_in_batch:
                continue

            name = (item.get("lead_name") or "").strip()
            biz = (item.get("business_name") or "").strip()
            norm_name = name.lower()
            norm_biz = biz.lower() if biz else ""

            # Rule A: Already alerted for this lead in the last cooldown_hours
            if cooldown_hours > 0:
                if lid in alerted_lead_ids:
                    continue

                # Check individual alert record for lead
                last_alert = Repository.get_last_sentinel_alert_for_lead(lid)
                if last_alert:
                    alert_time = self._parse_iso(last_alert.get("created_at") or last_alert.get("dispatched_at"))
                    if alert_time and (now - alert_time) < cooldown_delta:
                        continue

            # Rule B: Name or business mentioned in recent alert messages
            if len(norm_name) >= 4 and norm_name in alerted_text_corpus:
                continue
            if norm_biz and len(norm_biz) >= 5 and norm_biz in alerted_text_corpus:
                continue

            # Rule C: Name or business mentioned in recent team group discussions (last 72 hours)
            if len(norm_name) >= 4 and norm_name in recent_chatter_corpus:
                continue
            if norm_biz and len(norm_biz) >= 5 and norm_biz in recent_chatter_corpus:
                continue

            # Rule D: Active touchpoint in CRM in last 24 hours
            if lid in active_crm_lead_ids:
                continue

            # Rule E: Aberration Impact Score must be >= 50 (Zero Spam Principle)
            impact = self.calculate_aberration_impact(item)
            item["impact_score"] = impact
            if impact < 50:
                continue

            seen_in_batch.add(lid)
            unalerted.append(item)

        # Sort unalerted by impact_score descending so highest value item is picked first
        unalerted.sort(key=lambda x: (-x.get("impact_score", 0), -x.get("idle_hours", 0)))
        return unalerted

    def generate_nag_copy(self, aberration: Dict[str, Any]) -> str:
        """
        Generates sharp, compact accountability questions for the Zero7 WhatsApp group.
        FORMAT CONSTRAINT: Strictly 1 to 3 lines max for WhatsApp mobile screens.
        """
        atype = aberration["aberration_type"]
        name = aberration.get("lead_name") or "Lead"
        biz = aberration.get("business_name") or name
        hours = aberration.get("idle_hours", 0.0)
        days = round(hours / 24.0, 1) if hours >= 24 else None
        deal_val = aberration.get("deal_value") or 0.0
        val_str = f"₹{deal_val:,.0f}" if deal_val > 0 else ""

        # Compact label formatting to prevent mobile screen wrapping
        clean_name = name.strip()[:18]
        raw_biz = (biz or "").strip()
        if raw_biz and raw_biz.lower() != clean_name.lower():
            clean_biz = f" ({raw_biz[:14]}..)" if len(raw_biz) > 14 else f" ({raw_biz})"
        else:
            clean_biz = ""
        label = f"{clean_name}{clean_biz}"

        time_txt = f"{days}d" if days else f"{hours:.0f}h"

        if atype == AberrationType.UNANSWERED_PROSPECT_QUERY:
            msg_snip = (aberration.get("incoming_text") or "").strip().replace("\n", " ")
            if len(msg_snip) > 36:
                msg_snip = msg_snip[:33] + "..."
            return (
                f"🚨 *@team: {label}* - WA query {time_txt} se unreplied:\n"
                f"\"{msg_snip}\"\n"
                f"👉 *Kaun reply kar raha hai? Please update.*"
            )

        elif atype == AberrationType.UNCONTACTED_LEAD:
            return (
                f"🚨 *@team: {label}* uncontacted hai ({time_txt} ago).\n"
                f"👉 *Kaun call dial kar raha hai? Please update.*"
            )

        elif atype == AberrationType.BROKEN_GROUP_COMMITMENT:
            sender = (aberration.get("commitment_sender") or "@team").strip()[:15]
            comm_text = (aberration.get("commitment_text") or "Follow-up").strip().replace("\n", " ")
            if len(comm_text) > 36:
                comm_text = comm_text[:33] + "..."
            return (
                f"⚠️ *@team: {sender}* commitment pending ({time_txt} ago):\n"
                f"\"{comm_text}\"\n"
                f"👉 *Lead {clean_name} pe status kya hai?*"
            )

        elif atype == AberrationType.PROPOSAL_WITHOUT_UPDATE:
            val_txt = f" ({val_str})" if val_str else ""
            return (
                f"📋 *@team: {label}*{val_txt} - Proposal {time_txt} se out hai.\n"
                f"👉 *Client follow-up ka kya status hai?*"
            )

        elif atype == AberrationType.CALL_CONNECTED_NO_NEXT_ACTION:
            return (
                f"📞 *@team: {label}* se call connect hua par next step missing hai.\n"
                f"👉 *Call pe kya decide hua? Please log action.*"
            )

        elif atype == AberrationType.DNP_ABANDONED:
            return (
                f"🔁 *@team: {label}* ne call nahi uthaya ({time_txt} ago).\n"
                f"👉 *Callback plan hai ya drop karein?*"
            )

        elif atype == AberrationType.HOT_LEAD_NEGLECTED:
            val_txt = f" ({val_str})" if val_str else ""
            return (
                f"🔥 *@team: {label}*{val_txt} - Lead pe {time_txt} se zero touchpoint.\n"
                f"👉 *Immediate next action kya hai?*"
            )

        elif atype == AberrationType.OVERDUE_DEADLINE:
            task = (aberration.get("lead_summary", {}).get("next_action") or "Scheduled Task").strip()
            if len(task) > 30:
                task = task[:27] + "..."
            date = (aberration.get("lead_summary", {}).get("next_action_date") or "Recently").strip()
            return (
                f"⏰ *@team: {label}* ka task overdue hai ({date}).\n"
                f"👉 *Task: '{task}' - Please update CRM.*"
            )

        elif atype == AberrationType.STALLED_QUALIFIED:
            return (
                f"⚡ *@team: {label}* pipeline mein {time_txt} se stalled hai.\n"
                f"👉 *Where are we stuck? What is the update?*"
            )

        # Generic nag fallback (strictly 2 lines)
        return (
            f"⚠️ *@team: {label}* pe pipeline update pending hai.\n"
            f"👉 *Please update CRM status.*"
        )

    def dispatch_nag_to_zero7(self, aberration: Dict[str, Any], nag_message: str) -> Dict[str, Any]:
        """
        Dispatches the nag message strictly to the Zero7 WhatsApp group.
        SECURITY RESTRICTION: Destination is hardcoded to ZERO7_GROUP_JID.
        """
        import urllib.request
        import urllib.error

        lid = aberration.get("lead_id")
        atype = aberration.get("aberration_type")
        sev = aberration.get("severity", "medium")

        # 1. Dispatch via local WhatsApp daemon Port 8085 (with failover)
        url = f"{self.daemon_url}/send-group-message/zero7"
        payload = json.dumps({
            "message_text": nag_message,
            "agent_slug": "pipeline_sentinel",
            "group": ZERO7_GROUP_NAME,
            "account": "central"
        }).encode("utf-8")

        dispatch_status = "sent"
        wa_mid = None
        error_msg = None

        try:
            req = urllib.request.Request(
                url,
                data=payload,
                headers={"Content-Type": "application/json"},
                method="POST"
            )
            with urllib.request.urlopen(req, timeout=12) as resp:
                res_data = json.loads(resp.read().decode("utf-8"))
                wa_mid = res_data.get("wa_message_id")
                dispatch_status = "sent"
                logger.info(f"[SENTINEL] Dispatched nag to Zero7 group: {nag_message[:50]}... (MID: {wa_mid})")
        except urllib.error.HTTPError as he:
            dispatch_status = "daemon_error"
            error_msg = f"HTTP {he.code}: {he.read().decode('utf-8', errors='ignore')}"
            logger.warning(f"[SENTINEL] Daemon HTTP error: {error_msg}")
        except Exception as ex:
            dispatch_status = "daemon_offline"
            error_msg = str(ex)
            logger.warning(f"[SENTINEL] WhatsApp daemon unreachable ({self.daemon_url}): {error_msg}")

        # 2. Always log in sentinel_alerts_log database table
        alert_record = Repository.log_sentinel_alert(
            lead_id=lid,
            aberration_type=atype,
            severity=sev,
            nag_message=nag_message,
            wa_message_id=wa_mid,
            status=dispatch_status,
            group_target=ZERO7_GROUP_NAME
        )

        # 3. Log into activity feed
        try:
            Repository.log_activity({
                "lead_id": lid,
                "activity_type": "sentinel_nag",
                "description": f"Pipeline Sentinel dispatched nag to Zero7 group ({atype})",
                "metadata": {
                    "group": ZERO7_GROUP_NAME,
                    "aberration_type": atype,
                    "severity": sev,
                    "status": dispatch_status,
                    "preview": nag_message[:100]
                }
            })
        except Exception:
            pass

        return {
            "status": "success",
            "dispatch_status": dispatch_status,
            "group_target": ZERO7_GROUP_NAME,
            "alert": alert_record,
            "wa_message_id": wa_mid,
            "error": error_msg
        }

    # Backward-compatible alias
    dispatch_nag_to_zdro7 = dispatch_nag_to_zero7

    def run_sentinel_cycle(
        self,
        batch_limit: int = 1,
        cooldown_hours: float = DEFAULT_COOLDOWN_HOURS
    ) -> Dict[str, Any]:
        """
        Executes one full Sentinel audit and nag cycle:
        1. Checks business hours (9:30 AM to 8:30 PM IST).
        2. Checks global throttle (minimum 60m between any group alerts).
        3. Audits all leads across the CRM with strict recency bounds (24-48h).
        4. Filters out items currently within cooldown (default 7 days per lead, no recent chatter).
        5. Takes top `batch_limit` (default 1) highest-severity aberrations.
        6. Generates concise 1-3 line copy and dispatches to the Zero7 WhatsApp group.
        7. Returns a structured executive cycle report.
        """
        now = datetime.now(timezone.utc)
        ist_tz = timezone(timedelta(hours=5, minutes=30))
        now_ist = datetime.now(ist_tz)
        ist_hour = now_ist.hour + (now_ist.minute / 60.0)

        # 1. Check Working Hours Guard (9:30 AM to 8:30 PM IST)
        if not (9.5 <= ist_hour <= 20.5):
            logger.info(f"[SENTINEL] Outside active business hours ({now_ist.strftime('%H:%M')} IST). Throttling cycle.")
            return {
                "timestamp": now.isoformat(),
                "status": "throttled",
                "reason": f"Outside active business hours (9:30 AM - 8:30 PM IST). Current IST: {now_ist.strftime('%H:%M')}",
                "nags_dispatched_count": 0
            }

        # 2. Check Daily Volume Cap (Max 6 group alerts per calendar day IST)
        today_ist_start = now_ist.replace(hour=0, minute=0, second=0, microsecond=0)
        today_utc_cutoff = today_ist_start.astimezone(timezone.utc).isoformat()
        today_sent_count = Repository.count_sentinel_alerts_today(today_utc_cutoff)
        max_daily_nags = int(os.getenv("SENTINEL_MAX_DAILY_NAGS", "6"))
        if today_sent_count >= max_daily_nags:
            logger.info(f"[SENTINEL] Daily limit of {max_daily_nags} group alerts reached today ({today_sent_count}/{max_daily_nags}). Throttling cycle.")
            return {
                "timestamp": now.isoformat(),
                "status": "throttled",
                "reason": f"Daily limit of {max_daily_nags} alerts reached today ({today_sent_count}/{max_daily_nags}).",
                "nags_dispatched_count": 0
            }

        # 3. Minimum 60m interval between group alerts
        if cooldown_hours > 0:
            last_global = Repository._execute("""
                SELECT created_at FROM sentinel_alerts_log
                WHERE status = 'sent' ORDER BY created_at DESC LIMIT 1
            """, fetchone=True)
            if last_global:
                last_g_dt = self._parse_iso(last_global.get("created_at"))
                if last_g_dt and (now - last_g_dt).total_seconds() < 3600:  # 60 mins minimum spacing
                    logger.info("[SENTINEL] Recent nag dispatched < 60m ago. Throttling cycle.")
                    return {
                        "timestamp": now.isoformat(),
                        "status": "throttled",
                        "reason": "Minimum 60m interval between group alerts maintained.",
                        "nags_dispatched_count": 0
                    }

        all_aberrations = self.audit_all_leads()
        active_aberrations = self.filter_cooldown_aberrations(all_aberrations, cooldown_hours=cooldown_hours)

        batch_to_send = active_aberrations[:batch_limit]
        dispatched_results = []

        for aberration in batch_to_send:
            copy = self.generate_nag_copy(aberration)
            res = self.dispatch_nag_to_zero7(aberration, copy)
            dispatched_results.append({
                "lead_id": aberration["lead_id"],
                "lead_name": aberration["lead_name"],
                "business_name": aberration["business_name"],
                "aberration_type": aberration["aberration_type"],
                "severity": aberration["severity"],
                "impact_score": aberration.get("impact_score", 50),
                "nag_copy": copy,
                "dispatch": res
            })
            # Brief spacing between messages
            time.sleep(1.0)

        report = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "total_leads_scanned": self.last_audit_summary.get("total_leads_scanned", 0),
            "total_aberrations_detected": len(all_aberrations),
            "unalerted_aberrations": len(active_aberrations),
            "nags_dispatched_count": len(dispatched_results),
            "dispatched_nags": dispatched_results,
            "group_target": ZERO7_GROUP_NAME,
            "cooldown_hours": cooldown_hours,
            "today_sent_count": today_sent_count + len(dispatched_results),
            "max_daily_nags": max_daily_nags
        }

        # Stage an action card in Founder Cockpit / agent_actions for visibility
        try:
            if dispatched_results:
                Repository.stage_action({
                    "lead_id": dispatched_results[0]["lead_id"],
                    "agent_slug": "pipeline_sentinel",
                    "action_type": "sentinel_audit_completed",
                    "title": f"Sentinel Agent Dispatched {len(dispatched_results)} Nags to Zero7 Group",
                    "description": f"Audited {report['total_leads_scanned']} leads. Detected {len(all_aberrations)} aberrations. Nags fired for: {', '.join(d['lead_name'] for d in dispatched_results)}.",
                    "payload": report
                })
        except Exception:
            pass

        return report

    def get_status(self) -> Dict[str, Any]:
        """Returns live status and telemetry of the Sentinel Agent."""
        now = datetime.now(timezone.utc)
        ist_tz = timezone(timedelta(hours=5, minutes=30))
        now_ist = datetime.now(ist_tz)
        today_ist_start = now_ist.replace(hour=0, minute=0, second=0, microsecond=0)
        today_utc_cutoff = today_ist_start.astimezone(timezone.utc).isoformat()
        today_sent_count = Repository.count_sentinel_alerts_today(today_utc_cutoff)
        max_daily_nags = int(os.getenv("SENTINEL_MAX_DAILY_NAGS", "6"))

        recent_alerts = Repository.list_sentinel_alerts(limit=10)
        return {
            "agent_slug": "pipeline_sentinel",
            "agent_name": "Zero7 Pipeline Sentinel & Nagger",
            "status": "active_running",
            "restricted_group": ZERO7_GROUP_NAME,
            "group_jid": ZERO7_GROUP_JID,
            "daemon_url": self.daemon_url,
            "cooldown_hours": DEFAULT_COOLDOWN_HOURS,
            "cycle_interval_seconds": CYCLE_INTERVAL_SECONDS,
            "working_hours": "09:30 - 20:30 IST",
            "today_sent_alerts": today_sent_count,
            "max_daily_nags": max_daily_nags,
            "last_run_time": self.last_run_time.isoformat() if self.last_run_time else None,
            "last_audit_summary": self.last_audit_summary,
            "recent_alerts": recent_alerts
        }


# Singleton instance
sentinel_agent = SentinelAgent()


def main():
    """CLI Runner for testing and continuous standalone execution."""
    import argparse
    parser = argparse.ArgumentParser(description="Zero7 CRM Pipeline Sentinel Agent")
    parser.add_argument("--audit", action="store_true", help="Run audit and print detected aberrations")
    parser.add_argument("--cycle", action="store_true", help="Run one full audit and nag cycle")
    parser.add_argument("--continuous", action="store_true", help="Run in continuous 24/7 background mode")
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except Exception:
            pass

    parser.add_argument("--interval", type=int, default=CYCLE_INTERVAL_SECONDS, help="Interval in seconds for continuous mode")
    parser.add_argument("--batch", type=int, default=3, help="Max nags per cycle")
    parser.add_argument("--cooldown", type=float, default=DEFAULT_COOLDOWN_HOURS, help="Cooldown hours between repeat alerts")
    parser.add_argument("--synthesize", type=str, help="Synthesize and print lead memory dossier for lead_id")
    args = parser.parse_args()

    agent = SentinelAgent()

    if args.synthesize:
        print(f"\n[SYNTHESIZE] Synthesizing context dossier for lead '{args.synthesize}'...")
        dossier = agent.synthesize_lead_context(args.synthesize)
        print(json.dumps(dossier, indent=2, default=str))
        return

    if args.audit:
        print("\n[AUDIT] Running full CRM 360-degree audit...")
        aberrations = agent.audit_all_leads()
        print(f"[SUCCESS] Audit complete! Scanned {agent.last_audit_summary.get('total_leads_scanned')} leads.")
        print(f"[ALERT] Found {len(aberrations)} aberrations across the pipeline:")
        for idx, a in enumerate(aberrations[:15], 1):
            print(f"  {idx}. [{a['severity'].upper()}] {a['lead_name']} ({a['business_name']}) - {a['aberration_type']}: {a['description']}")
        return

    if args.cycle:
        print("\n[CYCLE] Executing single Sentinel Nag Cycle...")
        report = agent.run_sentinel_cycle(batch_limit=args.batch, cooldown_hours=args.cooldown)
        print(json.dumps(report, indent=2))
        return

    if args.continuous:
        print(f"\n[CONTINUOUS] Starting 24/7 Continuous Sentinel Loop (Interval: {args.interval}s, Batch: {args.batch}, Cooldown: {args.cooldown}h)...")
        print(f"[SECURITY] Target: STRICTLY LOCKED to WhatsApp Group '{ZERO7_GROUP_NAME}' ({ZERO7_GROUP_JID})\n")
        while True:
            try:
                print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Running Sentinel cycle...")
                report = agent.run_sentinel_cycle(batch_limit=args.batch, cooldown_hours=args.cooldown)
                print(f"  Dispatched {report['nags_dispatched_count']} nags to Zero7. Next cycle in {args.interval}s.")
            except Exception as e:
                print(f"  [ERROR] Cycle failed: {e}")
            time.sleep(args.interval)

    parser.print_help()


if __name__ == "__main__":
    main()
