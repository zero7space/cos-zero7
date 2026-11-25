# COS Theta: Complete System Analysis, Architecture & Codex Roadmap
**Workspace**: `COS Theta` (zero7.space)  
**Lead Architect & Commercial Owner**: Abhijeet (abhijeet@zero7.space) | Zero7 Consultancy  
**Operating Philosophy**: **Capital Per Unit Time** — Maximize revenue velocity by spending operator attention on disproportionate return actions first, followed by hard necessity commitments, squeezing minor tasks into response gaps. Daily capacity is strictly capped at 50 actions.  
**Multi-Agent Standard**: Felix Rieseberg Ambition Framework (*Speed, Altitude, Depth, Range*)  
**Last Updated**: October 30, 2026 | **Target Branch**: `main`

---

## 1. Executive System Overview
`COS Theta` is an IPO-grade, AI-native Commercial Operating System and CRM built for high-velocity consulting and high-ticket B2B closing. It unites:
1. **Dynamic Lead Ingestion**: Google Sheets (120s poller), Meta Ads Webhooks, Zoho Mail IMAP, and WhatsApp Baileys daemon.
2. **Algorithmic Prioritization**: Capital-Per-Unit-Time scheduling engine evaluating Mathematical Expected Value ($EV = \text{Scale} \times \text{Momentum} \times \text{Urgency}$) within a strict 50-action human daily capacity budget.
3. **Telephony & Audio Diarization**: Call recording synchronization, internal discussion archiving, and Google Drive vaulting.
4. **Autonomous Prototype Engine**: Client prototype subdomain provisioning (`proto-{client}.zero7.space`) on DigitalOcean droplets.
5. **Multi-Agent Architecture**: Antigravity (Coordinator & Integrator), OpenAI Codex CLI (Bounded Implementer & Adversarial Reviewer), Claude Code CLI.

---

## 2. Codebase Topology & Anatomy

```
COS Theta/
├── .ai-context/                     # Single Source of Truth for all AI coding agents
│   ├── ARCHITECTURE.md              # System topology, SQLite tables, data pipelines
│   ├── PROJECT_STATE.md             # Active droplet, endpoints, live status, uncommitted files
│   ├── SCHEDULING_SPEC.md           # Mathematical EV specification & 50-action capacity rules
│   └── SYSTEM_ANALYSIS_AND_CODEX_ROADMAP.md # This master briefing document
├── .agents/skills/                  # Agent skills directory
│   ├── find-skills/                 # Vercel Labs open agent skills discovery tool
│   └── subdomain-provisioner/       # proto-{client}.zero7.space DNS & Nginx automation
├── backend/                         # FastAPI core backend service
│   ├── app.py                       # Application entrypoint, CORS, routers, background pollers
│   ├── database.py                  # SQLite Repository layer, column shift guards, DB schema
│   ├── models.py                    # Pydantic request/response schemas
│   ├── auth.py                      # Session token auth, password hashing (bcrypt), RBAC
│   ├── ai_scheduler.py              # Background task triggers
│   ├── ai/                          # OmniRoute multi-tier LLM integrations
│   │   ├── client.py                # OmniRoute client (http://100.101.21.96:20128/v1)
│   │   └── sentinel_agent.py        # Lead decay & fatigue alerting (>1.3d threshold)
│   ├── integrations/                # External services
│   │   ├── dns_provisioner.py       # Hostinger & DigitalOcean DNS API (token: dop_v1_747ce...)
│   │   ├── github_vault.py          # GitHub repo scaffolding & commit sync
│   │   └── google_drive.py          # Google Drive folder hierarchy & call recording storage
│   ├── routers/                     # Modular FastAPI routers
│   │   ├── auth.py                  # User management, login, password update (PUT /api/users/{id})
│   │   ├── leads.py                 # Lead CRUD, timeline, stage changes
│   │   ├── deals.py                 # Pipeline deals, stages, values
│   │   ├── calls.py                 # Call recordings, internal discussions, drive open
│   │   ├── whatsapp.py              # WhatsApp 1-on-1 and zero7 group endpoints
│   │   ├── subdomains.py            # Client prototype provisioning routes
│   │   ├── facts.py                 # Business facts & company knowledge base
│   │   └── health.py                # Container health checks
│   └── services/                    # Core business logic
│       └── scheduling_engine.py     # Capital Per Unit Time Daily Battle Plan ($EV math)
├── static/                          # High-performance Vanilla SPA
│   ├── index.html                   # HTML shell with body-level #modal-container
│   ├── css/app.css                  # shadcn/ui zinc palette, modal anti-collapse, high contrast
│   ├── js/app.js                    # SPA Router (#/schedule, #/leads, #/deals, #/team, etc.)
│   └── js/utils/                    # Frontend utilities (icons.js, api.js, marked.min.js)
├── whatsapp-sync-agent/             # WhatsApp integration service
│   ├── daemon.js                    # 24/7 Baileys background daemon (+91 94790 07951)
│   ├── desktop_sync.js              # Desktop chat export importer
│   └── package.json                 # Node.js dependencies
├── tests/unit/                      # Pytest unit test suite (25/25 passing)
├── scratch/                         # SSH keys, diagnostics, migration scripts, test harnesses
├── AGENTS.md                        # Local multi-agent directives & CLI dispatch protocol
├── CLAUDE.md                        # Non-negotiable engineering standards & currency/time rules
├── CONSTRAINTS.md                   # Frozen invariant quality contract
├── CODEX_HANDOFF_PROMPT.md          # Master handoff directive for Codex CLI
└── GITHUB_REPOSITORIES.md           # Master matrix of external repositories & agent engines
```

