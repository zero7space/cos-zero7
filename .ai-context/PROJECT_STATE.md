# COS Theta Project State & Infrastructure Map
**Project**: `COS Theta` (zero7.space)  
**Lead Consultant & Owner**: Abhijeet (abhijeet@zero7.space) | Zero7 Consultancy  
**Core Thesis**: **Capital Per Unit Time** — Maximize revenue velocity by spending time on disproportionate return actions first, followed by hard necessity commitments, squeezing minor tasks into response gaps. Daily human execution bandwidth is strictly capped at 50 actions.  
**Last Updated**: October 30, 2026 | **Target Branch**: `main`

---

## 1. Antigravity Living Memory & Transcript
Every agent (Codex CLI, Claude Code, Antigravity) can read the complete historical chain of thought, decisions, user directives, and tool execution logs directly from disk:
* **Compact Transcript (Fast Ingestion)**:  
  `C:\Users\m_hit\.gemini\antigravity\brain\cdb5bb33-8b97-4a6f-8855-662142f5207a\.system_generated\logs\transcript.jsonl`
* **Full Transcript (Deep Diagnostic History)**:  
  `C:\Users\m_hit\.gemini\antigravity\brain\cdb5bb33-8b97-4a6f-8855-662142f5207a\.system_generated\logs\transcript_full.jsonl`

---

## 2. Active Infrastructure & Endpoints
* **Production Droplet**: `68.183.92.215` (Ubuntu Linux, Docker container `cos-theta`).
  - Web domain: `https://cos.zero7.space`
  - Container database: `/app/zero7_crm.db` (clean state: 147 genuine Meta leads, 831 `zero7_group_messages`, 510 `whatsapp_messages`).
  - Container deployment: SSH via `scratch/id_cos_theta` -> `docker restart cos-theta`.
* **DigitalOcean Infrastructure & API Credentials**:
  - Live Token: Configured via `DO_API_TOKEN` in `.env` (used by `backend/integrations/dns_provisioner.py`).
  - Account: `abhijeet@justmotes.com`, Name: `Abhijeet Deshmukh`, UUID: `c7d6778e-cf9c-4120-8472-1c329b0da51d`.
  - Droplets in Account: 7 active (Limit: 10, 3 slots available). Includes `cos-theta-server` (`68.183.92.215`), `pawan-chemicals-proto` (`68.183.88.12`), `shubham-bansal-baileys-audit` (`139.59.57.178`).
  - Billing & Credits: Enrolled in **DigitalOcean Hatch Startup Program**. Cumulative usage (\$950.15 across 9 cycles) 100% absorbed by Hatch credits. Outstanding balance due: **\$0.00**.
  - Domains: `zero7.space` DNS zone fully managed via API.
* **OmniRoute Primary Node**: `http://100.101.21.96:20128/v1` (Tailscale WireGuard Mesh, 864 models available).
  - Production model: `auto/best-coding` / `antigravity/gemini-3.7-flash-tiered`.
  - API Key: Configured via `OMNIROUTE_API_KEY` in `.env`.
* **Google Sheets Integration**:
  - Sheet ID: `1hYCgiSy1upKN7BqsILAL5vSz1O-6wrLNyxK7XZldCxI`
  - Tab: `Lead form - Higher intent` (150 rows).
  - Poller Interval: 120 seconds in `backend/app.py`.
* **WhatsApp Central & Daemon**:
  - Number: `+91 94790 07951` (Baileys daemon `daemon.js` under systemd service `zero7-whatsapp.service` on host).
  - Group: `zero7` (real-time chat monitoring and touchpoint sync).
  - Sentinel agent monitors lead touchpoint age and alerts on decay (>1.3 days without contact).

---

## 3. Active Features & Verified Components

### A. Capital-Per-Unit-Time Daily Schedule (Battle Plan)
* Core File: `backend/services/scheduling_engine.py` & `backend/database.py`.
* Live URL: `https://cos.zero7.space/#/schedule`.
* EV Scoring: $\text{EV} = \text{Scale} \times \text{Momentum} \times \text{Urgency}$.
* Strict 50-action budget:
  - Slots 1–10: Top 10 Needle Movers (Disproportionate Returns, e.g. ₹29.0L pipeline).
  - Slots 11–20: Hard Necessity Commitments.
  - Slots 21–35: High-Yield Pipeline Deals.
  - Slots 36–50: Squeeze Queue (filling response gaps).
