"""
Lead & Company Research Agent for Zero7 CRM.
Performs automated intelligence gathering, business analysis, pain-point mapping,
and strategic Zero7 pitch creation based on lead profile, Meta form data, and conversation history.
"""

import json
import re
from typing import Dict, Any, List, Optional
from backend.ai.client import chat_completion

RESEARCH_SYSTEM_PROMPT = """You are the Senior Enterprise Solutions Architect and Commercial Strategist for Zero7 (zero7.space).
Zero7 is an elite boutique engineering consultancy founded by IITians. We design, build, and deploy custom enterprise operating systems, workflow automation, modern ERPs, field sales mobile apps, and real-time WhatsApp intelligence systems for growing businesses, manufacturing firms, distributors, and service companies.

Your mission: Given the lead's profile, Meta Ad form responses, conversation history, and notes, conduct a rigorous operational analysis of their business and provide actionable intelligence for the sales team.

Analyze:
1. Executive Summary: Who they are, what their core business does, their scale, and market position based on available data.
2. Operational Bottlenecks: Specific friction points they face (e.g. managing via Excel/Tally/paper registers creates data silos, delayed invoicing, missing inventory visibility, slow dispatch, poor supervisor accountability).
3. Zero7 Opportunity: The exact custom software or automation system Zero7 should propose to transform their operations.
4. Recommended Architecture & Modules: Key features of the proposed software (e.g., WhatsApp-integrated dispatch tracker, role-based supervisor tablet UI, PostgreSQL order engine).
5. Indicative Project Tier: Realistic investment range in Indian Rupees (e.g. "₹1.5 Lakh - ₹3.0 Lakh").
6. Opening Pitch Hook: A punchy, respectful, and highly compelling conversation starter for WhatsApp or phone outreach addressing their specific pain point.

CRITICAL: Return ONLY valid JSON adhering strictly to this schema, with NO markdown code fences or surrounding text:
{
  "executive_summary": "...",
  "operational_bottlenecks": "...",
  "zero7_opportunity": "...",
  "recommended_tech": "...",
  "estimated_budget": "...",
  "pitch_hook": "...",
  "industry_tags": ["Manufacturing", "Distribution", "Excel-Migration"]
}
"""