---

## 3. Frozen Invariant Zones (Never Prune or Weaken)

1. **Daily Action Capacity (50 Calls/Actions Max)**:
   - Operators can execute at most 50 high-quality touchpoints per day.
   - **Slots 1–10**: Disproportionate Return needle-movers (late-stage closes, high-scale deals).
   - **Slots 11–20**: Hard Necessity Commitments (agreed follow-ups, contract reviews).
   - **Slots 21–35**: High-Yield Pipeline Deals.
   - **Slots 36–50**: Squeeze Queue (filling response gaps).
2. **TRAI Calling Hours (09:00 to 21:00 IST)**:
   - No automated call triggering or call alerts outside these hours.
3. **Remark Preservation**:
   - Google Sheet Column 16 (`NEXT STEP`), Column 17 (`Priority`), Column 22 (`UPDATES`), Column 23 (`MEETING`), and Column 24 (`Call Brief`) must be retained without truncation or overwriting.
4. **Zero Empty Leads Rule**:
   - Records with both `name` and `phone` empty must NEVER be inserted into the database.
5. **Currency & Time Standards**:
   - All monetary figures formatted in Indian numbering (`₹K`, `₹L`, `₹Cr`).
   - All timestamps rendered in `IST` (UTC+5:30).
6. **Automated Test Bar**:
   - Full test suite (`python -m pytest tests/unit/`) must remain 100% green before any task is marked done.

---

## 4. Key Breakthroughs & Resolved Regressions (Living Memory)

* **Oct 25, 2026 — Capital Per Unit Time Scheduling Engine**:
  - Implemented mathematical Expected Value algorithm ($EV = \text{Scale} \times \text{Momentum} \times \text{Urgency}$) in `backend/services/scheduling_engine.py`.
  - Built interactive Daily Battle Plan UI (`https://cos.zero7.space/#/schedule`) with 50-action capacity progress meter.
* **Oct 27, 2026 — Sheet Parser Empty Lead Purge**:
  - Identified 2,334 phantom records created by empty trailing rows (140–141) in Google Sheets.
  - Purged phantom leads, ran `VACUUM`, and added strict invariant guards in `backend/database.py`. Restored clean 147 genuine leads.
