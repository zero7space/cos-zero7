"""
Zero7 CRM — Universal GitHub Vault & Multi-AI Scaffolding Service
Provisions a private GitHub repository for a qualified lead containing:
  - Universal identity manifest (zero7.json)
  - Tool rules for Claude Code (CLAUDE.md), Cursor (.cursorrules), Codex (AGENTS.md)
  - Antigravity custom skills (.agents/skills/subdomain-provisioner/)
  - Living client knowledge base (context/brief.md, context/transcripts/)
  - Session logs as code (conversations/)
  - Versioned prototype deliverables (prototypes/index.html)
"""

import os
import re
import json
import base64
import datetime
import subprocess
import urllib.request
import urllib.error
import ssl
import threading
from typing import Dict, Any, List, Optional

from backend.database import Repository

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    _env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), ".env")
    if os.path.exists(_env_path):
        with open(_env_path, "r", encoding="utf-8") as _f:
            for _line in _f:
                _line = _line.strip()
                if _line and not _line.startswith("#") and "=" in _line:
                    _k, _v = _line.split("=", 1)
                    os.environ.setdefault(_k.strip(), _v.strip())

GITHUB_API_URL = "https://api.github.com"
DEFAULT_ORG = os.environ.get("GITHUB_ORG", "Zero7AILab")
GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN", "")
USER_HOME = os.path.expanduser("~")

def get_canonical_projects_root() -> str:
    """
    Resolves OS-agnostic canonical projects directory for Zero7 client vaults.
    Priority:
    1. ZERO7_PROJECTS_DIR environment variable
    2. Standard Desktop directory if ~/Desktop exists
    3. ~/Zero7/Projects fallback (clean cross-platform path for Linux/macOS/Droplet)
    """
    env_dir = os.environ.get("ZERO7_PROJECTS_DIR")
    if env_dir:
        return os.path.abspath(env_dir)

    desktop_projects = os.path.join(USER_HOME, "Desktop", "zero7 Consultancy", "Projects")
    if os.path.exists(os.path.join(USER_HOME, "Desktop")):
        return desktop_projects

    return os.path.join(USER_HOME, "Zero7", "Projects")

PROJECTS_ROOT = get_canonical_projects_root()

ssl_ctx = ssl.create_default_context()
ssl_ctx.check_hostname = False
ssl_ctx.verify_mode = ssl.CERT_NONE

def ensure_git_exe():
    import shutil
    if shutil.which("git"):
        return "git"
    candidates = [
        os.path.join(USER_HOME, "AppData", "Local", "Microsoft", "WinGet", "Packages", "Git.MinGit_Microsoft.Winget.Source_8wekyb3d8bbwe", "cmd"),
        r"C:\Program Files\Git\cmd",
        r"C:\Program Files (x86)\Git\cmd",
    ]
    for c in candidates:
        if os.path.exists(os.path.join(c, "git.exe")):
            if c not in os.environ.get("PATH", ""):
                os.environ["PATH"] = c + os.pathsep + os.environ.get("PATH", "")
            return os.path.join(c, "git.exe")
    return "git"

ensure_git_exe()


def slugify(text: str) -> str:
    """Converts a company or lead name to a safe URL and repository slug."""
    text = (text or "client").lower().strip()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[\s_-]+", "-", text)
    return text.strip("-") or "client"


def format_client_project_name(business_name: Optional[str], person_name: Optional[str]) -> str:
    """
    Constructs a clear, human-readable project display name combining both company name and person name.
    Ensures that when a client enters a 1-letter or cryptic company name (e.g. 'J'), the project
    is identified with both company and contact person: 'J - Jahnavi'.
    """
    biz = (business_name or "").strip()
    person = (person_name or "").strip()
    generic_biz = {"none", "n/a", "na", "null", "nil", "self", "self employed", "self-employed", "individual", "freelancer", "services"}

    if biz and person:
        if biz.lower() == person.lower():
            return person
        if biz.lower() in generic_biz:
            return f"{person} ({biz.title()})"
        return f"{biz} - {person}"
    elif biz:
        return biz
    elif person:
        return person
    return "Client"


def format_client_project_slug(business_name: Optional[str], person_name: Optional[str]) -> str:
    """
    Generates a clean filesystem directory slug, e.g.:
    'J', 'Jahnavi' -> 'client-j-jahnavi'
    'Burosys', 'Nipun' -> 'client-burosys-nipun'
    """
    name = format_client_project_name(business_name, person_name)
    clean = re.sub(r'[^a-zA-Z0-9_\-\s]', '', name.lower())
    clean = re.sub(r'[\s_\-]+', '-', clean).strip('-')
    clean = re.sub(r'-+', '-', clean)
    if not clean.startswith("client-"):
        clean = f"client-{clean}"
    return clean


def get_client_project_path(client_name: str, person_name: Optional[str] = None) -> str:
    """Returns canonical local project vault path for a client across all machines and operating systems."""
    if person_name:
        slug = format_client_project_slug(client_name, person_name)
        return os.path.join(get_canonical_projects_root(), slug)
    slug = slugify(client_name)
    return os.path.join(get_canonical_projects_root(), f"client-{slug}")