* UI: 50-slot progress bar, filter tabs, sharp 3–7 word actions in brand orange, 1-click execution (`tel:`, WhatsApp, details/prototype preview, mark done).

### B. Sheet Parser Invariant & Column Shift Guard (Fixed Oct 29, 2026)
* Problem Resolved: In rows 145–150 of Google Sheet (e.g. "Empress" and "Vijay kariya."), Meta fields shifted into columns 16–19, causing phone numbers to display as 4 digits (e.g. `9619`).
* Implementation: Intelligent column shift detector in `backend/database.py:sync_sheet_priorities` dynamically locates real 10-digit phone numbers and Meta form values across shifted columns.
* Data Integrity: Clean phone numbers restored to local DB and live Droplet.

### C. Team Member Password Management & Modal Architecture (Fixed Oct 29, 2026)
* Problem Resolved: Modal backdrop dimmed screen but dialog collapsed to 4px due to `#modal-container` being nested in `.app-shell` flexbox layout. Password field was ambiguous and blank.
* Implementation:
  - Moved `#modal-container` to `<body>` root level in `static/index.html`.
  - Added CSS anti-collapse guarantee (`min-height: 200px`, `z-index: 10000`).
  - Added dedicated `[Key] Password` button in Team table (`static/js/app.js:renderTeamPage`).
  - Added `App.openChangePasswordModal(userId)` featuring show/hide eye toggle (`Icons.eye`), "Generate Strong" password button, 1-click update via `PUT /api/users/{id}`, and automatic clipboard copy.
  - Upgraded Edit Member modal with dedicated "Update Login Password" card.
* Verification: Verified 100% functional via live 1080p Playwright automation on `https://cos.zero7.space/#/team`.

### D. Automated Test Suite
* Status: **25/25 unit tests passing green** (`python -m pytest tests/unit/`).
* Covered: `test_scheduling_engine.py`, `test_sheet_parser_integrity.py`, `test_sentinel_agent.py`, `test_models.py`, `test_github_vault_scaffold.py`, `test_google_drive_internal.py`, `test_multi_lead_internal_mentions.py`.

---

## 4. Protected Uncommitted Files & Modules
* `backend/services/scheduling_engine.py` (Battle Plan math)
* `backend/database.py` (Sheet parser shift guard, SQLite operations)
* `backend/app.py` (Sync poller & FastAPI routers)
* `static/js/app.js` (Frontend router, password modal, schedule view)
* `static/css/app.css` (shadcn design system, modal z-index & min-height)
* `static/index.html` (Body root modal container; production assets `?v=hero_notes_11` since 2026-11-02 ~12:16 IST — HeroUI release plus follow-ups, lead flow, dashboard and file-note cards, see `.ai-context/HEROUI_INTERFACE_AUDIT.md`; rollback to hero_notes_10 via `/var/backups/cos-theta-ui/20261102-121540-IST/rollback.sh`, to hero_leadflow_7 via `/var/backups/cos-theta-ui/20261102-121300-IST/rollback.sh`, to hero_followups_6 via `/var/backups/cos-theta-ui/20261102-014935-IST/rollback.sh`, to hero_fields_5 via `/var/backups/cos-theta-ui/20261031-180015-IST/rollback.sh`, to hero_density_4 via `/var/backups/cos-theta-ui/20261031-024804-IST/rollback.sh`, to pre-HeroUI via `/var/backups/cos-theta-ui/20261031-022707-IST/rollback.sh`)
* `static/css/heroui-theme.css`, `static/css/heroui-components.css`, `static/js/utils/ui-components.js` (HeroUI compact layer, live in production)
* `static/js/utils/icons.js` (Added Lucide `key`, `lock`, `eye`, `eyeOff` SVGs)
* `scratch/` (SSH private keys, verification scripts, diagnostic test suites)
