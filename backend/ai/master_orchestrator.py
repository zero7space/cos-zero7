"""
Zero7 CRM — Master Autonomous Orchestration Agent
Acts as the central event bus and state machine for COS Theta.
Orchestrates raw omnichannel streams (Calls, WhatsApp, Mail, Meta) into automated
Supabase schemas, Vercel deployments, Hostinger subdomains, and stages 1-click approvals for the founder cockpit.
"""

import os
import json
import logging
from typing import Dict, Any, List, Optional

from backend.database import Repository
from backend.integrations.supabase_provisioner import supabase_provisioner
from backend.integrations.vercel_deployer import vercel_deployer
from backend.integrations.dns_provisioner import dns_provisioner
from backend.ai.research_agent import generate_company_brief
from backend.ai.prototype_agent import generate_or_iterate_prototype

logger = logging.getLogger("zero7_orchestrator")


class MasterOrchestrator:
    def __init__(self):
        pass

    def handle_call_recorded(self, call_id: str) -> Dict[str, Any]:
        """
        Triggered when a discovery call is logged or synced from WhatsApp/phone.
        Synthesizes company brief and qualifies lead.
        """
        call = Repository.get_call_log(call_id)
        if not call:
            return {"error": "Call log not found"}

        lead_id = call.get("lead_id")
        lead = Repository.get_lead(lead_id) if lead_id else None
        if not lead:
            return {"error": "Associated lead not found"}

        # 1. Generate / Refresh Company Brief
        notes = Repository.get_lead_notes(lead_id) or []
        calls = Repository.get_lead_calls(lead_id) or []
        wa_msgs = Repository.get_lead_whatsapp_messages(lead_id) or []

        brief = generate_company_brief(lead, notes=notes, calls=calls, wa_messages=wa_msgs)
        Repository.save_company_brief(lead_id, brief)

        # 2. Update Lead attributes
        deal_est = brief.get("estimated_deal_value") or lead.get("deal_value") or 25000.0
        Repository.update_lead(lead_id, {
            "temperature": "hot" if deal_est >= 25000 else "warm",
            "call_stage": "connected",
            "priority": "high" if deal_est >= 25000 else "medium",
            "deal_value": deal_est
        })

        # 3. Stage Action Card in Cockpit: "Auto-Generate Full-Stack Prototype"
        action = Repository.stage_action({
            "lead_id": lead_id,
            "agent_slug": "master_orchestrator",
            "action_type": "generate_prototype",
            "title": f"Generate Full-Stack Prototype for {lead.get('business_name') or lead.get('name')}",
            "description": f"Call transcribed ({call.get('duration_minutes', 5)}m). SOW synthesized. Ready to spin up Supabase schema & Vercel deployment.",
            "payload": {
                "lead_id": lead_id,
                "deal_value": deal_est,
                "workflow": brief.get("recommended_tech", "Vite + Supabase")
            }
        })

        return {
            "status": "success",
            "brief_generated": True,
            "staged_action_id": action.get("id") if action else None
        }

    def handle_prototype_requested(self, lead_id: str, prompt_override: Optional[str] = None) -> Dict[str, Any]:
        """
        Autonomous End-to-End Prototype Deployment:
        1. Provisions isolated Supabase PostgreSQL Schema.
        2. Synthesizes HTML/JS app connected to Supabase.
        3. Deploys to Vercel via Vercel REST API.
        4. Provisions custom subdomain via Hostinger DNS.
        5. Stages WhatsApp Pitch Copy in Founder Cockpit.
        """
        lead = Repository.get_lead(lead_id)
        if not lead:
            return {"error": "Lead not found"}

        biz_name = lead.get("business_name") or lead.get("name") or "Client"
        import re
        clean_slug = re.sub(r"[^a-zA-Z0-9_\-]", "-", biz_name.lower().strip())
        clean_slug = re.sub(r"-+", "-", clean_slug).strip("-") or f"client-{lead_id[:8]}"
        subdomain = f"proto-{clean_slug}.zero7.space"

        brief = Repository.get_company_brief(lead_id) or {}
        industry = brief.get("industry") or biz_name

        # Step 1: Provision Supabase Schema
        ddl_template = supabase_provisioner.generate_schema_template(industry, clean_slug)
        schema_res = supabase_provisioner.provision_client_schema(
            client_slug=clean_slug,
            ddl_statements=[ddl_template]
        )

        # Step 2: Synthesize App Code
        prompt = prompt_override or f"Build an operational prototype for {biz_name} matching {industry} requirements."
        try:
            proto_gen = generate_or_iterate_prototype(lead, [], prompt, brief)
        except Exception as e:
            logger.warning(f"[ORCHESTRATOR] AI completion failed ({e}), using resilient prototype synthesis.")
            proto_gen = {
                "prototype_title": f"{biz_name} — Operating System",
                "prototype_html": f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{biz_name} OS Prototype</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-slate-900 text-white min-h-screen p-8 font-sans">
  <div class="max-w-5xl mx-auto">
    <header class="flex justify-between items-center mb-8 border-b border-slate-800 pb-4">
      <div>
        <h1 class="text-2xl font-bold tracking-tight">{biz_name} Operations Hub</h1>
        <p class="text-sm text-slate-400 mt-1">Autonomous Prototype delivered by Zero7</p>
      </div>
      <span class="bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-3 py-1 rounded-full text-xs font-semibold">Live Prototype</span>
    </header>
    <main class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
      <div class="bg-slate-800/80 p-6 rounded-xl border border-slate-700">
        <h3 class="text-slate-400 text-xs uppercase tracking-wider font-semibold">Real-Time Data</h3>
        <p class="text-2xl font-bold mt-2">Active</p>
      </div>
      <div class="bg-slate-800/80 p-6 rounded-xl border border-slate-700">
        <h3 class="text-slate-400 text-xs uppercase tracking-wider font-semibold">Cloud Database</h3>
        <p class="text-2xl font-bold mt-2 text-emerald-400">Supabase Connected</p>
      </div>
      <div class="bg-slate-800/80 p-6 rounded-xl border border-slate-700">
        <h3 class="text-slate-400 text-xs uppercase tracking-wider font-semibold">Live Routing</h3>
        <p class="text-lg font-bold mt-2 text-sky-400">{subdomain}</p>
      </div>
    </main>
  </div>
</body>
</html>""",
                "sow_summary": f"Phase 1: Architecture & Data Model | Phase 2: Cloud Workflow Integration | Phase 3: Handover on {subdomain}",
                "whatsapp_pitch": f"Hi! We have deployed a working interactive prototype tailored for {biz_name}: {{{{PROTOTYPE_URL}}}}"
            }

        raw_html = proto_gen.get("prototype_html", "")
        # Inject Supabase client initialization script into HTML if not already present
        if schema_res.get("code_snippet") and "</head>" in raw_html:
            supabase_script = f"""
<script type="module">
  {schema_res.get('code_snippet')}
  window.Zero7Supabase = supabase;
</script>
</head>"""
            raw_html = raw_html.replace("</head>", supabase_script, 1)

        # Step 3: Save to internal Prototype Registry
        saved_proto = Repository.save_prototype(lead_id, {
            "title": proto_gen.get("prototype_title", f"{biz_name} Prototype"),
            "description": proto_gen.get("sow_summary", ""),
            "html_content": raw_html
        })
        share_token = saved_proto["share_token"]

        # Step 4: Deploy to Vercel
        project_name = f"proto-{clean_slug}"
        files = [
            {"file": "index.html", "data": raw_html},
            {"file": "vercel.json", "data": json.dumps({"cleanUrls": True})}
        ]
        vercel_res = vercel_deployer.deploy_project_from_files(project_name, files)

        # Step 5: Provision Hostinger DNS Subdomain
        dns_res = dns_provisioner.provision_subdomain(lead_id, subdomain, allow_collision_override=True)

        public_live_url = f"https://{subdomain}"
        Repository.update_lead(lead_id, {
            "subdomain": subdomain,
            "subdomain_status": "active" if dns_res.get("success") else "pending",
            "prototype_status": "built",
            "prototype_url": public_live_url
        })

        # Step 6: Formulate WhatsApp Pitch Copy & Stage Action in Cockpit
        raw_pitch = proto_gen.get("whatsapp_pitch", "")
        final_pitch = raw_pitch.replace("{{PROTOTYPE_URL}}", public_live_url)
        if public_live_url not in final_pitch:
            final_pitch += f"\n\nLive Interactive Prototype: {public_live_url}"

        staged_pitch = Repository.stage_action({
            "lead_id": lead_id,
            "agent_slug": "master_orchestrator",
            "action_type": "send_whatsapp",
            "title": f"Review & Send Prototype Pitch to {lead.get('name')} ({biz_name})",
            "description": f"Live prototype is active on {subdomain}. Review copy and send with 1 click.",
            "payload": {
                "recipient": lead.get("phone"),
                "message": final_pitch,
                "prototype_url": public_live_url,
                "sow_summary": proto_gen.get("sow_summary")
            }
        })

        return {
            "success": True,
            "subdomain": subdomain,
            "live_url": public_live_url,
            "supabase_schema": schema_res.get("schema_name"),
            "vercel_deployment": vercel_res,
            "dns_record": dns_res,
            "staged_action_id": staged_pitch.get("id") if staged_pitch else None
        }

    def handle_inbound_whatsapp_message(self, lead_id: str, message_text: str, sender_name: Optional[str] = None) -> Dict[str, Any]:
        """
        Universal WhatsApp ingestion handler:
        Logs incoming message, updates lead activity, and flags follow-up if inquiry or question detected.
        """
        lead = Repository.get_lead(lead_id)
        if not lead:
            return {"error": "Lead not found"}

        phone = lead.get("phone", "")
        import uuid
        msg_id = "wamsg_" + uuid.uuid4().hex[:8]
        now = Repository.now()
        Repository._execute(
            """INSERT OR IGNORE INTO whatsapp_messages 
            (id, account_id, account_phone, lead_phone, lead_id, direction, message_text, message_type, media_caption, timestamp, wa_message_id, status, media_url, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (msg_id, "central", "9479007951", phone, lead_id, "incoming", message_text, "text", None, now, msg_id, "delivered", None, now),
            commit=True
        )

        Repository.update_lead(lead_id, {
            "last_contacted_at": now,
            "updated_at": now
        })

        # Smart Inquiry Detection & Auto-Staging for Founder Cockpit Review
        inquiry_signals = ["?", "price", "pricing", "cost", "demo", "prototype", "sow", "quotation", "how", "when", "send", "details", "call"]
        lower_msg = (message_text or "").lower()
        staged_action_id = None
        if any(sig in lower_msg for sig in inquiry_signals) or len(message_text.strip().split()) >= 6:
            try:
                from backend.ai.client import chat_completion
                brief = Repository.get_company_brief(lead_id) or {}
                biz_name = lead.get("business_name") or lead.get("name") or "Client"
                sys_prompt = (
                    "You are Zero7's Lead Account Consultant. "
                    "A prospect just sent an inbound WhatsApp message. "
                    "Draft a concise, highly professional, 2-sentence WhatsApp reply addressing their question directly. "
                    "Do NOT include pleasantry fluff. Speak with technical authority and clarity."
                )
                user_ctx = f"Prospect: {lead.get('name')} ({biz_name})\nCompany Context: {brief.get('executive_summary', '')}\nInbound WhatsApp: {message_text}"
                draft_reply = chat_completion(
                    messages=[{"role": "system", "content": sys_prompt}, {"role": "user", "content": user_ctx}],
                    temperature=0.4,
                    max_tokens=300
                )
                if draft_reply:
                    staged = Repository.stage_action({
                        "lead_id": lead_id,
                        "agent_slug": "whatsapp_nudge",
                        "action_type": "send_whatsapp",
                        "title": f"Reply to Inbound WhatsApp from {lead.get('name')} ({biz_name})",
                        "description": f"Inbound inquiry: \"{message_text[:80]}...\". AI draft ready for 1-click review.",
                        "payload": {
                            "recipient": phone,
                            "message": draft_reply.strip(),
                            "inbound_trigger": message_text
                        }
                    })
                    if staged:
                        staged_action_id = staged.get("id")
            except Exception as ex:
                logger.warning(f"[ORCHESTRATOR] Inbound WhatsApp auto-nudge staging error: {ex}")

        return {"status": "logged", "message_id": msg_id, "staged_action_id": staged_action_id}

    def get_cockpit_overview(self) -> Dict[str, Any]:
        """
        Returns the executive state for the founder's Human-in-the-Loop Cockpit.
        """
        pending_actions = Repository.list_actions(status="pending") or []
        workers = Repository.list_all_workers() or []
        
        # Calculate pipeline health
        leads = Repository._execute("SELECT id, name, business_name, status, deal_value, prototype_status, subdomain FROM leads WHERE status != 'lost' LIMIT 100", fetchall=True) or []
        
        prototypes_live = sum(1 for l in leads if l.get("prototype_status") == "built")
        total_pipeline_val = sum(float(l.get("deal_value") or 0.0) for l in leads)

        return {
            "pending_actions_count": len(pending_actions),
            "pending_actions": pending_actions,
            "prototypes_live_count": prototypes_live,
            "total_pipeline_val": total_pipeline_val,
            "active_workers_count": len(workers),
            "workers": workers
        }


master_orchestrator = MasterOrchestrator()