def generate_vault_scaffold(
    lead: Dict[str, Any],
    brief: Optional[Dict[str, Any]] = None,
    calls: Optional[List[Dict[str, Any]]] = None,
    drive_info: Optional[Dict[str, Any]] = None
) -> Dict[str, str]:
    """
    Generates the complete virtual file tree for a new client repository.
    Returns a dictionary of { relative_path: file_content_string }.
    """
    lead_id = lead.get("id") or "lead"
    client_name = lead.get("business_name") or lead.get("name") or "Client"
    slug = slugify(lead.get("business_name") or lead.get("name") or lead_id)
    city = lead.get("city") or "India"
    driver = lead.get("assigned_to") or "unassigned"
    now_iso = datetime.datetime.now().isoformat()
    now_date = datetime.date.today().strftime("%Y-%m-%d")

    # Resolve Drive info
    drive_data = drive_info or {}
    drive_folder_id = drive_data.get("client_folder_id") or lead.get("drive_folder_id") or ""
    drive_folder_url = drive_data.get("client_folder_url") or lead.get("drive_folder_url") or (f"https://drive.google.com/drive/folders/{drive_folder_id}" if drive_folder_id else "")
    subfolders = drive_data.get("subfolders") or {}

    # 1. zero7.json - The Universal Project Manifest
    zero7_json = {
        "schema_version": "1.0",
        "lead_id": lead_id,
        "client_slug": slug,
        "business_name": client_name,
        "city": city,
        "crm_api": "https://cos.zero7.space/api",
        "mcp_server": "https://cos.zero7.space/api/mcp/sse",
        "subdomain": lead.get("subdomain") or f"proto-{slug}.zero7.space",
        "drive_folder_id": drive_folder_id,
        "drive_folder_url": drive_folder_url,
        "assigned_driver": driver,
        "created_at": now_iso
    }

    # 2. .gitignore - Strict Zero-Binary Rule
    gitignore_content = """# Environments & Secrets
.env
.env.*
*.env
auth_*/
tokens.json
*credentials*.json
*.pem
*.key

# OS & Editor
.DS_Store
Thumbs.db
.vscode/
.idea/

# Dependencies & Build Cache
node_modules/
__pycache__/
*.pyc
.pytest_cache/
dist/
build/
.next/
.turbo/

# ─── STRICT ZERO-BINARY GIT RULE ───
# All raw audio, video walkthroughs, and heavy binaries belong in Google Drive!
# Consult context/media_manifest.json for permanent Google Drive streaming URLs.
*.mp4
*.mov
*.avi
*.mkv
*.webm
*.mp3
*.wav
*.ogg
*.m4a
*.flac
*.aac
*.zip
*.tar
*.gz
*.iso
*.dmg
*.exe
*.bin
"""

    # 3. .gitattributes - Uniform Line Endings & Merge Conflict Elimination
    gitattributes_content = """# ─── ZERO7 UNIVERSAL GIT ATTRIBUTES ───
# 1. Enforce uniform LF line endings across Windows, macOS, and Linux
* text=auto eol=lf

# 2. Merge=union on append-only collaborative logs (eliminates merge conflicts across founders & AI agents)
context/decisions.md merge=union
conversations/** merge=union
context/media_manifest.json merge=union
"""

    # 4. .cursorignore & .aiignore - AI Context Window Token Protection
    aiignore_content = """# ─── ZERO7 AI CONTEXT TOKEN PROTECTION ───
# Exclude heavy dependencies, caches, build artifacts, and system files from AI context scanning
node_modules/
.next/
dist/
build/
out/
.turbo/
.cache/
__pycache__/
*.pyc
.pytest_cache/
.git/
.svn/
.hg/
*.log
*.tmp
*.min.js
*.min.css
package-lock.json
yarn.lock
pnpm-lock.yaml
"""

    # 5. CLAUDE.md - Rules for Claude Code CLI
    claude_md = f"""# Zero7 AI Rules: {client_name}
> Client Slug: `{slug}` | Lead ID: `{lead_id}`

## Core Philosophy
You are pair programming on a live client project for Zero7 Consultancy.
Always prioritize working, standalone prototypes with sleek UI adhering to Zero7 design tokens.

## Knowledge & Context
- Living Client Brief: `context/brief.md`
- Architecture Decisions: `context/decisions.md`
- Previous AI Sessions: `conversations/`
- Call Transcripts: `context/transcripts/`
- Media & Binary Manifest (Google Drive): `context/media_manifest.json`

## Media & Google Drive (Strict Zero-Binary Git Rule)
- Google Drive Client Vault: [{drive_folder_url or 'Available in context/media_manifest.json'}]({drive_folder_url or 'https://drive.google.com'})
- NEVER commit audio, video, or large binary files to Git (keep repo lightweight < 20 MB).
- Audio and video recordings are stored in Google Drive:
  - Call Recordings: `01_Call_Recordings`
  - WhatsApp Media: `02_WhatsApp_Media` (voice notes, documents, images)
  - SOWs & Proposals: `03_Proposals_and_SOW`
  - Marketing & Creatives: `04_Marketing_and_Ads`
  - Deliverables & Demos: `05_Deliverables_and_Demos`
- Consult `context/media_manifest.json` for live streaming/view links and file metadata.
- Transcripts with speaker diarization are in `context/transcripts/*.md`.

## Offline & Graceful MCP Fallback
- Connect to Zero7 CRM MCP at `https://cos.zero7.space/api/mcp/sse` when online.
- IF the CRM or MCP server is offline, unreachable, or you are working in-flight:
  DO NOT halt or fail. Fall back gracefully to local Markdown repository files:
  1. `zero7.json` for client ID and parameters.
  2. `context/brief.md` for client specs, tech stack, and pain points.
  3. `context/transcripts/` for historical call dialogues.
  4. `context/decisions.md` for architectural constraints.

## Cross-Platform Path Portability & Team Sync
- Always use POSIX forward slashes (`/`) in all file references, markdown links, and manifests.
- Before starting work on shared repos, run `git pull --rebase origin main` to synchronize concurrent work.

## End of Session Protocol (MANDATORY)
Whenever you finish a feature, fix, or when the user says "wrap up", "done", or "commit":
1. Check `conversations/` and write a new Markdown recap:
   `conversations/{now_date}_<your-name>_<task-slug>.md`
   Format:
   - **Driver**: Who ran this task
   - **Goal**: What was requested
   - **Decisions**: Key choices made
   - **Deliverables**: List of files updated in `prototypes/`
   - **Next Steps**: What the other 2 founders should tackle next
2. Run: `git add . && git commit -m "feat(<task>): <summary>" && git push origin main`
"""

    # 6. .cursorrules - Rules for Cursor IDE
    cursorrules = f"""# Zero7 Cursor Rules: {client_name}
- Read `context/brief.md` before making architectural suggestions.
- Ensure all prototypes in `prototypes/` are responsive, high-contrast, and include dark mode support.
- When creating prototypes, save numbered versions (`prototypes/v1_...html`, `prototypes/v2_...html`) and keep `prototypes/index.html` pointing to the latest version.
- STRICT ZERO-BINARY RULE: Do not commit audio/video binaries to Git. Refer to `context/media_manifest.json` for Google Drive links.
- OFFLINE FALLBACK: If Zero7 MCP is unreachable, operate autonomously using `zero7.json`, `context/brief.md`, and `context/decisions.md`.
- PORTABILITY: Always use forward slashes (`/`) for relative file paths across Windows, macOS, and Linux.
- Before concluding, write a quick recap in `conversations/{now_date}_cursor_<task>.md`.
"""

    # 7. AGENTS.md - Instructions for OpenAI Codex / Copilot / Cloud Code
    agents_md = f"""# Zero7 Agent Guidelines: {client_name}
Lead ID: {lead_id} | Client: {client_name}

1. Consult `context/brief.md` for client pain points, tech requirements, and brand guidelines.
2. Prototypes must be completely self-contained (use CDNs for Tailwind/FontAwesome/React).
3. Media files are hosted in Google Drive and cataloged in `context/media_manifest.json`. Never commit binaries > 5MB.
4. Log all conversational summaries into `conversations/` for multi-founder synchronization.
5. If Cloud CRM or MCP is unreachable, fall back gracefully to local markdown files (`context/brief.md`, `decisions.md`, `transcripts/`).
6. All internal file references must use standard POSIX forward slashes (`/`).
"""


    # 6. context/brief.md - Living Company Brief
    brief_data = brief or {}
    overview = brief_data.get("overview") or f"{client_name} is a high-priority Zero7 consultancy client based in {city}."
    pain_points = brief_data.get("pain_points") or ["Needs interactive prototype for operational workflow.", "Requires rapid WhatsApp/mobile accessibility."]
    if isinstance(pain_points, str):
        pain_points = [pain_points]
    tech_stack = brief_data.get("tech_stack") or ["Tailwind CSS", "HTML5 / Vanilla JS", "REST API Backend"]
    if isinstance(tech_stack, str):
        tech_stack = [tech_stack]

    pain_points_md = "\n".join([f"- {p}" for p in pain_points])
    tech_stack_md = "\n".join([f"- {t}" for t in tech_stack])

    brief_md = f"""# Client Brief: {client_name}
- **Lead ID**: `{lead_id}`
- **Client Slug**: `{slug}`
- **City**: {city}
- **Assigned Driver**: {driver}
- **Last Updated**: {now_iso}

---

## 1. Company Overview
{overview}

---

## 2. Key Client Pain Points
{pain_points_md}

---

## 3. Recommended Technical Approach & Prototype Stack
{tech_stack_md}

---

## 4. Key Assets & Drive Repository
- **Google Drive Vault**: [{drive_folder_url or 'Provisioned on Cloud CRM'}]({drive_folder_url or 'https://drive.google.com'})
- **Cloud CRM Record**: [Open in COS Theta](https://cos.zero7.space/#leads)
- **Live Subdomain**: [{lead.get('subdomain') or f'proto-{slug}.zero7.space'}](https://{lead.get('subdomain') or f'proto-{slug}.zero7.space'})
- **Media & Binary Catalog**: `context/media_manifest.json`
"""

    # 7. context/decisions.md
    decisions_md = f"""# Architectural Decisions: {client_name}
Log of key technical and business agreements made between Zero7 founders and the client.

| Date | Topic | Decision Made | Driver |
| :--- | :--- | :--- | :--- |
| {now_date} | Project Initialization | Auto-provisioned Universal GitHub Vault & Subdomain. | {driver} |
"""

    # 8. context/handoff.md
    handoff_md = f"""# Founder Handoff Status: {client_name}
*Updated before and after client syncs to keep all 3 founders aligned.*

- **Current Active Driver**: {driver}
- **Next Client Milestone**: Prototype v1 Demonstration
- **Open Blockers / Questions**: None currently.
"""

    # 9. .agents/skills/subdomain-provisioner/SKILL.md
    subdomain_skill_md = """---
name: subdomain-provisioner
description: >-
  Provisions, registers, and verifies live prototype subdomains (e.g. proto-{client}.zero7.space)
  via Cloudflare DNS and Droplet Nginx routing. Use when deploying or publishing an interactive
  prototype for a Zero7 client.
---

# Subdomain Provisioner Skill

This skill allows the agent to publish a static or single-page HTML prototype to a live Zero7 subdomain.

## Instructions
1. Ensure the prototype is built in `prototypes/index.html`.
2. To publish or update the live preview, call the Cloud CRM publishing endpoint:
   `POST https://cos.zero7.space/api/leads/{lead_id}/publish-prototype`
   with the HTML content and target subdomain.
3. Verify that the URL returns HTTP 200.
"""

    # 10. prototypes/index.html - Starter Boilerplate
    starter_html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{client_name} — Zero7 Interactive Prototype</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');
    body {{ font-family: 'Plus Jakarta Sans', sans-serif; }}
  </style>
