"""
Hierarchical Data Pill Resolver Engine for COS Theta CRM.
Resolves dynamic @-tokens (WhatsApp, Deepgram transcripts, Meta questionnaires, files)
into structured prompt context with zero-crash fallbacks.
"""

import os
import re
import json
from typing import Dict, Any, List
from backend.database import Repository

CENTRAL_PHONE = "9479007951"
PERSONAL_PHONE = "9993202900"
USER_HOME = os.path.expanduser("~")
PROJECTS_ROOT = os.path.join(USER_HOME, "Desktop", "zero7 Consultancy", "Projects")

IGNORED_DIRS = {'.git', 'node_modules', '.next', '.vercel', '__pycache__', '.venv', 'dist', 'build', '.system_generated', 'coverage'}
IGNORED_EXTS = {'.exe', '.dll', '.bin', '.pyc', '.woff', '.woff2', '.ttf', '.eot', '.ico', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.mp4', '.wav', '.mp3'}


def _slugify(text: str) -> str:
    text = (text or "client").lower().strip()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[\s_-]+", "-", text)
    return text.strip("-") or "client"


def _format_size(size_bytes: int) -> str:
    if size_bytes < 1024:
        return f"{size_bytes} B"
    if size_bytes < 1024 * 1024:
        return f"{round(size_bytes / 1024, 1)} KB"
    return f"{round(size_bytes / (1024 * 1024), 1)} MB"


def _get_file_badge(ext: str) -> str:
    clean = ext.lstrip('.').upper()
    return clean[:5] if clean else 'FILE'


class DataPillResolver:
    @staticmethod
    def scan_lead_workspace_files(lead_id: str) -> List[Dict[str, Any]]:
        """
        Scans lead's local workspace vault and GitHub repository.
        Returns a list of structured file pills for autocomplete and prompt injection.
        """
        lead = Repository.get_lead(lead_id) or {}
        if not lead:
            return []

        # 1. First, check local directory on the current machine
        proj_path = lead.get("project_path")
        if not proj_path or not os.path.exists(proj_path):
            slug = _slugify(lead.get("business_name") or lead.get("name") or lead_id)
            candidates = [
                os.path.join(PROJECTS_ROOT, f"client-{slug}"),
                os.path.join(PROJECTS_ROOT, slug),
                os.path.join(PROJECTS_ROOT, lead.get("business_name") or ""),
            ]
            for c in candidates:
                if c and os.path.exists(c):
                    proj_path = c
                    break

        file_pills = []
        seen_paths = set()

        if proj_path and os.path.exists(proj_path):
            try:
                for root, dirs, files in os.walk(proj_path):
                    dirs[:] = [d for d in dirs if d not in IGNORED_DIRS and not d.startswith('.')]
                    rel_dir = os.path.relpath(root, proj_path)
                    depth = 0 if rel_dir == '.' else len(rel_dir.split(os.sep))
                    if depth > 4:
                        dirs.clear()
                        continue

                    for f in files:
                        ext = os.path.splitext(f)[1].lower()
                        if ext in IGNORED_EXTS or f.startswith('.'):
                            continue
                        full_path = os.path.join(root, f)
                        rel_path = os.path.relpath(full_path, proj_path).replace('\\', '/')
                        if rel_path in seen_paths:
                            continue
                        seen_paths.add(rel_path)

                        try:
                            size = os.path.getsize(full_path)
                        except Exception:
                            size = 0
                        size_fmt = _format_size(size)
                        folder = os.path.dirname(rel_path) or 'root'
                        badge = _get_file_badge(ext)

                        file_pills.append({
                            "tag": f"@file:{rel_path}",
                            "label": f,
                            "path": rel_path,
                            "size": size,
                            "size_fmt": size_fmt,
                            "category": "Repository File",
                            "ext": ext,
                            "badge": badge,
                            "desc": f"{folder}/ • {size_fmt}",
                            "insert": f"@file:{rel_path} ",
                            "source": "workspace"
                        })
            except Exception:
                pass

        # 2. If no local files found, check DB cache or GitHub API
        if not file_pills:
            cached = Repository.get_lead_cached_files(lead_id)
            if cached:
                file_pills = cached
            else:
                gh_url = lead.get("github_repo_url")
                if gh_url:
                    try:
                        from backend.integrations.github_vault import get_github_repo_tree
                        gh_files = get_github_repo_tree(gh_url)
                        if gh_files:
                            file_pills = gh_files
                            Repository.update_lead_cached_files(lead_id, file_pills)
                    except Exception:
                        pass

        # If local files were scanned, sync cache to DB
        if file_pills and proj_path and os.path.exists(proj_path):
            try:
                Repository.update_lead_cached_files(lead_id, file_pills)
            except Exception:
                pass

        return file_pills

    @staticmethod
    def inspect_available_pills_for_lead(lead_id: str) -> Dict[str, Any]:
        """
        Scans lead data and returns a structured tree of available pills
        for frontend autocomplete dropdowns.
        """
        lead = Repository.get_lead(lead_id) or {}
        if not lead:
            return {"categories": []}

        # 1. WhatsApp inboxes
        wa_messages = Repository.get_lead_whatsapp_messages(lead_id) or []
        central_msgs = [m for m in wa_messages if m.get("account_phone") == CENTRAL_PHONE]
        personal_msgs = [m for m in wa_messages if m.get("account_phone") == PERSONAL_PHONE]

        wa_pills = [
            {
                "pill": "@whatsapp.all",
                "label": "All WhatsApp Messages",
                "count": len(wa_messages),
                "badge": f"{len(wa_messages)} msgs",
                "description": "Merged conversation across Central & Personal lines"
            },
            {
                "pill": "@whatsapp.central",
                "label": f"Central Line ({CENTRAL_PHONE})",
                "count": len(central_msgs),
                "badge": f"{len(central_msgs)} msgs",
                "description": "Official Zero7 business line messages"
            },
            {
                "pill": "@whatsapp.personal",
                "label": f"Personal Line ({PERSONAL_PHONE})",
                "count": len(personal_msgs),
                "badge": f"{len(personal_msgs)} msgs",
                "description": "Consultant direct line messages"
            }
        ]

        # 2. Call transcripts
        calls = Repository.get_lead_calls(lead_id) or []
        calls_with_transcript = [c for c in calls if c.get("transcription_text")]
        
        call_pills = [
            {
                "pill": "@transcripts.all",
                "label": "All Call Transcripts",
                "count": len(calls_with_transcript),
                "badge": f"{len(calls_with_transcript)} calls",
                "description": "Chronological transcripts from all recorded phone calls"
            },
            {
                "pill": "@call.latest",
                "label": "Latest Call Transcript",
                "count": 1 if calls_with_transcript else 0,
                "badge": "Latest",
                "description": "Transcript of the most recent recorded conversation"
            }
        ]

        # Individual call pills
        for idx, c in enumerate(calls[:5]):
            cid = c.get("id", f"call_{idx}")
            dur = c.get("duration_minutes") or 0
            called_at = c.get("called_at") or "Recent"
            has_tx = bool(c.get("transcription_text"))
            call_pills.append({
                "pill": f"@call.{cid}",
                "label": f"Call: {called_at} ({dur}m)",
                "count": 1 if has_tx else 0,
                "badge": f"{dur}m",
                "description": f"Outcome: {c.get('outcome', 'Call')} | Transcript: {'Available' if has_tx else 'None'}"
            })

        # 3. Meta Attribution & Questionnaire
        channel_data = lead.get("channel_data") or {}
        if isinstance(channel_data, str):
            try:
                channel_data = json.loads(channel_data)
            except Exception:
                channel_data = {}
        
        form_answers = channel_data.get("form_answers") or []
        meta_pills = [
            {
                "pill": "@meta.form_answers",
                "label": "Meta Ad Questionnaire",
                "count": len(form_answers),
                "badge": f"{len(form_answers)} Q&A",
                "description": "Prospect answers to inbound Meta Lead Form questions"
            },
            {
                "pill": "@meta.campaign",
                "label": "Campaign Attribution",
                "count": 1 if channel_data.get("campaign_name") else 0,
                "badge": channel_data.get("platform", "Meta"),
                "description": f"Campaign: {channel_data.get('campaign_name', 'Direct')}"
            }
        ]

        # 4. Lead Profile & Notes
        notes = Repository.get_lead_notes(lead_id) or []
        profile_pills = [
            {
                "pill": "@lead.profile",
                "label": "Complete Client Profile",
                "count": 1,
                "badge": lead.get("temperature", "warm").upper(),
                "description": f"{lead.get('name')} • {lead.get('business_name')} ({lead.get('city', 'India')})"
            },
            {
                "pill": "@lead.business_name",
                "label": "Business Name",
                "count": 1 if lead.get("business_name") else 0,
                "badge": lead.get("business_name", "N/A"),
                "description": "Target company name"
            },
            {
                "pill": "@lead.city",
                "label": "City / Location",
                "count": 1 if lead.get("city") else 0,
                "badge": lead.get("city", "N/A"),
                "description": "Geographical location"
            },
            {
                "pill": "@notes.all",
                "label": "Internal Rep Notes",
                "count": len(notes),
                "badge": f"{len(notes)} notes",
                "description": "Manual internal consultant notes logged on lead"
            },
            {
                "pill": "@rep.context",
                "label": "Rep Prototype Briefing",
                "count": 1,
                "badge": "TACTICAL",
                "description": "Sales Rep tactical guidance: primary workflow, must-have screens & closing hook"
            }
        ]

        # 5. Repository & Local Workspace Files
        repo_files = DataPillResolver.scan_lead_workspace_files(lead_id)
        repo_file_pills = []
        for rf in repo_files[:40]:  # Top 40 files in autocomplete dropdown
            repo_file_pills.append({
                "pill": rf["tag"],
                "tag": rf["tag"],
                "label": rf["label"],
                "path": rf["path"],
                "badge": rf.get("badge", "FILE"),
                "description": rf.get("desc", ""),
                "insert": rf["insert"],
                "category": "Repository File",
                "icon": "📄"
            })

        # 6. Legacy / Raw Files
        file_pills = [
            {
                "pill": "@files.all",
                "label": "All Attached Files",
                "count": len(repo_files),
                "badge": f"{len(repo_files)} files",
                "description": "All uploaded spreadsheets, markdown specs, and prototypes"
            }
        ]

        categories = [
            {"title": "Repository Files", "icon": "📁", "items": repo_file_pills},
            {"title": "WhatsApp Inboxes", "icon": "📱", "items": wa_pills},
            {"title": "Call Transcriptions", "icon": "🎙️", "items": call_pills},
            {"title": "Lead Identity & Profile", "icon": "👤", "items": profile_pills},
            {"title": "Meta Ad Attribution", "icon": "🎯", "items": meta_pills},
            {"title": "Attached Files & Sheets", "icon": "📎", "items": file_pills}
        ]

        # Flat list for frontends consuming available_pills directly
        available_pills = []
        for cat in categories:
            for item in cat.get("items", []):
                pill_tag = item.get("pill") or item.get("tag")
                available_pills.append({
                    "tag": pill_tag,
                    "label": item.get("label") or pill_tag,
                    "badge": item.get("badge"),
                    "preview": item.get("description") or item.get("desc") or "",
                    "category": cat.get("title"),
                    "icon": item.get("icon") or cat.get("icon"),
                    "insert": item.get("insert") or f"{pill_tag} "
                })

        return {
            "lead_id": lead_id,
            "lead_name": lead.get("name"),
            "business_name": lead.get("business_name"),
            "available_pills": available_pills,
            "categories": categories,
            "files": repo_files
        }

    @staticmethod
    def resolve_prompt_pills(lead_id: str, prompt_template: str) -> Dict[str, Any]:
        """
        Parses all @-tokens in the prompt, fetches data, and substitutes them.
        Returns resolved prompt text and extraction metadata.
        """
        lead = Repository.get_lead(lead_id) or {}
        if not lead:
            return {
                "resolved_prompt": prompt_template,
                "resolved_pills": {},
                "missing_pills": ["lead_not_found"],
                "lead": {}
            }

        calls = Repository.get_lead_calls(lead_id) or []
        wa_messages = Repository.get_lead_whatsapp_messages(lead_id) or []
        notes = Repository.get_lead_notes(lead_id) or []

        resolved_pills = {}
        missing_pills = []

        # Find all @tokens: matches @category.sub or @category (excluding trailing punctuation)
        tokens = set(re.findall(r'@([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)*)', prompt_template))

        for token in tokens:
            full_token = f"@{token}"
            val = None

            # --- WHATSAPP PILLS ---
            if token == "whatsapp.all":
                if wa_messages:
                    lines = []
                    for m in wa_messages[-25:]:
                        acc = "Central Line" if m.get("account_phone") == CENTRAL_PHONE else "Personal Line"
                        sender = "Client" if m.get("direction") == "incoming" else "Zero7 Rep"
                        lines.append(f"[{acc} - {sender} ({m.get('timestamp', '')[:16]})]: {m.get('message_text', '')}")
                    val = "\n".join(lines)
                else:
                    val = "[Notice: No WhatsApp conversation history logged for this lead.]"
                    missing_pills.append(full_token)

            elif token == "whatsapp.central":
                c_msgs = [m for m in wa_messages if m.get("account_phone") == CENTRAL_PHONE]
                if c_msgs:
                    lines = [f"[Client: {m.get('message_text')}]" if m.get("direction") == "incoming" else f"[Zero7: {m.get('message_text')}]" for m in c_msgs[-20:]]
                    val = "\n".join(lines)
                else:
                    val = "[Notice: No messages found on the Central Zero7 WhatsApp line.]"
                    missing_pills.append(full_token)

            elif token == "whatsapp.personal":
                p_msgs = [m for m in wa_messages if m.get("account_phone") == PERSONAL_PHONE]
                if p_msgs:
                    lines = [f"[Client: {m.get('message_text')}]" if m.get("direction") == "incoming" else f"[Zero7: {m.get('message_text')}]" for m in p_msgs[-20:]]
                    val = "\n".join(lines)
                else:
                    val = "[Notice: No messages found on the Personal WhatsApp line.]"
                    missing_pills.append(full_token)

            # --- CALL TRANSCRIPTS PILLS ---
            elif token == "transcripts.all":
                tx_calls = [c for c in calls if c.get("transcription_text")]
                if tx_calls:
                    # Hierarchical Transcript Budgeting:
                    # Latest call is kept verbatim. Older calls are condensed if total chars > 30,000.
                    blocks = []
                    total_chars = sum(len(c.get("transcription_text", "")) for c in tx_calls)
                    is_budgeted = total_chars > 30000

                    for idx, c in enumerate(tx_calls):
                        called_at = c.get("called_at") or "Call"
                        dur = c.get("duration_minutes") or 0
                        raw_tx = c.get("transcription_text", "").strip()
                        outcome = c.get("outcome") or "Completed"
                        notes = c.get("notes") or ""

                        if idx == 0 or not is_budgeted:
                            blocks.append(f"--- CALL TRANSCRIPT ({called_at}, {dur}m, Outcome: {outcome}) ---\n{raw_tx}")
                        else:
                            excerpt = raw_tx[:700] + ("..." if len(raw_tx) > 700 else "")
                            blocks.append(f"--- PREVIOUS CALL EXCERPT ({called_at}, {dur}m, Outcome: {outcome}) ---\nNotes: {notes}\nExcerpt: {excerpt}")

                    val = "\n\n".join(blocks)
                    if is_budgeted:
                        val = f"[Context Budget Active: Latest call verbatim; {len(tx_calls)-1} older call(s) condensed to preserve token window]\n\n" + val
                else:
                    val = "[Notice: No audio call transcripts available for this lead.]"
                    missing_pills.append(full_token)

            elif token == "call.latest":
                tx_calls = [c for c in calls if c.get("transcription_text")]
                if tx_calls:
                    latest = tx_calls[0]
                    val = f"--- LATEST CALL TRANSCRIPT ({latest.get('called_at')}, {latest.get('duration_minutes')}m) ---\n{latest.get('transcription_text')}"
                else:
                    val = "[Notice: No audio call recordings have been transcribed yet.]"
                    missing_pills.append(full_token)

            elif token.startswith("call."):
                call_id = token.replace("call.", "")
                matched = next((c for c in calls if call_id in c.get("id", "")), None)
                if matched and matched.get("transcription_text"):
                    val = f"--- CALL TRANSCRIPT ({matched.get('called_at')}) ---\n{matched.get('transcription_text')}"
                else:
                    val = f"[Notice: Call transcript for '{call_id}' not found.]"
                    missing_pills.append(full_token)

            # --- LEAD PROFILE PILLS ---
            elif token == "lead.profile":
                deal_val = int(lead.get('deal_value') or 0)
                val = f"""LEAD PROFILE:
- Contact Name: {lead.get('name', 'N/A')}
- Business / Company: {lead.get('business_name', 'Independent')}
- City / Region: {lead.get('city', 'India')}
- Phone: {lead.get('phone', 'N/A')}
- Email: {lead.get('email', 'N/A')}
- Temperature: {lead.get('temperature', 'warm')}
- Call Stage: {lead.get('call_stage', 'first_call')}
- Deal Potential: ₹{deal_val:,}"""

            elif token == "lead.name":
                val = lead.get("name") or "Valued Partner"

            elif token == "lead.business_name":
                val = lead.get("business_name") or "Enterprise Client"

            elif token == "lead.city":
                val = lead.get("city") or "India"

            # --- META ATTRIBUTION PILLS ---
            elif token == "meta.form_answers":
                ch_data = lead.get("channel_data") or {}
                if isinstance(ch_data, str):
                    try: ch_data = json.loads(ch_data)
                    except Exception: ch_data = {}
                qna = ch_data.get("form_answers") or []
                if qna:
                    val = "\n".join([f"- {a.get('question')}: {a.get('answer')}" for a in qna if a.get('question')])
                else:
                    val = "[Notice: No Meta Ad form questionnaire responses on file.]"
                    missing_pills.append(full_token)

            elif token == "notes.all":
                if notes:
                    val = "\n".join([f"- ({n.get('created_at', '')[:10]}): {n.get('content') or n.get('notes')}" for n in notes[:8]])
                else:
                    val = "[Notice: No internal notes recorded yet.]"
                    missing_pills.append(full_token)

            # --- SALES REP TACTICAL PROTOTYPE BRIEFING PILL ---
            elif token in ("rep.context", "rep.brief", "prototype.brief"):
                rep_ctx = Repository.get_prototype_rep_context(lead_id)
                if rep_ctx and any(rep_ctx.values()):
                    screens = rep_ctx.get("key_screens", [])
                    screens_str = ", ".join(screens) if isinstance(screens, list) else str(screens)
                    val = f"""SALES REP TACTICAL BRIEFING & PROTOTYPE MUST-HAVES:
- Target Primary Workflow: {rep_ctx.get('primary_workflow', 'Core Operational Flow')}
- Critical Required Screens / Features: {screens_str}
- Rep's Tactical Note & Closing Hook: {rep_ctx.get('tactical_notes', 'N/A')}
- Target Viewport: {rep_ctx.get('target_viewport', 'Desktop')}
- Brand & UI Aesthetic: {rep_ctx.get('visual_style', 'Zero7 Dark Modern')}
- Briefed By: {rep_ctx.get('briefed_by', 'Sales Rep')} ({rep_ctx.get('briefed_at', '')[:16]})
"""
                else:
                    val = "[Notice: No sales rep tactical context logged yet for this prototype. Using general lead intelligence.]"
                    missing_pills.append(full_token)

            # --- FILES PILLS ---
            elif token == "files.all":
                all_files = DataPillResolver.scan_lead_workspace_files(lead_id)
                if all_files:
                    file_lines = [f"- `{f['path']}` ({f['size_fmt']})" for f in all_files[:30]]
                    val = "CLIENT REPOSITORY & WORKSPACE FILES:\n" + "\n".join(file_lines)
                else:
                    val = "[Notice: No client files or workspace directory found.]"
                    missing_pills.append(full_token)

            elif token.startswith("file."):
                file_slug = token.replace("file.", "")
                val = f"[File Attachment: {file_slug} mapped to lead workspace raw_files]"

            if val is not None:
                resolved_pills[full_token] = val

        # --- VAULT & REPOSITORY FILE PILLS RESOLUTION (@file:path or @path.ext) ---
        files_found = []
        explicit_file_matches = re.findall(r'@file:([a-zA-Z0-9_\-./]+)', prompt_template)
        shorthand_file_matches = re.findall(r'@([a-zA-Z0-9_\-./]+\.(?:md|csv|html|json|py|txt|sql|ts|tsx|js|jsx|pdf|xlsx|zip))', prompt_template)
        
        all_file_refs = set(explicit_file_matches + shorthand_file_matches)
        proj_path = lead.get("project_path")
        if not proj_path or not os.path.exists(proj_path):
            slug = _slugify(lead.get("business_name") or lead.get("name") or lead_id)
            candidates = [
                os.path.join(PROJECTS_ROOT, f"client-{slug}"),
                os.path.join(PROJECTS_ROOT, slug),
                os.path.join(PROJECTS_ROOT, lead.get("business_name") or "")
            ]
            for c in candidates:
                if c and os.path.exists(c):
                    proj_path = c
                    break

        for fref in all_file_refs:
            fref_clean = fref.strip().lstrip('/')
            tag_used = f"@file:{fref_clean}" if f"@file:{fref_clean}" in prompt_template else f"@{fref_clean}"
            
            content = None
            abs_path = None
            size_fmt = ""
            
            if proj_path and os.path.exists(proj_path):
                candidate_paths = [
                    os.path.join(proj_path, fref_clean.replace('/', os.sep)),
                    os.path.join(proj_path, "Project", fref_clean.replace('/', os.sep)),
                    os.path.join(proj_path, "raw_files", fref_clean.replace('/', os.sep)),
                ]
                for cp in candidate_paths:
                    if os.path.exists(cp) and os.path.isfile(cp):
                        abs_path = cp
                        break
            
            if abs_path and os.path.exists(abs_path):
                size = os.path.getsize(abs_path)
                size_fmt = _format_size(size)
                ext = os.path.splitext(abs_path)[1].lower()
                
                if ext in {'.pdf', '.xlsx', '.xls', '.zip', '.tar', '.gz', '.mp3', '.mp4', '.wav', '.png', '.jpg'}:
                    content = f"""### Attached Binary File: {fref_clean}
- **Local Workspace Path**: `{abs_path}`
- **File Size**: {size_fmt}
- **Inspection Instruction**: This is a binary document/archive. Inspect or extract its contents on disk using local terminal commands or python scripts."""
                else:
                    try:
                        with open(abs_path, 'r', encoding='utf-8', errors='replace') as f:
                            raw_text = f.read(51200)
                        truncated_note = "\n\n*(File content truncated at 50 KB)*" if size > 51200 else ""
                        ext_lang = ext.lstrip('.') or 'text'
                        content = f"""### Attached Vault File: {fref_clean} ({size_fmt})
```{ext_lang}
{raw_text}{truncated_note}
```"""
                    except Exception as e:
                        content = f"[Attached File '{fref_clean}': Error reading local file: {str(e)}]"
                
                files_found.append({"path": fref_clean, "source": "workspace", "size": size_fmt, "local_path": abs_path})
            else:
                # Fallback to GitHub API
                gh_url = lead.get("github_repo_url")
                if gh_url:
                    try:
                        from backend.integrations.github_vault import get_github_file_content
                        gh_text = get_github_file_content(gh_url, fref_clean)
                        if gh_text is not None:
                            ext = os.path.splitext(fref_clean)[1].lower()
                            size_bytes = len(gh_text.encode('utf-8'))
                            size_fmt = _format_size(size_bytes)
                            truncated_note = "\n\n*(File content truncated at 50 KB)*" if size_bytes > 51200 else ""
                            ext_lang = ext.lstrip('.') or 'text'
                            content = f"""### Attached GitHub File: {fref_clean} ({size_fmt})
```{ext_lang}
{gh_text[:51200]}{truncated_note}
```"""
                            files_found.append({"path": fref_clean, "source": "github", "size": size_fmt})
                    except Exception:
                        pass
            
            if content is not None:
                resolved_pills[tag_used] = content
            else:
                missing_pills.append(tag_used)
                resolved_pills[tag_used] = f"[Attached File: '{fref_clean}' could not be found in local workspace or GitHub repo]"

        # Substitute all pills into the prompt
        resolved_prompt = prompt_template
        for token_key, replacement in resolved_pills.items():
            resolved_prompt = resolved_prompt.replace(token_key, str(replacement))

        return {
            "resolved_prompt": resolved_prompt,
            "resolved_pills": resolved_pills,
            "files_found": files_found,
            "missing_pills": missing_pills,
            "lead": lead
        }

    @staticmethod
    def build_turn0_dossier(lead_id: str) -> str:
        lead = Repository.get_lead(lead_id) or {}
        if not lead:
            return ""
        
        biz_name = lead.get("business_name") or lead.get("name") or "Client"
        contact_name = lead.get("name") or "Unknown"
        phone = lead.get("phone") or "N/A"
        city = lead.get("city") or "N/A"
        priority = (lead.get("priority") or "unexplored").upper()
        temp = (lead.get("temperature") or "warm").upper()
        stage = lead.get("call_stage") or "First Call"
        
        brief = Repository.get_company_brief(lead_id) or {}
        brief_overview = brief.get("company_overview") or brief.get("overview") or ""
        bottlenecks = brief.get("bottlenecks") or brief.get("operational_bottlenecks") or ""
        pitch_hook = brief.get("pitch_hook") or ""
        
        calls = Repository.get_lead_calls(lead_id) or []
        recent_calls = []
        for c in calls[:2]:
            outcome = c.get("outcome") or "Call logged"
            notes = (c.get("notes") or "").strip()
            if notes:
                recent_calls.append(f"[{outcome}]: {notes[:140]}")
        
        notes_list = Repository.get_lead_notes(lead_id) or []
        recent_notes = []
        for n in notes_list[:2]:
            content = (n.get("content") or "").strip()
            if content:
                recent_notes.append(f"{content[:120]}")
        
        lines = [
            "=== CLIENT EXECUTIVE DOSSIER (Turn-0 Context -- Instant Intelligence) ===",
            f"- Client: {biz_name} | Contact: {contact_name} ({phone}) | Location: {city}",
            f"- Status: {priority} Priority | Temp: {temp} | Call Stage: {stage}",
        ]
        if brief_overview:
            lines.append(f"- Business Overview: {brief_overview[:200]}")
        if bottlenecks:
            lines.append(f"- Core Bottlenecks: {bottlenecks[:250]}")
        if pitch_hook:
            lines.append(f"- Pitch Hook / Deliverable: {pitch_hook[:180]}")
        if recent_calls:
            lines.append("- Recent Calls:\n  * " + "\n  * ".join(recent_calls))
        if recent_notes:
            lines.append("- Quick Notes:\n  * " + "\n  * ".join(recent_notes))
        lines.append("========================================================================\n")
        return "\n".join(lines)

    @staticmethod
    def resolve(lead_id: str, prompt_template: str) -> str:
        """Convenience method returning directly the resolved prompt string with auto turn-0 dossier."""
        res = DataPillResolver.resolve_prompt_pills(lead_id, prompt_template)
        resolved = res.get("resolved_prompt", prompt_template)
        
        # If the resolved prompt doesn't already contain a client profile or dossier, auto-inject Turn-0 Dossier
        if "=== CLIENT" not in resolved and "=== LEAD" not in resolved:
            dossier = DataPillResolver.build_turn0_dossier(lead_id)
            if dossier:
                resolved = f"{dossier}\n{resolved}"
        return resolved

