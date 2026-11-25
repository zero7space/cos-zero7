"""
Zero7 Capital-Per-Unit-Time AI Scheduling Engine.
Maximizes revenue velocity by scheduling tasks in order of expected financial leverage:
1. Disproportionate Returns (Whales, late-stage proposals, prototype demos, advance collection)
2. Necessity Tasks (Hard external commitments, promised dates/times, critical decay guards)
3. Squeeze Queue (Secondary actions executed during idle waiting gaps)

Strictly respects human daily execution bandwidth (max 50 actions/day).
"""

import json
import re
from datetime import datetime, date
from typing import Dict, Any, List, Optional
import logging

logger = logging.getLogger(__name__)

class SchedulingEngine:

    @staticmethod
    def _parse_channel_data(channel_data: Any) -> Dict[str, Any]:
        if not channel_data:
            return {}
        if isinstance(channel_data, dict):
            return channel_data
        if isinstance(channel_data, str):
            try:
                return json.loads(channel_data)
            except Exception:
                return {}
        return {}

    @staticmethod
    def extract_scale_metrics(lead: Dict[str, Any]) -> Dict[str, Any]:
        """Extract employee scale, revenue tier, and industry from lead and channel_data."""
        cd = SchedulingEngine._parse_channel_data(lead.get("channel_data"))
        form_answers = cd.get("form_answers") or []
        
        emp_raw = cd.get("employee_count") or ""
        rev_raw = cd.get("monthly_revenue") or ""
        biz_desc = lead.get("business_name") or ""
        manage_tool = ""

        for ans in form_answers:
            q = (ans.get("question") or "").lower()
            a = (ans.get("answer") or "").strip()
            if "employee" in q:
                emp_raw = a
            elif "revenue" in q:
                rev_raw = a
            elif "what does your business do" in q or "business_do" in q:
                biz_desc += " " + a
            elif "excel" in q or "tally" in q or "register" in q:
                manage_tool = a

        # Normalise employee scale score (0 - 100)
        emp_score = 15
        emp_str = emp_raw.lower()
        if "200+" in emp_str or "200" in emp_str:
            emp_score = 100
        elif "50-200" in emp_str:
            emp_score = 85
        elif "11-50" in emp_str:
            emp_score = 60
        elif "2-10" in emp_str:
            emp_score = 30
        elif "1" in emp_str or "just_me" in emp_str:
            emp_score = 15

        # Normalise revenue score (0 - 100)
        rev_score = 25
        rev_str = rev_raw.lower()
        if "50l" in rev_str or "crore" in rev_str or "cr" in rev_str:
            rev_score = 100
        elif "25l" in rev_str:
            rev_score = 85
        elif "11-50" in rev_str:
            rev_score = 55
        elif "2-10" in rev_str:
            rev_score = 35

        # Domain multiplier bonus
        domain_bonus = 0
        desc_lower = (biz_desc + " " + (lead.get("business_name") or "")).lower()
        if any(w in desc_lower for w in ["manufactur", "garment", "factory", "steel", "alloys", "chemical", "pharma"]):
            domain_bonus += 20
        if any(w in desc_lower for w in ["distribut", "wholesale", "supply", "fmcg", "dairy", "foods"]):
            domain_bonus += 15
        if any(w in desc_lower for w in ["hospital", "clinic", "dental", "jewellery", "jewelry"]):
            domain_bonus += 15
        if "yes" in manage_tool.lower():
            domain_bonus += 10

        scale_score = min(100.0, ((emp_score * 0.6) + (rev_score * 0.4) + domain_bonus))

        # Indicative project tier estimate
        if scale_score >= 80:
            est_value = "₹3.5L - ₹6.0L"
            est_val_num = 450000
        elif scale_score >= 55:
            est_value = "₹2.0L - ₹3.5L"
            est_val_num = 250000
        elif scale_score >= 35:
            est_value = "₹1.0L - ₹2.0L"
            est_val_num = 150000
        else:
            est_value = "₹50K - ₹1.0L"
            est_val_num = 75000

        return {
            "scale_score": scale_score,
            "employee_count": emp_raw or "2-10",
            "monthly_revenue": rev_raw or "Unspecified",
            "estimated_deal_value": est_value,
            "estimated_deal_num": est_val_num,
            "business_nature": desc_lower[:60]
        }

    @staticmethod
    def extract_momentum_and_commitments(
        lead: Dict[str, Any],
        notes: List[Dict] = None,
        calls: List[Dict] = None,
        group_msgs: List[Dict] = None
    ) -> Dict[str, Any]:
        """Detect stage momentum, external commitments, and urgency signals."""
        notes = notes or []
        calls = calls or []
        group_msgs = group_msgs or []

        cd = SchedulingEngine._parse_channel_data(lead.get("channel_data"))
        sheet_ns = cd.get("sheet_next_step") or ""
        sheet_up = cd.get("sheet_updates") or ""
        meeting_flag = cd.get("meeting_flag") or ""
        call_brief = cd.get("call_brief") or ""
        last_notes = lead.get("last_update_notes") or ""
        next_act = lead.get("next_action") or ""
        priority = (lead.get("priority") or "unexplored").lower()

        # Combine text context
        all_text = " ".join([
            sheet_ns, sheet_up, call_brief, last_notes, next_act,
            " ".join([n.get("content") or "" for n in notes[:4]]),
            " ".join([c.get("notes") or "" for c in calls[:3]]),
            " ".join([m.get("message_text") or "" for m in group_msgs[:4]])
        ]).lower()

        is_high_priority = (priority == "high" or "high priority" in all_text or "close" in all_text)
        is_won = (priority == "won" or lead.get("status") == "won")
        is_lost = (priority == "lost" or lead.get("status") == "lost" or "lost" in sheet_ns.lower())

        # 1. Check for Hard Commitments / Dates (Necessity)
        has_hard_commitment = False
        commitment_reason = ""

        date_patterns = [
            r"\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday)\b",
            r"\b(\d{1,2}(?:st|nd|rd|th)?\s*(?:oct|nov|dec|jan|feb|mar|october|november))\b",
            r"\b(confirm meeting|set meeting|meeting on|call at|callback on)\b"
        ]
        for pat in date_patterns:
            m = re.search(pat, all_text)
            if m:
                has_hard_commitment = True
                commitment_reason = f"Committed action: {m.group(0)}"
                break

        if meeting_flag.upper() == "Y" and not is_won and not is_lost:
            has_hard_commitment = True
            if not commitment_reason:
                commitment_reason = "Agreed Meeting Scheduled"

        # 2. Check for Stage Momentum (0.1 to 1.0)
        momentum_score = 0.35
        momentum_tag = "Discovery"

        if any(w in all_text for w in ["advance", "token", "payment", "bank account", "account details"]):
            momentum_score = 1.0
            momentum_tag = "Advance Collection"
        elif any(w in all_text for w in ["quotation sent", "final quotation", "costing", "quote deke", "budget final"]):
            momentum_score = 0.95
            momentum_tag = "Quotation Closing"
        elif any(w in all_text for w in ["prototype dikhana", "prototype build", "show prototype", "demo dikha"]):
            momentum_score = 0.85
            momentum_tag = "Prototype Presentation"
        elif any(w in all_text for w in ["scope clear", "requirements depth", "requirement finalise", "meeting araange", "scope samjhna"]):
            momentum_score = 0.75
            momentum_tag = "Scope & Architecture Discovery"
        elif any(w in all_text for w in ["call kar ke", "callback", "touch me", "update lena"]):
            momentum_score = 0.55
            momentum_tag = "Active Follow-up"
        elif lead.get("call_stage") in ["uncontacted", "first_call"]:
            momentum_score = 0.40
            momentum_tag = "Speed to Lead"

        # 3. Urgency Multiplier
        urgency = 1.0
        if has_hard_commitment:
            urgency += 0.8
        if is_high_priority:
            urgency += 0.5
        if "touchpoint" in all_text or "zero touchpoint" in all_text:
            urgency += 0.6

        return {
            "momentum_score": momentum_score,
            "momentum_tag": momentum_tag,
            "has_hard_commitment": has_hard_commitment,
            "commitment_reason": commitment_reason,
            "urgency_multiplier": urgency,
            "is_high_priority": is_high_priority,
            "is_won": is_won,
            "is_lost": is_lost,
            "raw_next_step": sheet_ns or next_act,
            "raw_updates": sheet_up or last_notes
        }

    @classmethod
    def score_and_classify_lead(
        cls,
        lead: Dict[str, Any],
        notes: List[Dict] = None,
        calls: List[Dict] = None,
        group_msgs: List[Dict] = None
    ) -> Dict[str, Any]:
        """Compute holistic EV score and classify into Disproportionate, Necessity, or Squeeze."""
        scale = cls.extract_scale_metrics(lead)
        momentum = cls.extract_momentum_and_commitments(lead, notes, calls, group_msgs)

        if momentum["is_won"] or momentum["is_lost"]:
            return {
                "lead_id": lead.get("id"),
                "lead_name": lead.get("name"),
                "business_name": lead.get("business_name"),
                "ev_score": 0.0,
                "tier": "closed",
                "tier_label": "Closed / Archived",
                "task_action": "Deal Closed" if momentum["is_won"] else "Archived / Lost",
                "action_type": "archive",
                "estimated_deal_value": scale["estimated_deal_value"],
                "scale_score": scale["scale_score"],
                "employee_count": scale["employee_count"],
                "monthly_revenue": scale["monthly_revenue"],
                "has_hard_commitment": False,
                "raw_next_step": momentum["raw_next_step"],
                "raw_updates": momentum["raw_updates"],
                "why": "Deal closed or archived."
            }

        # Calculate Expected Value Score (0.0 to 100.0)
        base_ev = scale["scale_score"] * momentum["momentum_score"] * momentum["urgency_multiplier"]
        ev_score = min(100.0, round(base_ev, 1))

        # Classification Logic:
        # Tier A: Disproportionate Return
        # Criteria: High business scale (50-200+, ₹25L+ rev) OR late stage closing (Quotation/Advance/Prototype)
        is_disproportionate = False
        if scale["scale_score"] >= 65 and momentum["momentum_score"] >= 0.70:
            is_disproportionate = True
        elif momentum["momentum_tag"] in ["Quotation Closing", "Advance Collection", "Prototype Presentation"] and scale["scale_score"] >= 45:
            is_disproportionate = True
        elif momentum["is_high_priority"] and scale["scale_score"] >= 50:
            is_disproportionate = True

        # Tier B: Necessity Task
        is_necessity = False
        if momentum["has_hard_commitment"] and not is_disproportionate:
            is_necessity = True
        elif momentum["urgency_multiplier"] >= 2.0 and not is_disproportionate:
            is_necessity = True

        # Assign Tier
        if is_disproportionate:
            tier = "disproportionate"
        elif is_necessity:
            tier = "necessity"
        else:
            tier = "squeeze"

        # Formulate Sharp Next Task (STRICTLY 3-7 words)
        raw_ns = momentum["raw_next_step"]
        m_tag = momentum["momentum_tag"]
        task_action = ""
        action_type = "call"

        if m_tag == "Advance Collection":
            task_action = "Collect advance token payment"
            action_type = "close"
        elif m_tag == "Quotation Closing":
            task_action = "Deliver quotation and finalize costing"
            action_type = "proposal"
        elif m_tag == "Prototype Presentation":
            task_action = "Present interactive prototype demo"
            action_type = "prototype"
        elif m_tag == "Scope & Architecture Discovery":
            task_action = "Conduct architecture and scope meeting"
            action_type = "meeting"
        elif "quotation" in raw_ns.lower() or "costing" in raw_ns.lower():
            task_action = "Deliver quotation and finalize costing"
            action_type = "proposal"
        elif "prototype" in raw_ns.lower():
            task_action = "Present prototype and lock scope"
            action_type = "prototype"
        elif "advance" in raw_ns.lower():
            task_action = "Collect advance token payment"
            action_type = "close"
        elif "meeting" in raw_ns.lower():
            task_action = "Conduct scheduled scope meeting"
            action_type = "meeting"
        elif momentum["has_hard_commitment"]:
            task_action = "Execute committed client follow-up"
            action_type = "call"
        elif "scope" in raw_ns.lower() or "requirement" in raw_ns.lower():
            task_action = "Finalize software requirement scope"
            action_type = "call"
        elif "swayam" in raw_ns.lower() or "warm" in raw_ns.lower():
            task_action = "Show ERP demo to revive account"
            action_type = "prototype"
        elif "call kar ke update" in raw_ns.lower() or "callback" in raw_ns.lower():
            task_action = "Call prospect for status update"
            action_type = "call"
        elif raw_ns and len(raw_ns.split()) <= 7 and not raw_ns.lower().startswith("created"):
            task_action = raw_ns.strip()
        else:
            # Fallback based on stage
            if tier == "disproportionate":
                task_action = "Conduct executive closing call"
            elif tier == "necessity":
                task_action = "Execute committed client follow-up"
            else:
                task_action = "Speed to lead qualification call"

        # Rationale formulation
        why_parts = []
        if scale["employee_count"] in ["50-200", "200+"]:
            why_parts.append(f"Enterprise scale ({scale['employee_count']} emps)")
        if "₹" in scale["monthly_revenue"] or scale["monthly_revenue"] != "Unspecified":
            why_parts.append(f"Revenue {scale['monthly_revenue']}")
        why_parts.append(f"Stage: {momentum['momentum_tag']}")
        if momentum["has_hard_commitment"]:
            why_parts.append(f"Commitment: {momentum['commitment_reason']}")
        if momentum["raw_updates"]:
            why_parts.append(f"Context: {momentum['raw_updates'][:45]}...")

        why_text = " • ".join(why_parts)

        return {
            "lead_id": lead.get("id"),
            "lead_name": lead.get("name") or "Unnamed",
            "business_name": lead.get("business_name") or "Independent",
            "phone": lead.get("phone") or "",
            "city": lead.get("city") or "",
            "ev_score": ev_score,
            "tier": tier,
            "tier_label": "⚡ Disproportionate Return" if tier == "disproportionate" else ("⚠️ Hard Commitment" if tier == "necessity" else "🔄 Interstitial Squeeze"),
            "task_action": task_action,
            "action_type": action_type,
            "momentum_tag": momentum["momentum_tag"],
            "scale_score": scale["scale_score"],
            "employee_count": scale["employee_count"],
            "monthly_revenue": scale["monthly_revenue"],
            "estimated_deal_value": scale["estimated_deal_value"],
            "estimated_deal_num": scale["estimated_deal_num"],
            "why": why_text,
            "has_hard_commitment": momentum["has_hard_commitment"],
            "raw_next_step": momentum["raw_next_step"],
            "raw_updates": momentum["raw_updates"]
        }

    @classmethod
    def generate_daily_battle_plan(
        cls,
        leads: List[Dict[str, Any]],
        notes_by_lead: Dict[str, List] = None,
        calls_by_lead: Dict[str, List] = None,
        group_msgs_by_lead: Dict[str, List] = None,
        max_daily_capacity: int = 50
    ) -> Dict[str, Any]:
        """
        Produce strictly capped 50-action battle plan ordered by Capital Per Unit Time.
        Slots 1-10: Disproportionate Returns (Whales)
        Slots 11-20: Necessity & Commitments
        Slots 21-35: High Yield Pipeline
        Slots 36-50: Squeeze Queue
        """
        notes_by_lead = notes_by_lead or {}
        calls_by_lead = calls_by_lead or {}
        group_msgs_by_lead = group_msgs_by_lead or {}

        scored_items = []
        for l in leads:
            lid = l.get("id")
            item = cls.score_and_classify_lead(
                l,
                notes=notes_by_lead.get(lid, []),
                calls=calls_by_lead.get(lid, []),
                group_msgs=group_msgs_by_lead.get(lid, [])
            )
            if item["tier"] != "closed":
                scored_items.append(item)

        # Segregate into tiers
        disproportionate_pool = [it for it in scored_items if it["tier"] == "disproportionate"]
        necessity_pool = [it for it in scored_items if it["tier"] == "necessity"]
        squeeze_pool = [it for it in scored_items if it["tier"] == "squeeze"]

        # Sort each pool by EV score descending
        disproportionate_pool.sort(key=lambda x: x["ev_score"], reverse=True)
        necessity_pool.sort(key=lambda x: x["ev_score"], reverse=True)
        squeeze_pool.sort(key=lambda x: x["ev_score"], reverse=True)

        # Allocate into 50-action budget
        # 1. Top Disproportionate (Whales) - up to 15 slots
        allocated_disproportionate = disproportionate_pool[:15]

        # 2. Today's Necessity Commitments - up to 15 slots
        allocated_necessity = necessity_pool[:15]

        # 3. Remaining High/Medium Disproportionate or Necessity
        remaining_high = disproportionate_pool[15:] + necessity_pool[15:]
        remaining_high.sort(key=lambda x: x["ev_score"], reverse=True)

        slots_left = max_daily_capacity - (len(allocated_disproportionate) + len(allocated_necessity))
        high_fill = remaining_high[:max(0, slots_left // 2)]

        slots_left_for_squeeze = max_daily_capacity - (len(allocated_disproportionate) + len(allocated_necessity) + len(high_fill))
        allocated_squeeze = squeeze_pool[:max(0, slots_left_for_squeeze)]

        # Assemble the definitive ranked 50-action list
        ordered_schedule = []
        # Rank 1 to N: Disproportionate
        for it in allocated_disproportionate:
            it["rank"] = len(ordered_schedule) + 1
            ordered_schedule.append(it)

        # Next: Necessity Commitments
        for it in allocated_necessity:
            it["rank"] = len(ordered_schedule) + 1
            ordered_schedule.append(it)

        # Next: Remaining High
        for it in high_fill:
            it["rank"] = len(ordered_schedule) + 1
            ordered_schedule.append(it)

        # Next: Squeeze Queue
        for it in allocated_squeeze:
            it["rank"] = len(ordered_schedule) + 1
            ordered_schedule.append(it)

        # Calculate macro metrics
        total_pipeline_val = sum(it.get("estimated_deal_num", 0) for it in ordered_schedule)
        top10_pipeline_val = sum(it.get("estimated_deal_num", 0) for it in ordered_schedule[:10])

        return {
            "date": date.today().isoformat(),
            "max_capacity": max_daily_capacity,
            "scheduled_count": len(ordered_schedule),
            "total_active_pool": len(scored_items),
            "disproportionate_count": len(allocated_disproportionate),
            "necessity_count": len(allocated_necessity),
            "squeeze_count": len(allocated_squeeze),
            "total_pipeline_in_play": f"₹{total_pipeline_val / 100000:.1f}L",
            "top10_pipeline_in_play": f"₹{top10_pipeline_val / 100000:.1f}L",
            "top_10_needle_movers": ordered_schedule[:10],
            "schedule": ordered_schedule,
            "disproportionate_items": [it for it in ordered_schedule if it["tier"] == "disproportionate"],
            "necessity_items": [it for it in ordered_schedule if it["tier"] == "necessity"],
            "squeeze_items": [it for it in ordered_schedule if it["tier"] == "squeeze"]
        }