* **Oct 29, 2026 — Sheet Column Shift Guard (Rows 145–150)**:
  - Users noticed new leads (e.g. "Empress" showing `9619`, "Vijay kariya." showing `2003`) only displayed 4 digits.
  - Diagnosed column shifting where Meta fields shifted into columns 16–19.
  - Built dynamic shift guard in `backend/database.py:sync_sheet_priorities` that scans shifted columns for true 10-digit phone numbers and form data.
* **Oct 29, 2026 — Team Password Modal Collapse & UX Overhaul**:
  - Video walkthrough revealed modal backdrop dimmed screen but dialog collapsed to 4px due to `#modal-container` being nested inside `.app-shell` flex container.
  - Moved `#modal-container` to `<body>` root level in `static/index.html`.
  - Enforced CSS `min-height: 200px` and `z-index: 10000`.
  - Added dedicated `[Key] Password` button on each team row (`static/js/app.js:renderTeamPage`).
  - Added `App.openChangePasswordModal(userId)` with show/hide toggle (`Icons.eye`), "Generate Strong" password generator, and automatic clipboard copy.
* **Oct 29, 2026 — DigitalOcean Infrastructure & Credit Audit**:
  - Token `dop_v1_747ce534...` authenticated successfully with 7 active droplets.
  - Enrolled in **DigitalOcean Hatch Startup Program**: Cumulative \$950.15 absorbed by credits, \$0.00 balance due.

---

## 5. Multi-Agent Operating Contract (Antigravity $\leftrightarrow$ Codex CLI)

| Dimension | Antigravity (Coordinator & Integrator) | Codex CLI (Bounded Implementer & Adversarial Reviewer) |
| :--- | :--- | :--- |
| **Model** | Default Assistant Model | `gpt-6-luna` (Sol 6 Light, high reasoning effort) |
| **Scope** | System-wide orchestration, git merges, user chat, Droplet deployment | Bounded module implementation, TDD test writing, adversarial review |
| **Command** | Autonomous tool invocation | `Get-Content codex_task_prompt.txt \| codex exec --dangerously-bypass-approvals-and-sandbox -` |
| **Workflow** | Prepares task prompt $\rightarrow$ Dispatches Codex $\rightarrow$ Verifies diff $\rightarrow$ Deploys | Ingests `.ai-context/` $\rightarrow$ Writes tests first $\rightarrow$ Implements minimal diff $\rightarrow$ Verifies green |

---

## 6. High-Leverage Development Roadmap for Codex

The following backlog is prioritized by **Capital Per Unit Time**:

### Track 1: Automated Test Suite Expansion (High Reliability)
- **Goal**: Add unit tests for recently added features to maintain the 25/25 test bar.
- **Assigned File**: `tests/unit/test_user_password_update.py`
- **Scope**:
  1. Test `PUT /api/users/{id}` updates password hash via `hash_password()`.
  2. Test `PUT /api/users/{id}` preserves existing password when `password` field is omitted or null.
  3. Test non-admin users cannot edit other users' credentials (403 Forbidden).
  4. Test self-demotion prevention for admin accounts.

### Track 2: Automated Droplet Provisioner CLI (Revenue Acceleration)
- **Goal**: Automate deployment of client prototype subdomains (`proto-{client}.zero7.space`) on DigitalOcean.
- **Assigned Module**: `backend/routers/subdomains.py` & `.agents/skills/subdomain-provisioner/`
- **Scope**: Use verified token `dop_v1_747ce5...` to provision an `s-1vcpu-1gb` droplet in `blr1`, attach SSH key `58630722`, create DNS `A` record on `zero7.space`, and verify Nginx reverse proxy.

### Track 3: WhatsApp 1-to-1 Chat Decay & Sentinel Integration
- **Goal**: Prevent high-value leads from going cold (>1.3 days without contact).
- **Assigned Module**: `backend/ai/sentinel_agent.py` & `backend/services/scheduling_engine.py`
- **Scope**: Correlate incoming 1-to-1 WhatsApp messages (`whatsapp_messages`) and group messages (`zero7_group_messages`) to dynamically boost lead urgency in the Daily Battle Plan.
