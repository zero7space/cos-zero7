"""
Prototype & Solution Architecture Agent for Zero7 CRM.
Enables conversational prototype ideation ("Let's build a prototype for X"),
generates complete interactive sandboxed HTML/JS prototypes for clients,
and crafts tailored WhatsApp pitch copy and Scope of Work summaries.
"""

import json
import re
from typing import Dict, Any, List, Optional
from backend.ai.client import chat_completion

PROTOTYPE_SYSTEM_PROMPT = """You are the Principal Solutions Architect and Rapid Prototyper at Zero7 (zero7.space).
You build bespoke software prototypes for potential clients to demonstrate how Zero7 can transform their business from manual/Excel workflows into slick, high-performing digital operating systems.

Your goal is two-fold:
1. Converse intelligently with the Zero7 sales consultant (Abhijeet / Shailesh) about the technical design, UX flow, and commercial angles for the lead.
2. Generate a **COMPLETE, WORKING, BEAUTIFUL INTERACTIVE HTML APPLICATION** tailored to the client's business, which can be rendered directly in a sandboxed iframe or shared with the client.

### Interactive Prototype Guidelines:
- Must be a complete, self-contained HTML document (<!DOCTYPE html> ... </html>).
- Include Tailwind CSS via CDN: `<script src="https://cdn.tailwindcss.com"></script>`.
- Use modern, polished UI design (clean typography, crisp border radii, subtle shadows, professional color palette matching the industry).
- Include WORKING JavaScript interactivity (e.g. tab switching between "Dashboard", "Orders", "Inventory", "New Entry", realistic status toggles, modal dialogs, and interactive search/filter).
- Pre-fill realistic, high-fidelity mock data tailored specifically to the client's business name and city (e.g. raw materials, work orders, finished goods, customer invoices).
- Include responsive styling so it renders cleanly in both Desktop (100% width) and Mobile (375px preview) viewports.
- IMPORTANT: Use single quotes for HTML attributes (e.g. `<button class='btn'>`) so the HTML embeds cleanly in JSON without escaping conflicts.

### Response Format:
Return your response STRICTLY as a JSON object with this exact structure:
{
  "reply_text": "A concise, conversational explanation to the sales consultant detailing what you designed, the key workflows implemented, and why the client will love it.",
  "prototype_title": "e.g. Navandar Mfg — Production & Order Operating System",
  "prototype_html": "<!DOCTYPE html><html>...complete interactive HTML app...</html>",
  "whatsapp_pitch": "Hi Vidhi! We noticed your manufacturing operations in Amravati currently manage work in Excel. Our engineering team at Zero7 put together a rapid interactive prototype of a dedicated production & dispatch system tailored for you: {{PROTOTYPE_URL}}. Would love to hear your thoughts!",
  "sow_summary": "Phase 1: Core Order & Dispatch Entry (2 Weeks) | Phase 2: Live Stock & WhatsApp Alerts (2 Weeks) | Est. Timeline: 4 Weeks"
}

CRITICAL: Return ONLY valid JSON with no markdown wrapping or preamble.
"""

PROTOTYPE_STUDIO_SYSTEM_PROMPT = PROTOTYPE_SYSTEM_PROMPT
__all__ = ["generate_or_iterate_prototype", "PROTOTYPE_SYSTEM_PROMPT", "PROTOTYPE_STUDIO_SYSTEM_PROMPT"]