def generate_company_brief(
    lead: Dict[str, Any],
    notes: Optional[List[Dict]] = None,
    calls: Optional[List[Dict]] = None,
    wa_messages: Optional[List[Dict]] = None
) -> Dict[str, Any]:
    """
    Generate structured company brief and strategic pitch analysis for a lead.
    """
    notes = notes or []
    calls = calls or []
    wa_messages = wa_messages or []

    name = lead.get("name") or "Unnamed Lead"
    business_name = lead.get("business_name") or "Independent Business"
    city = lead.get("city") or "Not specified"
    phone = lead.get("phone") or "Not specified"
    email = lead.get("email") or "Not specified"
    website = lead.get("website") or "None"
    temperature = lead.get("temperature") or "warm"
    call_stage = lead.get("call_stage") or "first_call"
    last_notes = lead.get("last_update_notes") or "None"

    # Extract Meta / Channel data
    channel_data = lead.get("channel_data") or {}
    if isinstance(channel_data, str):
        try:
            channel_data = json.loads(channel_data)
        except Exception:
            channel_data = {}

    form_answers_text = ""
    form_answers = channel_data.get("form_answers") or []
    if form_answers:
        form_lines = [f"- {a.get('question')}: {a.get('answer')}" for a in form_answers if a.get('question')]
        form_answers_text = "\n".join(form_lines)

    campaign_info = ""
    if channel_data.get("campaign_name"):
        campaign_info += f"Campaign: {channel_data.get('campaign_name')}\n"
    if channel_data.get("ad_name"):
        campaign_info += f"Ad Clicked: {channel_data.get('ad_name')}\n"
    if channel_data.get("platform"):
        campaign_info += f"Platform: {channel_data.get('platform')}\n"

    # Contextual notes, calls & WhatsApp
    recent_notes = "\n".join([f"- Note: {n.get('content') or n.get('notes')}" for n in notes[:5] if (n.get('content') or n.get('notes'))])
    recent_calls = "\n".join([f"- Call ({c.get('outcome')}): {c.get('notes')}" for c in calls[:5] if c.get('notes')])
    recent_wa = "\n".join([f"- {'Lead' if m.get('direction') == 'incoming' else 'Zero7'}: {m.get('message_text')}" for m in wa_messages[-6:] if m.get('message_text')])

    user_context = f"""
LEAD PROFILE:
- Contact Name: {name}
- Business / Company: {business_name}
- City / Region: {city}
- Website: {website}
- Phone: {phone}
- Email: {email}
- Lead Temperature: {temperature}
- Call Stage: {call_stage}
- Internal Rep Notes: {last_notes}

MARKETING ATTRIBUTION & INBOUND QUESTIONNAIRE:
{campaign_info or 'Source: Direct / Inbound Form'}
Form Responses:
{form_answers_text or 'No specific form answers captured.'}

RECENT INTERACTION TIMELINE:
{recent_notes or 'No internal notes logged yet.'}
{recent_calls or 'No call logs recorded yet.'}
{recent_wa or 'No WhatsApp interaction recorded yet.'}
"""

    messages = [
        {"role": "system", "content": RESEARCH_SYSTEM_PROMPT},
        {"role": "user", "content": user_context.strip()}
    ]

    raw_response = chat_completion(messages, model="auto/best-reasoning", temperature=0.5, max_tokens=1500)

    # Clean code fences if present
    cleaned = raw_response.strip()
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
    cleaned = re.sub(r"\s*```$", "", cleaned)

    try:
        data = json.loads(cleaned)
        return {
            "executive_summary": data.get("executive_summary", "").strip(),
            "operational_bottlenecks": data.get("operational_bottlenecks", "").strip(),
            "zero7_opportunity": data.get("zero7_opportunity", "").strip(),
            "recommended_tech": data.get("recommended_tech", "").strip(),
            "estimated_budget": data.get("estimated_budget", "").strip(),
            "pitch_hook": data.get("pitch_hook", "").strip(),
            "industry_tags": data.get("industry_tags", []),
            "raw_json": json.dumps(data)
        }
    except Exception as err:
        print(f"[RESEARCH AGENT] JSON parse fallback on: {cleaned[:100]}... Error: {err}")
        return {
            "executive_summary": f"Business analysis for {business_name} ({city}). {name} is evaluating modern software to replace legacy workflows.",
            "operational_bottlenecks": "Reliance on manual records, Excel spreadsheets, or paper registers causing operational delays and visibility gaps.",
            "zero7_opportunity": "Custom automated cloud application with real-time reporting, mobile access, and WhatsApp notifications.",
            "recommended_tech": "Web Portal + PostgreSQL + WhatsApp Integration",
            "estimated_budget": "₹1.5 Lakh - ₹3.0 Lakh",
            "pitch_hook": f"Hi {name}, following up on your inquiry with Zero7 regarding software solutions for {business_name} in {city}.",
            "industry_tags": ["Software Automation", "Workflow"],
            "raw_json": json.dumps({"raw": cleaned})
        }


HANDOFF_SYSTEM_PROMPT = """You are the Senior Executive Briefing Officer for Zero7 (zero7.space), an elite engineering consultancy run by 3 founders.
Your job is to provide an ultra-concise, high-impact 60-second operational debrief ("Catch Me Up") for one of the founders before they speak to or chat with a client.

Given the lead's profile, company brief, recent calls with transcripts, WhatsApp messages, and prototypes:
Synthesize an immediate, fluff-free tactical intelligence debrief.

CRITICAL: Return ONLY valid JSON adhering strictly to this schema, with NO markdown code fences or surrounding text:
{
  "summary_60s": "3-sentence executive summary of who this is, where the deal stands, and what the current milestone is.",
  "last_activity": "Exact 1-2 sentence recap of the most recent interaction (who spoke to whom, when, and key takeaway).",
  "commitments_pending": [
    "Specific promise 1 Zero7 made or deliverable client is expecting",
    "Specific promise 2"
  ],
  "three_talking_points": [
    "Talking point 1 to lead the conversation with authority",
    "Talking point 2 addressing their specific bottleneck or showing prototype progress",
    "Talking point 3 qualifying their budget / next milestone"
  ],
  "watch_outs": [
    "Key risk, objection, or sensitivity to navigate (e.g. price sensitivity, fear of disrupting accountants)"
  ],
  "recommended_next_action": "Single clearest next step (e.g. 'Walk through Prototype v1 on screen-share and lock in token advance')."
}
"""