</head>
<body class="bg-slate-950 text-slate-100 min-h-screen flex flex-col justify-between p-6 md:p-12">
  <div class="max-w-4xl mx-auto w-full">
    <header class="flex items-center justify-between pb-8 border-b border-slate-800">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center text-slate-950 font-black text-xl shadow-lg shadow-emerald-500/20">
          Z7
        </div>
        <div>
          <h1 class="text-xl font-bold tracking-tight">{client_name}</h1>
          <p class="text-xs text-slate-400 font-medium">Interactive Prototype Workspace · Zero7</p>
        </div>
      </div>
      <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
        <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
        Sprint Active
      </span>
    </header>

    <main class="py-16 text-center">
      <div class="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-slate-900 border border-slate-800 text-emerald-400 mb-6 shadow-inner">
        <i class="fa-solid fa-code text-2xl"></i>
      </div>
      <h2 class="text-3xl font-extrabold text-white mb-4">Prototype v1 Workspace Initialized</h2>
      <p class="text-slate-400 max-w-lg mx-auto mb-8 text-sm leading-relaxed">
        This repository is mapped directly to Zero7 CRM. Use Antigravity, Claude Code, or Cursor to build and iterate this client application.
      </p>
      <div class="p-6 rounded-2xl bg-slate-900/60 border border-slate-800/80 text-left max-w-md mx-auto">
        <h3 class="text-xs font-bold text-slate-300 uppercase tracking-wider mb-3">Client Quick Context</h3>
        <p class="text-sm text-slate-300 mb-2"><strong class="text-slate-100">Location:</strong> {city}</p>
        <p class="text-sm text-slate-300 mb-2"><strong class="text-slate-100">Assigned Driver:</strong> {driver}</p>
        <p class="text-sm text-slate-300"><strong class="text-slate-100">Lead ID:</strong> <code>{lead_id}</code></p>
      </div>
    </main>
  </div>

  <footer class="text-center text-xs text-slate-500 py-6 border-t border-slate-800/60">
    Crafted by Zero7 Autonomous Multi-Agent Engineering Studio
  </footer>
</body>
</html>
"""

    # 11. README.md
    readme_md = f"""# {client_name} — Client Project Vault
> **Zero7 Consultancy** | Lead ID: `{lead_id}`

This repository contains all source code, interactive prototypes, living client context, and AI conversation session logs for **{client_name}**.

## Directory Layout
- **`.gitignore`**: Strict zero-binary filter guarding the repository.
- **`zero7.json`**: Universal Manifest linking this folder to Cloud CRM and Google Drive.
- **`context/`**: Living Knowledge Base (`brief.md`, call transcripts, architecture decisions).
- **`context/media_manifest.json`**: Catalog of Google Drive audio recordings, screen demos, and binary assets.
- **`conversations/`**: Multi-founder session transcripts in human-readable Markdown.
- **`prototypes/`**: Deliverable interactive applications and HTML prototypes.
- **`.agents/`**: Custom Antigravity skills.

## Google Drive Media Repository
Raw audio/video recordings and heavy documents are securely stored in Google Drive:
- **Client Drive Vault**: [{drive_folder_url or 'Drive Folder'}]({drive_folder_url or 'https://drive.google.com'})

