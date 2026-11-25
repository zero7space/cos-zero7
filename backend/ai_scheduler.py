"""
AI Task Scheduler for Zero7 CRM Leads.
Generates concise next action tasks (3-7 words), deadlines, and priorities
based on rich lead context: notes, calls, WhatsApp conversations, company scale, and sheet remarks.
Integrates OmniRoute LLM cluster with Google Gemini fallback and deterministic SchedulingEngine heuristics.
"""

import os
import json
import re
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional

def _generate_with_ai(context_text: str) -> Optional[Dict[str, str]]:
    """Attempt generation via OmniRoute LLM client first, then direct Gemini."""
    prompt = f"""You are the Executive Sales Director for Zero7 (zero7.space).
Given the following lead profile, remarks, and conversation history, generate:
1. task: A sharp, actionable next task for the sales team (STRICTLY between 3 to 7 words).
2. deadline: A realistic delivery deadline (e.g. 'Today, 5 PM', 'Tomorrow, 12 PM', 'In 2 days').
3. priority: Either 'high', 'medium', or 'low'.
4. tier: Either 'disproportionate' (whale account, closing quotation, advance collection, demo) or 'necessity' (hard date commitment, urgent follow-up) or 'squeeze'.

Context:
{context_text}

Respond ONLY with valid JSON in this format:
{{"task": "Deliver quotation and finalize costing", "deadline": "Today, 5 PM", "priority": "high", "tier": "disproportionate"}}
"""
    # 1. Try OmniRoute
    try:
        from backend.ai.client import chat_completion
        raw = chat_completion(
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
            max_tokens=120
        )
        if raw:
            cleaned = re.sub(r"^```json\s*", "", raw.strip())
            cleaned = re.sub(r"\s*```$", "", cleaned)
            parsed = json.loads(cleaned)
            if "task" in parsed:
                return {
                    "task": parsed["task"].strip(),
                    "deadline": parsed.get("deadline", "Today, 5 PM").strip(),
                    "priority": parsed.get("priority", "medium").lower().strip(),
                    "tier": parsed.get("tier", "squeeze").lower().strip()
                }
    except Exception:
        pass

    # 2. Try Gemini API directly
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if api_key:
        try:
            import urllib.request
            url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={api_key}"
            data = json.dumps({
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {"temperature": 0.2, "maxOutputTokens": 120}
            }).encode("utf-8")
            req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=5) as resp:
                res_json = json.loads(resp.read().decode("utf-8"))
                text = res_json["candidates"][0]["content"]["parts"][0]["text"].strip()
                cleaned = re.sub(r"^```json\s*", "", text)
                cleaned = re.sub(r"\s*```$", "", cleaned)
                parsed = json.loads(cleaned)
                if "task" in parsed:
                    return {
                        "task": parsed["task"].strip(),
                        "deadline": parsed.get("deadline", "Today, 5 PM").strip(),
                        "priority": parsed.get("priority", "medium").lower().strip(),
                        "tier": parsed.get("tier", "squeeze").lower().strip()
                    }
        except Exception:
            pass

    return None


def generate_lead_task(lead: Dict[str, Any], notes: List[Dict] = None, calls: List[Dict] = None, wa_messages: List[Dict] = None) -> Dict[str, str]:
    """
    Generate prioritized next task for a lead using SchedulingEngine heuristics + OmniRoute fallback.
    Returns: {"task": "...", "deadline": "...", "priority": "high"|"medium"|"low", "tier": "..."}
    """
    notes = notes or []
    calls = calls or []
    wa_messages = wa_messages or []

    # First evaluate with deterministic SchedulingEngine
    from backend.services.scheduling_engine import SchedulingEngine
    scored = SchedulingEngine.score_and_classify_lead(lead, notes=notes, calls=calls, group_msgs=wa_messages)

    # Combine text context for optional LLM refinement
    name = lead.get("name", "") or ""
    biz = lead.get("business_name", "") or ""
    last_notes = (lead.get("last_update_notes") or "")
    sheet_ns = scored.get("raw_next_step") or ""
    sheet_up = scored.get("raw_updates") or ""

    all_text_parts = [
        f"Name: {name}",
        f"Company: {biz}",
        f"Scale: {scored.get('employee_count')} employees, Revenue: {scored.get('monthly_revenue')}",
        f"Sheet Next Step: {sheet_ns}",
        f"Sheet Updates: {sheet_up}",
        f"Last Notes: {last_notes}"
    ]
    for n in notes[:3]:
        all_text_parts.append(f"Note: {n.get('content') or ''}")
    for c in calls[:3]:
        all_text_parts.append(f"Call: {c.get('notes') or ''}")
    for m in wa_messages[-6:]:
        all_text_parts.append(f"WA: {m.get('message_text') or ''}")

    # If the lead is high priority or disproportionate, try AI refinement
    if scored.get("tier") == "disproportionate" or scored.get("scale_score", 0) >= 60:
        ai_res = _generate_with_ai("\n".join(all_text_parts))
        if ai_res and len(ai_res.get("task", "").split()) <= 7:
            return {
                "task": ai_res["task"],
                "deadline": ai_res.get("deadline", "Today, 5 PM"),
                "priority": ai_res.get("priority", "high"),
                "tier": "disproportionate"
            }

    # Deterministic task & deadline based on scored tier
    deadline = "Today, 3 PM" if scored["has_hard_commitment"] else ("Today, 5 PM" if scored["tier"] == "disproportionate" else "Tomorrow, 12 PM")
    priority = "high" if scored["tier"] == "disproportionate" else ("high" if scored["has_hard_commitment"] else "medium")

    return {
        "task": scored["task_action"],
        "deadline": deadline,
        "priority": priority,
        "tier": scored["tier"]
    }