def generate_founder_handoff(
    lead: Dict[str, Any],
    brief: Optional[Dict[str, Any]] = None,
    notes: Optional[List[Dict]] = None,
    calls: Optional[List[Dict]] = None,
    wa_messages: Optional[List[Dict]] = None,
    prototypes: Optional[List[Dict]] = None
) -> Dict[str, Any]:
    """
    Synthesizes a 60-second tactical debrief for any of the 3 founders before jumping on calls or chats.
    """
    notes = notes or []
    calls = calls or []
    wa_messages = wa_messages or []
    prototypes = prototypes or []

    name = lead.get("name") or "Unnamed Lead"
    business_name = lead.get("business_name") or name
    city = lead.get("city") or "India"
    stage = lead.get("call_stage") or lead.get("status") or "active"
    assigned_to = lead.get("assigned_to") or "Unassigned"

    # Recent notes
    recent_notes = "\n".join([f"- [{n.get('created_at', '')[:10]}] {n.get('notes', '')}" for n in notes[-4:]])
    
    # Recent calls
    recent_calls = []
    for c in calls[-3:]:
        c_text = c.get('transcript') or c.get('summary') or c.get('notes') or ''
        recent_calls.append(f"- [{c.get('created_at', '')[:10]}] Outcome: {c.get('outcome', 'Call')} | Summary: {c_text[:300]}")
    recent_calls_text = "\n".join(recent_calls)

    # Recent WhatsApp
    recent_wa = []
    for m in wa_messages[-8:]:
        sender = "CLIENT" if not m.get('from_me') else "ZERO7"
        recent_wa.append(f"- [{sender}]: {m.get('body', '')[:200]}")
    recent_wa_text = "\n".join(recent_wa)

    # Prototypes
    proto_info = ", ".join([f"{p.get('version', 'v1')} ({p.get('prototype_url') or 'local'})" for p in prototypes[-2:]]) or "None created yet"

    brief_summary = brief.get("executive_summary", "") if brief else ""
    brief_bottlenecks = brief.get("operational_bottlenecks", "") if brief else ""

    context_prompt = f"""
LEAD & BUSINESS:
- Business: {business_name}
- Contact Person: {name}
- City: {city}
- Current Stage: {stage}
- Assigned Driver: {assigned_to}
- Existing Prototypes: {proto_info}

EXISTING BRIEF / ANALYSIS:
- Summary: {brief_summary or 'In discovery phase'}
- Key Bottlenecks: {brief_bottlenecks or 'Manual processes'}

RECENT INTERACTION TIMELINE:
Calls:
{recent_calls_text or 'No calls recorded'}

WhatsApp Messages:
{recent_wa_text or 'No WhatsApp history recorded'}

Internal Notes:
{recent_notes or 'No internal notes'}
"""

    messages = [
        {"role": "system", "content": HANDOFF_SYSTEM_PROMPT},
        {"role": "user", "content": context_prompt.strip()}
    ]

    raw_response = chat_completion(messages, temperature=0.4, max_tokens=1500)
    cleaned = raw_response.strip()
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
    cleaned = re.sub(r"\s*```$", "", cleaned)

    try:
        data = json.loads(cleaned)
        return {
            "summary_60s": data.get("summary_60s", "").strip(),
            "last_activity": data.get("last_activity", "").strip(),
            "commitments_pending": data.get("commitments_pending", []),
            "three_talking_points": data.get("three_talking_points", []),
            "watch_outs": data.get("watch_outs", []),
            "recommended_next_action": data.get("recommended_next_action", "").strip()
        }
    except Exception as err:
        print(f"[FOUNDER HANDOFF] JSON parse fallback. Error: {err}")
        return {
            "summary_60s": f"{business_name} ({city}) is currently in the {stage} stage with Zero7. Active lead led by {assigned_to}.",
            "last_activity": "Recent interactions logged in CRM calls and WhatsApp thread.",
            "commitments_pending": ["Demonstrate working interactive prototype", "Confirm workflow scope"],
            "three_talking_points": [
                f"Confirm key operational requirements for {business_name}",
                "Review prototype progress and mobile accessibility",
                "Agree on target timeline and token advance"
            ],
            "watch_outs": ["Ensure proposed solution does not disrupt existing accounting tools."],
            "recommended_next_action": "Schedule 15-minute live screen-share demo."
        }