def generate_or_iterate_prototype(
    lead: Dict[str, Any],
    conversation_history: List[Dict[str, str]],
    user_message: str,
    company_brief: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Process conversational prototype request and generate/update interactive HTML prototype.
    """
    name = lead.get("name") or "Lead"
    biz = lead.get("business_name") or "Business"
    city = lead.get("city") or "India"

    brief_context = ""
    if company_brief:
        brief_context = f"""
COMPANY INTELLIGENCE BRIEF:
- Executive Summary: {company_brief.get('executive_summary', '')}
- Bottlenecks: {company_brief.get('operational_bottlenecks', '')}
- Zero7 Proposed Angle: {company_brief.get('zero7_opportunity', '')}
- Recommended Tech: {company_brief.get('recommended_tech', '')}
"""

    context_message = f"""
LEAD CONTEXT:
- Client Name: {name}
- Business Name: {biz}
- City: {city}
{brief_context}

USER REQUEST:
{user_message}
"""

    # Build messages array
    messages = [{"role": "system", "content": PROTOTYPE_SYSTEM_PROMPT}]

    # Append previous conversation history (up to last 6 turns)
    for h in conversation_history[-6:]:
        role = h.get("role")
        content = h.get("content")
        if role in ["user", "assistant"] and content:
            messages.append({"role": role, "content": content})

    messages.append({"role": "user", "content": context_message.strip()})

    raw_response = chat_completion(messages, temperature=0.6, max_tokens=4000, timeout=60)

    # Clean potential markdown wrapping
    cleaned = raw_response.strip()
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
    cleaned = re.sub(r"\s*```$", "", cleaned)

    # 1. Try standard JSON parse (allowing unescaped control characters with strict=False)
    try:
        data = json.loads(cleaned, strict=False)
        return {
            "reply_text": data.get("reply_text", "Here is the interactive prototype based on your specifications.").strip(),
            "prototype_title": data.get("prototype_title", f"{biz} Interactive Prototype").strip(),
            "prototype_html": data.get("prototype_html", "").strip(),
            "whatsapp_pitch": data.get("whatsapp_pitch", "").strip(),
            "sow_summary": data.get("sow_summary", "").strip()
        }
    except Exception as e:
        print(f"[PROTOTYPE AGENT] Standard JSON parse failed ({e}). Attempting regex extraction...")

    # 2. Try regex extraction of fields from raw response
    html_match = re.search(r'(<!DOCTYPE html[\s\S]*?</html>)', cleaned, re.IGNORECASE) or re.search(r'(<html[\s\S]*?</html>)', cleaned, re.IGNORECASE)
    reply_match = re.search(r'"reply_text"\s*:\s*"([^"]+)"', cleaned)
    title_match = re.search(r'"prototype_title"\s*:\s*"([^"]+)"', cleaned)
    pitch_match = re.search(r'"whatsapp_pitch"\s*:\s*"([^"]+)"', cleaned)

    if html_match:
        # Unescape any JSON-escaped quotes or slashes if extracted from inside a JSON string
        extracted_html = html_match.group(1).replace(r'\"', '"').replace(r'\/', '/').replace(r'\n', '\n').replace(r'\t', '\t')
        print(f"[PROTOTYPE AGENT] Successfully recovered {len(extracted_html)} bytes of HTML via regex extraction!")
        return {
            "reply_text": reply_match.group(1) if reply_match else f"I've designed an interactive prototype for {biz} customized for their operational workflows.",
            "prototype_title": title_match.group(1) if title_match else f"{biz} Interactive Prototype",
            "prototype_html": extracted_html,
            "whatsapp_pitch": pitch_match.group(1) if pitch_match else f"Hi {name}, our team at Zero7 put together an interactive prototype showing how {biz} could run on a clean digital system: {{{{PROTOTYPE_URL}}}}.",
            "sow_summary": "Phase 1: Workflow Digitization (2 Weeks) | Phase 2: Mobile UI & Automation (2 Weeks)"
        }

    # 3. Fallback to default boilerplate shell if both failed
    print("[PROTOTYPE AGENT] Falling back to default shell.")
    return {
        "reply_text": f"I've designed an interactive prototype for {biz} addressing their production and tracking requirements.",
        "prototype_title": f"{biz} Operations Portal",
        "prototype_html": f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script src="https://cdn.tailwindcss.com"></script>
  <title>{biz} Portal</title>
</head>
<body class="bg-slate-50 text-slate-900 font-sans p-6">
  <div class="max-w-4xl mx-auto bg-white rounded-xl shadow-sm border border-slate-200 p-6">
    <div class="flex items-center justify-between border-b pb-4 mb-6">
      <div>
        <h1 class="text-xl font-bold text-slate-800">{biz} — Operations Hub</h1>
        <p class="text-sm text-slate-500">Custom Operating System by Zero7</p>
      </div>
      <span class="px-3 py-1 bg-emerald-100 text-emerald-800 text-xs font-semibold rounded-full">Live Prototype</span>
    </div>
    <div class="grid grid-cols-3 gap-4 mb-6">
      <div class="p-4 bg-slate-50 rounded-lg border border-slate-100">
        <div class="text-xs text-slate-500 uppercase font-semibold">Active Orders</div>
        <div class="text-2xl font-bold text-slate-800 mt-1">24</div>
      </div>
      <div class="p-4 bg-slate-50 rounded-lg border border-slate-100">
        <div class="text-xs text-slate-500 uppercase font-semibold">In Production</div>
        <div class="text-2xl font-bold text-indigo-600 mt-1">12</div>
      </div>
      <div class="p-4 bg-slate-50 rounded-lg border border-slate-100">
        <div class="text-xs text-slate-500 uppercase font-semibold">Ready for Dispatch</div>
        <div class="text-2xl font-bold text-emerald-600 mt-1">8</div>
      </div>
    </div>
    <div class="p-4 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-900">
      <strong>Zero7 Automation Benefit:</strong> Replaces manual paper registers and Excel sheets with real-time mobile order entry and instant WhatsApp dispatch notices.
    </div>
  </div>
</body>
</html>""",
        "whatsapp_pitch": f"Hi {name}, our team at Zero7 put together an interactive prototype showing how {biz} could run orders and production on a clean digital system: {{{{PROTOTYPE_URL}}}}. Let us know your thoughts!",
        "sow_summary": "Phase 1: Workflow Digitization (2 Weeks) | Phase 2: Mobile UI & Alerts (2 Weeks)"
    }