## Quick Start
```bash
# Clone to your local machine
git clone <repo-url>

# Open in Antigravity or your preferred AI tool (Claude Code, Cursor, Codex)
```
"""

    scaffold = {
        ".gitignore": gitignore_content,
        ".gitattributes": gitattributes_content,
        ".cursorignore": aiignore_content,
        ".aiignore": aiignore_content,
        "zero7.json": json.dumps(zero7_json, indent=2),
        "CLAUDE.md": claude_md,
        ".cursorrules": cursorrules,
        "AGENTS.md": agents_md,
        "README.md": readme_md,
        "context/brief.md": brief_md,
        "context/decisions.md": decisions_md,
        "context/handoff.md": handoff_md,
        ".agents/skills/subdomain-provisioner/SKILL.md": subdomain_skill_md,
        "prototypes/index.html": starter_html,
        "conversations/.gitkeep": "# AI session logs stored here\n"
    }

    # 12. Add Transcripts if available
    if calls:
        for idx, call in enumerate(calls):
            c_id = call.get("id") or f"call_{idx+1}"
            c_date = (call.get("created_at") or now_date)[:10]
            c_notes = call.get("notes") or "Call completed."
            c_transcript = call.get("transcription_text") or call.get("transcript") or call.get("summary") or call.get("notes") or "No audio transcript recorded."
            drive_link = call.get("audio_drive_link") or call.get("drive_url") or call.get("recording_drive_url") or ""
            is_vid = bool(call.get("is_video") or (call.get("recording_mime_type") or "").startswith("video/"))
            is_internal = bool(call.get("is_internal") or str(call.get("call_type", "")).lower() == "internal")
            caller_name = call.get("caller_name") or call.get("user_name") or "Founder"
            teammate_name = call.get("teammate_name") or "Teammate"

            drive_header = (
                f"[🎥 Watch Video Meeting Recording on Google Drive]({drive_link})\n\n"
                if (is_vid and drive_link)
                else (f"[🎙️ Listen to Audio Recording on Google Drive]({drive_link})\n\n" if drive_link else "")
            )

            if is_internal:
                topic_str = call.get("outcome") or call.get("topic") or "Client Strategy, Requirements & Architecture"
                title_prefix = f"Internal Strategy Sync: {caller_name} & {teammate_name}"
                canonical_rel_path = f"context/transcripts/internal_syncs/{c_date}_{c_id}_internal_sync.md"
                mention_alias_path = f"context/transcripts/internal_syncs/{c_date}_{c_id}_mention.md"

                time_start = call.get("time_offset_start", 0)
                time_end = call.get("time_offset_end", 0)
                time_window_str = f"{time_start // 60:02d}:{time_start % 60:02d} - {time_end // 60:02d}:{time_end % 60:02d}" if (time_end > time_start) else "Full Call / Meeting"

                action_items_md = ""
                if call.get("action_items"):
                    action_items_md = f"\n---\n### Agreed Next Actions & Strategy\n{call.get('action_items')}\n"

                t_content = f"""# {title_prefix} ({c_date})
- **Participants**: {caller_name} & {teammate_name}
- **Topic**: {topic_str}
- **Date**: {call.get('created_at', now_iso)}
- **Outcome / Stage**: {call.get('outcome', 'Internal Sync')}
- **Time Offset Window**: {time_window_str}
- **Medium**: 🎙️ Internal Teammate Phone Call

---

{drive_header}### Deepgram Speech Transcript & Summary
{c_transcript}

---
### Meeting Notes
{c_notes}
{action_items_md}"""
                scaffold[mention_alias_path] = t_content
            else:
                title_prefix = "Video Meeting Transcript" if is_vid else "Client Discovery Call"
                canonical_rel_path = f"context/transcripts/client_calls/{c_date}_{c_id}_client_call.md"
                t_content = f"""# {title_prefix}: {c_date} ({c_id})
- **Client**: {client_name}
- **Date**: {call.get('created_at', now_iso)}
- **Outcome / Stage**: {call.get('outcome', 'Completed')}
- **Medium**: {'🎥 Google Meet / Screen Video' if is_vid else '🎙️ Phone Call (Audio)'}

---

{drive_header}### Deepgram Speech Transcript & Summary
{c_transcript}

---
### Meeting Notes
{c_notes}
"""
            # Canonical path
            scaffold[canonical_rel_path] = t_content
            # Backward-compatible flat alias
            scaffold[f"context/transcripts/{c_date}_{c_id}.md"] = t_content
            scaffold[f"context/call_transcripts/{c_date}_{c_id}.md"] = t_content

    # 13. Add Media Manifest (Google Drive Audio, Video Meetings, Documents, & Demo Videos)
    media_items = []
    if calls:
        for idx, call in enumerate(calls):
            c_id = call.get("id") or f"call_{idx+1}"
            c_date = (call.get("created_at") or now_date)[:10]
            drive_link = call.get("audio_drive_link") or call.get("drive_url") or call.get("recording_drive_url") or ""
            drive_fid = call.get("recording_drive_file_id") or ""
            dur = call.get("recording_duration_secs") or (call.get("duration_minutes", 0) * 60)
            is_vid = bool(call.get("is_video") or (call.get("recording_mime_type") or "").startswith("video/"))
            is_internal = bool(call.get("is_internal") or str(call.get("call_type", "")).lower() == "internal")
            caller_name = call.get("caller_name") or call.get("user_name") or "Founder"
            teammate_name = call.get("teammate_name") or "Teammate"

            if is_internal:
                call_type = "internal_sync"
                item_title = f"Internal Strategy Sync: {caller_name} & {teammate_name} ({c_date})"
                transcript_rel = f"context/transcripts/internal_syncs/{c_date}_{c_id}_internal_sync.md"
            else:
                call_type = "client_call"
                item_title = f"{'Video Meeting' if is_vid else 'Discovery Call'} ({c_date}) - {call.get('outcome', 'Completed')}"
                transcript_rel = f"context/transcripts/client_calls/{c_date}_{c_id}_client_call.md"

            media_items.append({
                "id": c_id,
                "category": "calls",
                "call_type": call_type,
                "type": "video_meeting" if is_vid else "call_recording",
                "is_video": is_vid,
                "is_internal": is_internal,
                "date": c_date,
                "title": item_title,
                "drive_file_id": drive_fid,
                "stream_url": drive_link,
                "drive_view_url": f"https://drive.google.com/file/d/{drive_fid}/view" if drive_fid else drive_link,
                "preview_url": f"https://drive.google.com/file/d/{drive_fid}/preview" if drive_fid else drive_link,
                "duration_secs": dur,
                "transcript_path": transcript_rel
            })

    # Ad Creatives attribution
    channel_data = lead.get("channel_data") or {}
    if isinstance(channel_data, str):
        try:
            channel_data = json.loads(channel_data)
        except Exception:
            channel_data = {}
    ad_creative = channel_data.get("creative") or channel_data.get("ad_creative") or {}
    if ad_creative and (ad_creative.get("stream_url") or ad_creative.get("preview_link") or ad_creative.get("file_id")):
        media_items.append({
            "id": f"ad_{ad_creative.get('file_id') or 'creative'}",
            "category": "creatives",
            "type": "ad_creative_video" if ad_creative.get("is_video") else "ad_creative_image",
            "is_video": bool(ad_creative.get("is_video")),
            "date": now_date,
            "title": ad_creative.get("title") or channel_data.get("ad_name") or "Inbound Meta Ad Creative",
            "drive_file_id": ad_creative.get("file_id") if not str(ad_creative.get("file_id", "")).startswith("local_") else "",
            "stream_url": ad_creative.get("stream_url") or "",
            "drive_view_url": ad_creative.get("web_view_link") or ad_creative.get("preview_link") or "",
            "preview_url": ad_creative.get("preview_link") or ad_creative.get("thumbnail_url") or ""
        })

    if lead.get("demo_video_url"):
        media_items.append({
            "id": "demo_video_01",
            "category": "deliverables",
            "type": "demo_video",
            "is_video": True,
            "date": now_date,
            "title": lead.get("demo_video_title") or "Client Prototype Demo Video",
            "stream_url": lead.get("demo_video_url"),
            "drive_view_url": lead.get("demo_video_url"),
            "preview_url": lead.get("demo_video_url")
        })

    media_manifest = {
        "client": client_name,
        "client_slug": slug,
        "lead_id": lead_id,
        "drive_folder_id": drive_folder_id,
        "drive_folder_url": drive_folder_url,
        "subfolders": subfolders,
        "last_synced_at": now_iso,
        "media_count": len(media_items),
        "assets": media_items
    }
    scaffold["context/media_manifest.json"] = json.dumps(media_manifest, indent=2)

    return scaffold


def create_github_repo(repo_name: str, description: str, org: Optional[str] = None, token: Optional[str] = None) -> Dict[str, Any]:
    """
    Creates a private repository on GitHub under the given organization or user.
    """
    auth_token = token or GITHUB_TOKEN
    if not auth_token:
        return {"error": "Missing GITHUB_TOKEN environment variable."}

    target_org = org or DEFAULT_ORG
    url = f"{GITHUB_API_URL}/orgs/{target_org}/repos" if target_org else f"{GITHUB_API_URL}/user/repos"
    
    payload = {
        "name": repo_name,
        "description": description,
        "private": True,
        "auto_init": False
    }

    headers = {
        "Authorization": f"Bearer {auth_token}",
        "Accept": "application/vnd.github.v3+json",
        "Content-Type": "application/json",
        "User-Agent": "Zero7-CRM-Vault-Provisioner"
    }

    req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=12, context=ssl_ctx) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return {
                "success": True,
                "html_url": data.get("html_url"),
                "clone_url": data.get("clone_url"),
                "ssh_url": data.get("ssh_url"),
                "full_name": data.get("full_name")
            }
    except urllib.error.HTTPError as e:
        # If org creation fails with 404, fallback to authenticated user repos
        if e.code == 404 and target_org:
            url_user = f"{GITHUB_API_URL}/user/repos"
            req_user = urllib.request.Request(url_user, data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST")
            try:
                with urllib.request.urlopen(req_user, timeout=12, context=ssl_ctx) as resp_user:
                    data = json.loads(resp_user.read().decode("utf-8"))
                    return {
                        "success": True,
                        "html_url": data.get("html_url"),
                        "clone_url": data.get("clone_url"),
                        "ssh_url": data.get("ssh_url"),
                        "full_name": data.get("full_name")
                    }
            except Exception as ex2:
                return {"error": f"GitHub user repo creation failed: {ex2}"}
        error_msg = e.read().decode("utf-8")
        return {"error": f"GitHub API error ({e.code}): {error_msg}"}
    except Exception as e:
        return {"error": str(e)}


def is_file_allowed_for_git(path: str, content_bytes_len: int = 0) -> tuple[bool, str]:
    """
    Validates that a file path and content are safe to commit to a Git vault.
    Enforces the Strict Zero-Binary Rule, Secret Prevention, and size constraints (< 5MB).
    """
    norm_path = path.replace("\\", "/").lower()
    base_name = os.path.basename(norm_path)

    # 1. Size constraint (< 5MB)
    if content_bytes_len > 5 * 1024 * 1024:
        return False, f"File exceeds maximum allowed size of 5MB ({round(content_bytes_len / (1024*1024), 2)}MB). Store heavy media in Google Drive."

    # 2. Secret & credential leak prevention
    secret_patterns = [
        r"^\.env($|\..*)",
        r".*credentials.*\.json$",
        r"^auth_.*",
        r".*\.(pem|key|pfx|p12)$",
        r"^tokens\.json$"
    ]
    for pat in secret_patterns:
        if re.search(pat, base_name):
            return False, f"Blocked potential secret/credential file from Git: {path}"

    # 3. Strict Zero-Binary Rule (audio/video/archives/executables)
    binary_exts = {
        ".mp4", ".mov", ".avi", ".mkv", ".webm",
        ".mp3", ".wav", ".ogg", ".m4a", ".flac", ".aac",
        ".zip", ".tar", ".gz", ".iso", ".dmg", ".exe", ".bin", ".dll", ".7z", ".rar"
    }
    ext = os.path.splitext(norm_path)[1]
    if ext in binary_exts:
        return False, f"Strict Zero-Binary Rule: Binary files ({ext}) belong in Google Drive, not Git. Catalog streaming link in context/media_manifest.json."

    return True, "OK"


def push_file_to_github(repo_full_name: str, path: str, content: str, token: str, commit_message: str = "Initial vault scaffolding") -> bool:
    """
    Pushes or updates a single file via the GitHub Contents API.
    Hardened with:
    - Pre-flight secret & binary guards (Zero-Binary Git Policy)
    - Automatic SHA discovery via GET to prevent HTTP 409 Conflict on file updates
    - Automatic normalized POSIX paths
    """
    norm_path = path.replace("\\", "/").lstrip("/")
    content_bytes = content.encode("utf-8")
    
    allowed, reason = is_file_allowed_for_git(norm_path, len(content_bytes))
    if not allowed:
        print(f"[GITHUB PUSH GUARD] Refusing to push '{norm_path}' to {repo_full_name}: {reason}")
        return False

    url = f"{GITHUB_API_URL}/repos/{repo_full_name}/contents/{norm_path}"
    encoded = base64.b64encode(content_bytes).decode("utf-8")
    
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github.v3+json",
        "Content-Type": "application/json",
        "User-Agent": "Zero7-CRM-Vault-Provisioner"
    }

    # Fetch existing SHA if file already exists (prevents HTTP 409 Conflict on updates)
    existing_sha = None
    try:
        get_req = urllib.request.Request(url, headers=headers, method="GET")
        with urllib.request.urlopen(get_req, timeout=8, context=ssl_ctx) as get_resp:
            if get_resp.status == 200:
                data = json.loads(get_resp.read().decode("utf-8"))
                existing_sha = data.get("sha")
    except urllib.error.HTTPError as he:
        # HTTP 404 is expected for newly created files
        if he.code != 404:
            print(f"[GITHUB GET WARN] Status {he.code} when checking {norm_path}: {he.reason}")
    except Exception as e:
        print(f"[GITHUB GET ERROR] Could not verify existing file SHA for {norm_path}: {e}")

    payload = {
        "message": commit_message,
        "content": encoded
    }
    if existing_sha:
        payload["sha"] = existing_sha

    req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers, method="PUT")
    try:
        with urllib.request.urlopen(req, timeout=12, context=ssl_ctx) as resp:
            return resp.status in (200, 201)
    except urllib.error.HTTPError as he:
        err_body = he.read().decode("utf-8", errors="replace")
        print(f"[GITHUB PUT ERROR] HTTP {he.code} for {norm_path}: {err_body}")
        return False
    except Exception as e:
        print(f"[GITHUB PUT ERROR] Error pushing {norm_path}: {e}")
        return False


def register_antigravity_project(project_path: str, display_name: str) -> Optional[str]:
    """
    Automatically registers a newly provisioned client vault into Google Antigravity
    config on this host machine (~/.gemini/config/projects/<uuid>.json) so agents
    and developers can open and work on it immediately without manual setup.
    """
    import uuid
    config_dir = os.path.join(USER_HOME, ".gemini", "config", "projects")
    os.makedirs(config_dir, exist_ok=True)

    norm_path = os.path.normpath(project_path).replace("\\", "/")
    folder_uri_part = norm_path.replace(":", "%3A")
    if not folder_uri_part.startswith("/"):
        folder_uri_part = "/" + folder_uri_part
    folder_uri = f"file://{folder_uri_part}"

    # Check for existing config matching folderUri
    existing_id = None
    for fname in os.listdir(config_dir):
        if fname.endswith(".json"):
            fpath = os.path.join(config_dir, fname)
            try:
                with open(fpath, "r", encoding="utf-8") as jf:
                    cfg = json.load(jf)
                    for res in cfg.get("projectResources", {}).get("resources", []):
                        u = res.get("folderUri", "") or res.get("gitFolder", {}).get("folderUri", "")
                        if norm_path.lower() in u.lower().replace("%3a", ":"):
                            existing_id = cfg.get("id")
                            break
            except Exception:
                pass

    proj_id = existing_id or str(uuid.uuid4())
    config_file = os.path.join(config_dir, f"{proj_id}.json")

    antigravity_cfg = {
        "id": proj_id,
        "name": display_name,
        "projectResources": {
            "resources": [
                {
                    "gitFolder": {
                        "folderUri": folder_uri
                    }
                }
            ]
        },
        "permissionGrants": {
            "permissionGrants": {
                "allow": [
                    "read_url(*)",
                    "mcp(*)",
                    "command(python *)",
                    "command(node *)",
                    "command(powershell *)",
                    "command(git *)"
                ]
            }
        },
        "settings": {
            "fileAccessPolicy": "AGENT_SETTING_POLICY_ALLOW",
            "internetPolicy": "AGENT_SETTING_POLICY_ALLOW",
            "sandboxMode": False,
            "autoExecutionPolicy": "CASCADE_COMMANDS_AUTO_EXECUTION_EAGER",
            "artifactReviewMode": "ARTIFACT_REVIEW_MODE_TURBO"
        },
        "isWorkspaceOnly": False
    }

    with open(config_file, "w", encoding="utf-8") as cf:
        json.dump(antigravity_cfg, cf, indent=2)

    return config_file


def provision_local_vault(lead: Dict[str, Any], scaffold: Dict[str, str], base_dir: Optional[str] = None) -> str:
    """
    Creates the complete client vault folder on the host machine and runs git init.
    Enforces canonical clubbed slug, seeds package.json for Vercel, aligns Git author
    email with Vercel team account, and registers project into Antigravity engine.
    Returns the absolute path to the local project folder.
    """
    biz_name = lead.get("business_name")
    person_name = lead.get("name")
    slug = format_client_project_slug(biz_name, person_name)
    display_name = format_client_project_name(biz_name, person_name)

    target_root = base_dir or PROJECTS_ROOT
    project_path = os.path.join(target_root, slug)
    os.makedirs(project_path, exist_ok=True)

    # Write all scaffold files (ensuring LF line endings across OS)
    for rel_path, content in scaffold.items():
        full_path = os.path.join(project_path, rel_path.replace("/", os.sep))
        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        with open(full_path, "w", encoding="utf-8", newline="\n") as f:
            f.write(content)

    # Ensure root index.html exists for zero-config static hosting
    proto_index = os.path.join(project_path, "prototypes", "index.html")
    root_index = os.path.join(project_path, "index.html")
    if os.path.exists(proto_index) and not os.path.exists(root_index):
        import shutil
        shutil.copyfile(proto_index, root_index)

    # Ensure package.json exists with standard deploy script
    pkg_json = os.path.join(project_path, "package.json")
    if not os.path.exists(pkg_json):
        with open(pkg_json, "w", encoding="utf-8") as pf:
            json.dump({
                "name": slug,
                "version": "1.0.0",
                "private": True,
                "scripts": {
                    "deploy": "vercel --prod --yes"
                }
            }, pf, indent=2)

    # Initialize local git repository and align author email with Vercel account
    git_dir = os.path.join(project_path, ".git")
    if not os.path.exists(git_dir):
        try:
            subprocess.run(["git", "init"], cwd=project_path, capture_output=True, text=True, check=True)
            # CRITICAL: Align Git author with global Vercel account to prevent "● Blocked" deployment errors
            subprocess.run(["git", "config", "user.email", "zerosevenspace@gmail.com"], cwd=project_path, capture_output=True)
            subprocess.run(["git", "config", "user.name", "zerosevenspace"], cwd=project_path, capture_output=True)
            subprocess.run(["git", "add", "."], cwd=project_path, capture_output=True, text=True, check=True)
            subprocess.run(["git", "commit", "-m", "chore: initialize Zero7 universal client vault"], cwd=project_path, capture_output=True, text=True, check=True)
        except Exception:
            pass
    else:
        try:
            subprocess.run(["git", "config", "user.email", "zerosevenspace@gmail.com"], cwd=project_path, capture_output=True)
            subprocess.run(["git", "config", "user.name", "zerosevenspace"], cwd=project_path, capture_output=True)
        except Exception:
            pass

    # Automatically register project in Antigravity config
    try:
        register_antigravity_project(project_path, display_name)
    except Exception:
        pass

    return project_path


def _is_external_sync_disabled() -> bool:
    return os.environ.get("ZERO7_DISABLE_EXTERNAL_SYNC", "").strip().lower() in ("1", "true", "yes")


def provision_client_vault(lead_id: str, force_github: bool = False) -> Dict[str, Any]:
    """
    Main Orchestrator:
    1. Fetches lead, existing brief, and call transcripts.
    2. Ensures Google Drive hierarchical directory exists (01_Call_Recordings, etc.).
    3. Generates universal virtual scaffold with drive links and .gitignore.
    4. Creates local vault directory with git repo and Vercel author alignment.
    5. If GITHUB_TOKEN is available, provisions private GitHub repo and pushes initial commit.
    6. Updates leads table with github_repo_url, project_path, and drive_folder_id/url.
    7. Registers project into Antigravity projects config.
    """
    if _is_external_sync_disabled():
        return {"success": True, "skipped": True, "reason": "external_sync_disabled", "lead_id": lead_id}

    with _get_vault_lead_lock(lead_id):
        return _provision_client_vault_locked(lead_id, force_github=force_github)


def _provision_client_vault_locked(lead_id: str, force_github: bool = False) -> Dict[str, Any]:
    lead = Repository.get_lead(lead_id)
    if not lead:
        return {"error": "Lead not found"}

    brief = Repository.get_company_brief(lead_id)
    try:
        calls = Repository.get_lead_calls(lead_id)
    except Exception:
        calls = []

    biz_name = lead.get("business_name")
    person_name = lead.get("name")
    slug = format_client_project_slug(biz_name, person_name)
    display_name = format_client_project_name(biz_name, person_name)
    repo_name = slug

    # 1. Ensure Google Drive Client Hierarchy
    drive_info = {}
    drive_folder_id = lead.get("drive_folder_id")
    drive_folder_url = lead.get("drive_folder_url")
    try:
        from backend.integrations.google_drive import ensure_client_drive_hierarchy
        client_label = person_name or "Client"
        biz_label = biz_name or ""
        drive_info = ensure_client_drive_hierarchy(client_slug=slug, client_name=client_label, business_name=biz_label)
        if drive_info and drive_info.get("client_folder_id"):
            drive_folder_id = drive_info.get("client_folder_id")
            drive_folder_url = drive_info.get("client_folder_url")
    except Exception as drive_err:
        pass

    if not drive_info and drive_folder_id:
        drive_info = {
            "client_folder_id": drive_folder_id,
            "client_folder_url": drive_folder_url or f"https://drive.google.com/drive/folders/{drive_folder_id}"
        }

    scaffold = generate_vault_scaffold(lead, brief, calls, drive_info=drive_info)

    # 2. Always provision the local directory on the host PC
    local_path = provision_local_vault(lead, scaffold)

    github_url = lead.get("github_repo_url") or ""
    status = "local_ready"
    remote_info = {}

    # 3. If GitHub token is configured, provision GitHub repository
    token = os.environ.get("GITHUB_TOKEN", GITHUB_TOKEN)
    if token:
        desc = f"Zero7 Client Project Vault for {display_name}"
        gh_result = create_github_repo(repo_name, desc, org=DEFAULT_ORG, token=token)
        if gh_result.get("success"):
            github_url = gh_result.get("html_url")
            full_name = gh_result.get("full_name")
            status = "active"
            remote_info = gh_result

            # Push key files
            for rel_path, content in scaffold.items():
                push_file_to_github(full_name, rel_path, content, token)

            # Link local repo to GitHub origin
            try:
                subprocess.run(["git", "remote", "add", "origin", gh_result.get("clone_url")], cwd=local_path, capture_output=True)
            except Exception:
                pass
        else:
            status = "github_error"
            remote_info = gh_result
    else:
        status = "local_ready"

    # 4. Update lead in database with GitHub and Drive metadata
    update_data = {
        "project_path": local_path,
        "project_name": display_name,
        "github_repo_url": github_url,
        "github_repo_status": status
    }
    if drive_folder_id:
        update_data["drive_folder_id"] = drive_folder_id
        update_data["drive_folder_url"] = drive_folder_url
    Repository.update_lead(lead_id, update_data)

    return {
        "success": True,
        "lead_id": lead_id,
        "client_slug": slug,
        "display_name": display_name,
        "repo_name": repo_name,
        "local_path": local_path,
        "github_repo_url": github_url,
        "drive_folder_id": drive_folder_id,
        "drive_folder_url": drive_folder_url,
        "status": status,
        "remote_info": remote_info,
        "file_count": len(scaffold)
    }



def update_media_manifest_in_vault(lead_id: str) -> Dict[str, Any]:
    """
    Regenerates context/media_manifest.json for a lead after new recordings or media are added.
    Updates both local project folder and pushes to remote GitHub repository if active.
    """
    lead = Repository.get_lead(lead_id)
    if not lead:
        return {"error": "Lead not found"}

    brief = Repository.get_company_brief(lead_id)
    try:
        calls = Repository.get_lead_calls(lead_id)
    except Exception:
        calls = []

    slug = slugify(lead.get("business_name") or lead.get("name") or lead_id)
    drive_info = {
        "client_folder_id": lead.get("drive_folder_id"),
        "client_folder_url": lead.get("drive_folder_url")
    }

    scaffold = generate_vault_scaffold(lead, brief, calls, drive_info=drive_info)
    manifest_content = scaffold.get("context/media_manifest.json")
    if not manifest_content:
        return {"error": "Manifest generation failed"}

    # 1. Update on local disk if folder exists
    local_path = lead.get("project_path") or get_client_project_path(slug)
    manifest_local_path = os.path.join(local_path, "context", "media_manifest.json")
    if os.path.exists(local_path):
        os.makedirs(os.path.dirname(manifest_local_path), exist_ok=True)
        try:
            with open(manifest_local_path, "w", encoding="utf-8") as f:
                f.write(manifest_content)
        except Exception:
            pass

        # Also write all individual canonical transcripts (client_calls and internal_syncs)
        for rel_k, rel_content in scaffold.items():
            if rel_k.startswith("context/transcripts/"):
                t_full_path = os.path.join(local_path, rel_k.replace("/", os.sep))
                os.makedirs(os.path.dirname(t_full_path), exist_ok=True)
                try:
                    with open(t_full_path, "w", encoding="utf-8") as tf:
                        tf.write(rel_content)
                except Exception:
                    pass

    # 2. Push to GitHub if repository is configured
    gh_url = lead.get("github_repo_url")
    gh_pushed = False
    if gh_url:
        repo_fullname = parse_github_repo_fullname(gh_url)
        token = os.environ.get("GITHUB_TOKEN", GITHUB_TOKEN)
        if repo_fullname and token:
            gh_pushed = push_file_to_github(
                repo_fullname,
                "context/media_manifest.json",
                manifest_content,
                token,
                commit_message="chore(media): update media manifest catalog"
            )

    return {
        "success": True,
        "lead_id": lead_id,
        "manifest_path": manifest_local_path,
        "pushed_to_github": gh_pushed
    }


_VAULT_SYNC_GUARD = threading.Lock()
_VAULT_LEAD_LOCKS: Dict[str, threading.RLock] = {}


def _get_vault_lead_lock(lead_id: str) -> threading.RLock:
    with _VAULT_SYNC_GUARD:
        lock = _VAULT_LEAD_LOCKS.get(lead_id)
        if lock is None:
            lock = threading.RLock()
            _VAULT_LEAD_LOCKS[lead_id] = lock
        return lock


def sync_lead_brief_to_vault(lead_id: str) -> Dict[str, Any]:
    """
    Regenerates context/brief.md for a lead after CRM updates (to eliminate context drift).
    Updates local project folder and pushes to remote GitHub repository if active.
    """
    if _is_external_sync_disabled():
        return {"success": True, "skipped": True, "reason": "external_sync_disabled", "lead_id": lead_id}

    with _get_vault_lead_lock(lead_id):
        lead = Repository.get_lead(lead_id)
        if not lead:
            return {"error": "Lead not found"}

        brief = Repository.get_company_brief(lead_id)
        try:
            calls = Repository.get_lead_calls(lead_id)
        except Exception:
            calls = []

        slug = slugify(lead.get("business_name") or lead.get("name") or lead_id)
        drive_info = {
            "client_folder_id": lead.get("drive_folder_id"),
            "client_folder_url": lead.get("drive_folder_url")
        }

        scaffold = generate_vault_scaffold(lead, brief, calls, drive_info=drive_info)
        brief_content = scaffold.get("context/brief.md")
        if not brief_content:
            return {"error": "Brief generation failed"}

        # 1. Update on local disk if folder exists
        local_path = lead.get("project_path") or get_client_project_path(slug)
        brief_local_path = os.path.join(local_path, "context", "brief.md")
        if os.path.exists(local_path):
            os.makedirs(os.path.dirname(brief_local_path), exist_ok=True)
            try:
                with open(brief_local_path, "w", encoding="utf-8", newline="\n") as f:
                    f.write(brief_content)
            except Exception:
                pass

        # 2. Push to GitHub if repository is configured
        gh_url = lead.get("github_repo_url")
        gh_pushed = False
        if gh_url:
            repo_fullname = parse_github_repo_fullname(gh_url)
            token = os.environ.get("GITHUB_TOKEN", GITHUB_TOKEN)
            if repo_fullname and token:
                gh_pushed = push_file_to_github(
                    repo_fullname,
                    "context/brief.md",
                    brief_content,
                    token,
                    commit_message="docs(brief): sync lead updates from CRM"
                )

        return {
            "success": True,
            "lead_id": lead_id,
            "brief_path": brief_local_path,
            "pushed_to_github": gh_pushed
        }


def parse_github_repo_fullname(repo_or_url: str) -> Optional[str]:
    """Extracts 'owner/repo' from URL or returns 'owner/repo'."""
    if not repo_or_url:
        return None
    cleaned = repo_or_url.strip()
    if cleaned.startswith("http://") or cleaned.startswith("https://"):
        cleaned = re.sub(r"^https?://[^/]+/", "", cleaned)
    cleaned = cleaned.rstrip("/").rstrip(".git")
    parts = cleaned.split("/")
    if len(parts) >= 2:
        return f"{parts[-2]}/{parts[-1]}"
    return None


def get_github_repo_tree(repo_or_url: str, token: Optional[str] = None) -> List[Dict[str, Any]]:
    """
    Fetches the recursive file tree for a repository via GitHub API.
    Returns structured list of files.
    """
    repo_fullname = parse_github_repo_fullname(repo_or_url)
    if not repo_fullname:
        return []

    tk = token or os.environ.get("GITHUB_TOKEN", GITHUB_TOKEN)
    headers = {
        "Authorization": f"Bearer {tk}" if tk else "",
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "Zero7-CRM-Data-Pills"
    }

    # Try main, then master
    for branch in ["main", "master"]:
        url = f"{GITHUB_API_URL}/repos/{repo_fullname}/git/trees/{branch}?recursive=1"
        req = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=10, context=ssl_ctx) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                tree = data.get("tree", [])
                files = []
                for item in tree:
                    if item.get("type") != "blob":
                        continue
                    path = item.get("path", "")
                    # Filter unwanted dirs & files
                    parts = path.split("/")
                    if any(p.startswith(".") for p in parts if p != ".agents"):
                        continue
                    if any(p in {"node_modules", ".next", ".vercel", "__pycache__", "dist", "build"} for p in parts):
                        continue
                    ext = os.path.splitext(path)[1].lower()
                    if ext in {".exe", ".dll", ".woff", ".woff2", ".ttf", ".eot", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".ico", ".bin"}:
                        continue

                    size = item.get("size", 0)
                    size_fmt = f"{round(size / 1024, 1)} KB" if size < 1024 * 1024 else f"{round(size / (1024 * 1024), 1)} MB"
                    folder = "/".join(parts[:-1]) or "root"
                    fname = parts[-1]

                    badge = (ext.lstrip(".").upper() or "FILE")[:5]
                    files.append({
                        "tag": f"@file:{path}",
                        "label": fname,
                        "path": path,
                        "size": size,
                        "size_fmt": size_fmt,
                        "category": "Repository File",
                        "ext": ext,
                        "badge": badge,
                        "desc": f"{folder}/ • {size_fmt} • GitHub",
                        "insert": f"@file:{path} ",
                        "source": "github",
                        "repo": repo_fullname
                    })
                return files
        except Exception:
            continue
    return []


def get_github_file_content(repo_or_url: str, path: str, token: Optional[str] = None) -> Optional[str]:
    """Fetches text content of a file from GitHub."""
    repo_fullname = parse_github_repo_fullname(repo_or_url)
    if not repo_fullname:
        return None

    tk = token or os.environ.get("GITHUB_TOKEN", GITHUB_TOKEN)
    headers = {
        "Authorization": f"Bearer {tk}" if tk else "",
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "Zero7-CRM-Data-Pills"
    }

    url = f"{GITHUB_API_URL}/repos/{repo_fullname}/contents/{path}"
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=10, context=ssl_ctx) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            content_encoded = data.get("content", "")
            encoding = data.get("encoding", "")
            if encoding == "base64":
                return base64.b64decode(content_encoded).decode("utf-8", errors="replace")
            return content_encoded
    except Exception:
        # Fallback to raw.githubusercontent.com
        for branch in ["main", "master"]:
            raw_url = f"https://raw.githubusercontent.com/{repo_fullname}/{branch}/{path}"
            raw_req = urllib.request.Request(raw_url, headers=headers)
            try:
                with urllib.request.urlopen(raw_req, timeout=10, context=ssl_ctx) as raw_resp:
                    return raw_resp.read().decode("utf-8", errors="replace")
            except Exception:
                continue
    return None

