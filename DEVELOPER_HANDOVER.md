# COS Theta (`cos-zero7`) — End-to-End Developer Handover

**Project**: COS Theta / Zero7 CRM (`zero7.space`)  
**Production URL**: `https://cos.zero7.space`  
**Repository**: `https://github.com/zero7space/cos-zero7.git` (branch: `main`)  
**Owner / Lead Consultant**: Abhijeet Deshmukh (`abhijeet@zero7.space`) — Zero7 Consultancy  
**Target Standard**: Institutional IPO-Grade Engineering & Commercial Rigor  

> **Security Notice**: This document intentionally omits all raw API keys, OAuth tokens, passwords, and private credentials. All secrets live in `.env`, `.zoho_token_*.json`, `google_drive_credentials.json`, `agent_worker/worker_config.json`, or GitHub Repository Secrets.

---

## 1. Executive Overview & Strategic Thesis

COS Theta is Zero7 Consultancy's internal Business Operating System & CRM, built to maximize revenue velocity for founder-led consulting and B2B deal closing.

### Core Strategic Thesis: Capital Per Unit Time
Human execution bandwidth is the scarcest resource. Every scheduling, prioritization, and automation decision in COS Theta is governed by:

$$\text{EV} = \text{Scale} \times \text{Momentum} \times \text{Urgency}$$

Daily execution capacity is strictly capped at **50 actions/day**, partitioned into 4 tiers in the Battle Plan (`backend/services/scheduling_engine.py`):
- **Slots 1–10 (Disproportionate Returns)**: Top needle-movers (high business scale, e.g., 50–200 employees / ₹25L–₹50L+ revenue, or late-stage closing momentum such as Advance Collection, Quotation Closing, Prototype Presentation).
- **Slots 11–20 (Hard Necessity Commitments)**: Scheduled callbacks, meetings, and lead decay alerts (>1.3 days without touchpoint).
- **Slots 21–35 (High-Yield Pipeline)**: Active mid-funnel pipeline progression.
- **Slots 36–50 (Squeeze Queue)**: Early exploratory tasks squeezed into response gaps; never permitted to displace high-yield accounts.

### Frozen Invariant Zones (`CONSTRAINTS.md`)
Never modify or prune these invariants without automated tests and explicit human review:
1. **Google Sheet Remark Preservation**: `backend/database.py:sync_sheet_priorities` must ingest and retain columns 14–24—specifically col 16 (`NEXT STEP`), col 17 (`Priority`), col 22 (`UPDATES`), col 23 (`MEETING`), and col 24 (`Call Brief / Additional Notes`)—without flattening, truncating, or overwriting them with AI summaries or `"Ad on %"` placeholders. Includes a column-shift guard for shifted Meta rows.
2. **Daily 50-Action Capacity Cap**: Never exceed 50 daily actions; Slots 1–10 remain reserved for Disproportionate Returns.
3. **TRAI Calling Hours & Locale**: Outbound automated call triggers or scheduled call alerts are strictly restricted to **09:00:00–20:59:59 IST**. All timestamps are **IST (UTC+5:30)** and all currency is rendered in Indian units (**₹K, ₹L, ₹Cr**).
4. **Zero Empty Leads Rule**: Never create or ingest a lead where both `name` and `phone` are blank/null. `backend/database.py:create_lead` (referred to in `CONSTRAINTS.md` as `Repository.create_lead`, alongside `backend/repositories/contacts.py`) must raise `ValueError`, and sheet row iteration must skip trailing blank/formula rows before ID generation.
5. **Test Verification Gate**: `python -m pytest tests/unit/` must remain **100% green** before pushing or deploying to production.

---

## 2. GitHub & Repository Setup

### Git Remotes, Org & Branches
- **Local `origin` remote**: `https://github.com/zero7space/cos-zero7.git` (org: `zero7space`, repo: `cos-zero7`).
- **Active branch**: `main`.
- **Client Vaults GitHub Org**: `GITHUB_ORG=Zero7AILab` (used by `backend/integrations/github_vault.py` for automated client prototype/project repositories; git author email `zerosevenspace@gmail.com`).
- **Historical Rename Note**: Originally hosted at `zerosevenspace-pixel/cos-theta`. On Nov 1, 2026, Zero7's internal CRM was moved to `zero7space/cos-zero7` to reserve `cos-theta` for the future generalized multi-tenant product.
  - **Known Mismatch**: `.github/workflows/deploy.yml` still contains a fallback `git clone https://github.com/zerosevenspace-pixel/cos-theta.git /root/cos-theta` if `/root/cos-theta` is missing on the Droplet. Update this URL if provisioning a fresh Droplet.

### Cloning & Branching Workflow
```bash
git clone https://github.com/zero7space/cos-zero7.git
cd cos-zero7
git checkout -b feat/<short-description>
```
Install pre-commit hooks locally:
```bash
pip install pre-commit
pre-commit install
```

### Pre-Commit & Linting (`.pre-commit-config.yaml`, `pyproject.toml`)
- **Ruff** (`v0.9.10`): `ruff` (`--fix`) and `ruff-format` targeting `py312`, `line-length = 120`, lint rules `["E", "F", "I", "W"]` (ignoring `E501`), double-quote formatting.
- **Pre-commit hooks** (`v5.0.0`): `trailing-whitespace`, `end-of-file-fixer`, `check-yaml`, `check-json`.

### CI/CD Workflows (`.github/workflows/`)
1. **`.github/workflows/deploy.yml`** (*Deploy to DigitalOcean Droplet*):
   - Triggers on `push` to `main` or manual `workflow_dispatch`.
   - Uses `appleboy/ssh-action@v1.0.3` to SSH as `root` into `secrets.DO_HOST` using `secrets.DO_SSH_KEY` and `secrets.DO_SSH_PASSPHRASE`.
   - Runs `cd /root/cos-theta && git pull origin main && docker compose down || true && docker compose up -d --build`.
2. **`.github/workflows/autonomous-aider.yml`**:
   - Triggers on `repository_dispatch` (`aider-task`) or `workflow_dispatch`.
   - Runs `aider` against `AI_API_BASE` / `AI_API_KEY`, executes `python test_backend.py`, and auto-commits/pushes to `main`.

### `.gitignore` Rules & Security Gap
`.gitignore` excludes: `.env`, `.zoho_token*.json`, `.zoho_token*.json.local`, `.zoho_token*.json.*.local`, `*.db`, `zero7_crm.db`, `cos_theta.db`, `database.sqlite`, `cos_theta_data/`, `whatsapp-sync-agent/auth_*/`, `whatsapp-sync-agent/downloads/`, `whatsapp-sync-agent/*.log`, `whatsapp-sync-agent/qr_*.png`, `whatsapp-sync-agent/group_messages.json`, `agent_worker/worker_config.json`, `agent_worker/worker.log`, `scratch/`, `.system_generated/`, `node_modules/`, `android/.gradle/`, `android/**/build/`, `android/**/*.apk`, `android/local.properties`, and `.ruff_cache/`.

> **CRITICAL SECURITY GAP**: `google_drive_credentials.json` is **NOT** currently listed in `.gitignore` and exists as an untracked file in the workspace root. Add `google_drive_credentials.json` to `.gitignore` before running `git add .`.

---

## 3. Hosting, Infrastructure & Networking

### DigitalOcean Droplet & Account
- **Account**: `abhijeet@justmotes.com` (DigitalOcean Hatch Startup Program — credits valid 12 months from Feb 22, 2026 until **Feb 22, 2027**).
- **Primary Droplet**: `cos-theta-server` (ID `593848789`), IP **`68.183.92.215`** (Ubuntu Linux).
- **Live Container**: `cos-theta` (or `cos-theta-server` via Compose), exposing port `8000`.
- **SSH Access**: Key `id_cos_theta` (stored locally in `scratch/id_cos_theta` — gitignored).

### Docker, Compose & Entrypoint
- **`Dockerfile`**: Base `python:3.12-slim`, installs `build-essential`, `libpq-dev`, `curl`, `git`, `ffmpeg`, installs `requirements.txt`, creates `/app/recordings`, exposes `8000`, configures `HEALTHCHECK` on `http://localhost:8000/api/health`, and launches `uvicorn backend.app:app --host 0.0.0.0 --port 8000` via `entrypoint.sh`.
- **`docker-compose.yml`**:
  - `postgres` (`postgres:16-alpine`, container `zero7-postgres`, port `5432`, volume `postgres_data`, healthcheck `pg_isready`).
  - `cos-theta-app` (`cos-theta-server`, port `8000`, depends on `postgres` healthy). Mounts `./recordings:/app/recordings`, `./backups:/app/backups`, `./cos_theta_data:/app/data`, `./zero7_crm.db:/app/zero7_crm.db`.
- **`entrypoint.sh`**:
  - If `DATABASE_URL` contains `postgres`: waits up to 60s for PostgreSQL, calls `backend/db/postgres_schema.py:get_all_create_table_statements()` (note: this function is currently missing in `postgres_schema.py` — see Section 8), and if `AUTO_MIGRATE_SQLITE_TO_POSTGRES=1` and `zero7_crm.db` exists, runs `python -m backend.db.migrator --sqlite-path zero7_crm.db`.
  - Otherwise: initializes local SQLite (`zero7_crm.db`) via `backend.database.init_db()` and `backend.seed_data.seed_if_empty()`.

### Domain, Nginx & Subdomain Provisioning
- **Root Domain**: `zero7.space` (DNS hosted on **Hostinger**, fallback **DigitalOcean DNS API**).
- **Primary App**: `https://cos.zero7.space`.
- **Nginx & SSL**: Catch-all Nginx vhost on the Droplet (`server_name cos.zero7.space *.zero7.space 68.183.92.215`) proxies traffic to FastAPI on port `8000`. Wildcard TLS is managed via Certbot DNS-01 using `/root/scripts/hostinger_acme_hook.py` on the Droplet.
- **Client Prototype Subdomains** (`.agents/skills/subdomain-provisioner/SKILL.md`, `backend/integrations/dns_provisioner.py`, `backend/routers/subdomains.py`):
  - Provisions `proto-{client}.zero7.space` A records pointing to `68.183.92.215` via Hostinger DNS API (primary) or DO DNS API (fallback).
  - Protected prefixes (`cos`, `@`, `www`, `mail`, `api`, etc.) and Zoho MX/SPF/DKIM records are blocked from modification.
  - `HostSecurityMiddleware` in `backend/app.py` isolates `*.zero7.space` prototype subdomains from internal `/api/*` routes (returning `403` except for `/api/public/*` and `/api/subdomains/*`).

### OmniRoute AI Gateway & Tailscale Mesh
- **`backend/ai/client.py`** implements a **6-tier failover** for LLM calls (default production model: `antigravity/gemini-3.7-flash-tiered` / `auto/best-coding`):
  1. **Tailscale Mesh Primary**: `OMNIROUTE_PRIMARY_URL` (`http://100.101.21.96:20128/v1`)
  2. **Local LAN**: `OMNIROUTE_LAN_URL` (`http://192.168.1.11:20128/v1`)
  3. **Cloudflare Tunnel**: `OMNIROUTE_TUNNEL_URL` (`https://conditioning-baskets-vip-christ.trycloudflare.com/v1`)
  4. **Localhost**: `OMNIROUTE_LOCAL_URL` (`http://localhost:20128/v1`)
  5. **Legacy Gateway**: `AI_API_BASE` (`http://168.144.91.0:8080/v1`)
  6. **Direct Gemini Fallback**: `GEMINI_API_KEY` / `GOOGLE_API_KEY`
- **WhatsApp Daemon**: `WA_DAEMON_URL` defaults to `http://172.17.0.1:8085` (Docker host bridge to systemd service `zero7-whatsapp.service` running `whatsapp-sync-agent/daemon.js` for `+91 94790 07951`).

---

## 4. Complete Secrets, Keys, Tokens & Mail Setup Inventory

### Mail Architecture (Zoho Mail REST API)
COS Theta uses **Zoho Mail REST API** (`accounts.zoho.in` / `mail.zoho.in/api`) exclusively—there is **no SMTP, IMAP, Gmail API, or Resend** in the backend.
- **Implementation**: `backend/integrations/zoho_mail.py` + background sync `run_background_zoho_mail_sync()` (120s interval) writing to `zoho_emails_cache`, `zoho_attachments_cache`, `zoho_mail_metadata`, and `zoho_mail_labels`.
- **Configured Mailboxes**:
  - `admin@zero7.space` (`ZOHO_ACCOUNT_ID=1914516000000002002`) — uses `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`.
  - `ramesh@zero7.space` (`ZOHO_RAMESH_ACCOUNT_ID=6428066000000002002`, hosts intern aliases) — uses `ZOHO_RAMESH_CLIENT_ID`, `ZOHO_RAMESH_CLIENT_SECRET`, `ZOHO_RAMESH_REFRESH_TOKEN`.
- **Token Caching & Auto-Rotation**: OAuth2 access tokens auto-refresh using the long-lived refresh tokens and cache locally in `.zoho_token_admin.json`, `.zoho_token_ramesh.json`, and `.zoho_token_cache.json` (all gitignored).

### Complete Environment Variable Inventory (`.env`, `.env.example`, `backend/config.py`)

| Category | Variable Name(s) | Purpose / Service | Account / Scope | Where Used |
| :--- | :--- | :--- | :--- | :--- |
| **App & Domain** | `PORT`, `APP_DOMAIN`, `ZERO7_ROOT_DOMAIN`, `JWT_SECRET` | Server port (`8000`), domain routing (`cos.zero7.space` / `zero7.space`), auth secret | Zero7 Prod | `backend/config.py`, `docker-compose.yml` |
| **Database** | `DATABASE_URL`, `AUTO_MIGRATE_SQLITE_TO_POSTGRES`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `ZERO7_DB_PATH` | Postgres connection string (if set) or SQLite path (`zero7_crm.db`) | Local / `zero7-postgres` | `backend/config.py`, `backend/db/connection.py`, `entrypoint.sh` |
| **AI / OmniRoute** | `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY`, `OMNIROUTE_PRIMARY_URL`, `OMNIROUTE_LAN_URL`, `OMNIROUTE_TUNNEL_URL`, `OMNIROUTE_LOCAL_URL`, `OMNIROUTE_API_KEY`, `AI_API_BASE`, `AI_API_KEY`, `GEMINI_API_KEY` | 6-tier LLM gateway & direct Gemini fallback | OmniRoute Tailscale node / Gemini | `backend/ai/client.py`, `backend/config.py`, `docker-compose.yml` |
| **Zoho Mail** | `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`, `ZOHO_ACCOUNT_ID`, `ZOHO_REGION`, `ZOHO_REDIRECT_URI`, `ZOHO_RAMESH_CLIENT_ID`, `ZOHO_RAMESH_CLIENT_SECRET`, `ZOHO_RAMESH_REFRESH_TOKEN`, `ZOHO_RAMESH_ACCOUNT_ID` | Zoho Mail India OAuth2 REST API for `admin@zero7.space` & `ramesh@zero7.space` | Zoho Mail (`zero7.space`) | `backend/integrations/zoho_mail.py` |
| **Google Workspace** | `GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_DRIVE_CREDENTIALS`, `GOOGLE_SHEET_ID`, `GOOGLE_DRIVE_ROOT_FOLDER_ID`, `DRIVE_WEBHOOK_URL` | Service account JSON (`zero7-crm-drive@cos-theta.iam.gserviceaccount.com`), Lead Sheet (`1hYCgiSy1upKN7BqsILAL5vSz1O-6wrLNyxK7XZldCxI`), Drive root folder, Apps Script fallback | GCP Project `cos-theta` | `backend/config.py`, `backend/integrations/google_drive.py`, `backend/database.py` |
| **Meta / FB Ads** | `META_PAGE_ACCESS_TOKEN`, `META_PAGE_ID`, `META_VERIFY_TOKEN` | Meta Lead Ads webhook (`/api/webhooks/meta-leads`) & Graph API lead fetch (App ID `1469248835260108`, Form `3136433653220686`) | Zero7 CRM Integrator | `backend/app.py`, `docker-compose.yml` |
| **GitHub** | `GITHUB_TOKEN`, `GITHUB_ORG` | Client project vault creation & CI | `Zero7AILab` (`zerosevenspace@gmail.com`) | `backend/integrations/github_vault.py` |
| **DNS & Hosting** | `HOSTINGER_API_TOKEN`, `DO_API_TOKEN` | `proto-{client}.zero7.space` DNS A-record automation | Hostinger (`zero7.space`) / DO (`abhijeet@justmotes.com`) | `backend/integrations/dns_provisioner.py`, `backend/config.py` |
| **Voice / Speech** | `DEEPGRAM_API_KEY` | Call recording transcription | Deepgram | `backend/integrations/deepgram.py`, `backend/config.py` |
| **WhatsApp & Agents** | `WA_DAEMON_URL`, `CRM_MCP_TOKEN`, `AGENT_BRIDGE_SECRET`, `SENTINEL_*` | Baileys daemon bridge (`http://172.17.0.1:8085`), MCP auth, local `agent_worker` bridge, Sentinel config | Zero7 Internal | `backend/app.py`, `backend/mcp_server.py`, `backend/config.py` |
| **Optional / Mocked** | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `VERCEL_TOKEN`, `VERCEL_TEAM_ID` | Client prototype DB/hosting provisioning (runs in mock mode if unset) | External client deploys | `backend/integrations/supabase_provisioner.py`, `vercel_deployer.py` |
| **Dev Flags** | `ZERO7_DISABLE_EXTERNAL_SYNC`, `ZERO7_PROJECTS_DIR` | Set `ZERO7_DISABLE_EXTERNAL_SYNC=1` locally to disable 120s Meta/Sheet/Zoho/Sentinel loops | Local Dev | `backend/app.py` |

### Credential Files & GitHub Secrets
- **Local Credential Files**:
  - `.env` — Primary runtime secrets (gitignored).
  - `.zoho_token_admin.json`, `.zoho_token_ramesh.json`, `.zoho_token_cache.json` — Auto-refreshed Zoho OAuth tokens (gitignored).
  - `google_drive_credentials.json` — GCP Service Account key (currently **not** in `.gitignore` — must be added).
  - `whatsapp-sync-agent/config.json` & `whatsapp-sync-agent/auth_*/` — Sync agent config & Baileys session keys (`auth_*/` gitignored).
  - `agent_worker/worker_config.json` — Local Windows worker credentials (gitignored).
- **GitHub Repository Secrets** (used by `.github/workflows/`): `DO_HOST`, `DO_SSH_KEY`, `DO_SSH_PASSPHRASE`, `AI_API_BASE`, `AI_API_KEY`.

### Key Rotation & Hardcoded Fallback Cleanup
- **Zoho**: Access tokens auto-rotate; to rotate a refresh token, re-authorize via `https://cos.zero7.space/api/mail/callback` and update `.env` + delete `.zoho_token_*.json`.
- **Static Keys**: Update `.env` on the Droplet (`/root/cos-theta/.env`) and restart the container (`docker compose up -d --build`).
- **Known Security Debt**: Several Python modules (`zoho_mail.py`, `dns_provisioner.py`, `github_vault.py`, `deepgram.py`, `client.py`, `whatsapp_vision_ocr.py`, `mcp_server.py`) and `whatsapp-sync-agent/config.json` contain hardcoded fallback strings/tokens. These must be scrubbed and replaced with strict `os.environ` lookups.

---

## 5. End-to-End System Architecture

### Backend (`backend/`)
- **`run_app.py`**: Local dev launcher (`uvicorn backend.app:app --host 127.0.0.1 --port 8000 --reload`).
- **`backend/app.py`** (3,138 lines): FastAPI core, `HostSecurityMiddleware`, `lifespan` startup (`init_db()`, `seed_if_empty()`, plus 3 background tasks: Meta/Google Sheet 120s poller, Zoho Mail sync, Sentinel audit loop unless `ZERO7_DISABLE_EXTERNAL_SYNC=1`). Hosts direct routes for Meta webhooks/sync, Google Sheets/Tasks, Daily Schedule, AI Brief/Prototype/Catch-me-up, Subdomain/DNS/GitHub Vault, Agent Worker bridge, Skills/Data Pills/MCP/Actions, Orchestrator, and Zoho Mail (`/api/mail/*`, `/mail`).
- **Modular Routers (`backend/routers/`)**:
  - `auth.py`: `/api/auth/*`, `/api/users/*` (Note: uses SHA-256 password hashing and unsigned base64 JSON tokens—not signed JWTs despite `JWT_SECRET` in `config.py`).
  - `leads.py`: `/api/leads/*`
  - `deals.py`: `/api/deals/*` (milestones, payments, deliverables, environments)
  - `calls.py`: `/api/leads/{id}/calls`, `/api/crm/calls/*`, `/api/recordings/*`, mobile-sync
  - `whatsapp.py`: `/api/whatsapp/*`, `/api/admin/whatsapp/*`, `/api/whatsapp/zero7/group-messages`
  - `facts.py`: `/api/leads/{id}/facts`, `/api/facts/{fact_id}/review`
  - `subdomains.py`: `/api/subdomains/*`
  - `health.py`: `/api/health`
- **MCP Server (`backend/mcp_server.py`)**: SSE MCP server exposing read-only `tool_crm_sql_query`.
- **Database & Repositories (`backend/db/`, `backend/database.py`, `backend/repositories/`)**:
  - `backend/db/connection.py`: Dual-dialect engine (PostgreSQL pool via `DATABASE_URL` or SQLite WAL `zero7_crm.db` via `ZERO7_DB_PATH` with `PRAGMA journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=60000`).
  - `backend/db/schema.py` defines **35 tables**; `postgres_schema.py` & `migrator.py` define/migrate **31–32 tables**.
  - Repositories: `base.py`, `contacts.py`, `deals.py`, `activities.py`, `attributions.py`, `facts.py`, `prototypes.py`, `subdomains.py`.
- **AI, Agents & Services (`backend/services/`, `backend/ai/`, `backend/agents/`, `backend/integrations/`)**:
  - `backend/services/scheduling_engine.py`: EV scoring ($\text{Scale} \times \text{Momentum} \times \text{Urgency}$) & 50-slot Battle Plan.
  - `backend/services/fact_service.py`: Lead fact extraction & review.
  - `backend/ai/`: `client.py` (OmniRoute 6-tier failover), `sentinel_agent.py` (monitors lead touchpoint decay >1.3 days & logs to `sentinel_alerts_log`), `research_agent.py`, `prototype_agent.py`, `reconciliation_agent.py`, `master_orchestrator.py`.
  - `backend/agents/`: `pill_resolver.py`.
  - `backend/integrations/`: `zoho_mail.py`, `google_drive.py`, `google_tasks.py`, `deepgram.py`, `dns_provisioner.py`, `github_vault.py`, `supabase_provisioner.py`, `vercel_deployer.py`, `whatsapp_vision_ocr.py`.

### Frontend SPA (`static/`)
- Vanilla JS hash-router SPA (`static/index.html`, `static/js/app.js`) styled with HeroUI + shadcn-inspired CSS (`static/css/app.css`, `heroui-theme.css`, `heroui-components.css`).
- Utilities: `static/js/utils/{api,icons,lead-inline-editor,ui-components,marked.min}.js`.
- Routes: `#/schedule`, `#/followups`, `#/dashboard`, `#/leads`, `#/leads/{id}`, `#/deals`, `#/deals/{id}`, `#/whatsapp`, `#/agents`, `#/integrations`, `#/team`, `#/mail` (plus standalone `static/mail/{index.html,app.js,style.css}`).
- **UI Architecture Note**: `#modal-container` MUST stay at `<body>` root in `static/index.html` (with `min-height: 200px`, `z-index: 10000`) to prevent flexbox collapse. Static assets in `static/index.html` use cache-busting query params (e.g., `?v=hero_notes_11`).

### Companion & Edge Components
- **`agent_worker/`** (`worker.py`, `tray_worker.py`): Windows 11 local Antigravity bridge polling the cloud CRM for `agent_jobs`.
- **`whatsapp-sync-agent/`** (Node.js + Baileys `daemon.js`, `desktop_sync.js`, `sync_zero7_to_crm.js`): 24/7 WhatsApp & `zero7` group sync.
- **`android/`** (Kotlin/Gradle `com.coldcalling.app`, `minSdk 26`, `targetSdk 34`): Mobile call monitor, scrcpy wireless ADB audio capture, Drive & CRM call uploader.

### Databases & Data Files
- **Active Local DB**: `zero7_crm.db` (~3.63 MB, 35 tables: `leads`, `deals`, `users`, `notes`, `call_logs`, `whatsapp_messages`, `zoho_emails_cache`, `sentinel_alerts_log`, `lead_facts`, etc.).
- **Zero-Byte Legacy Stubs** (safe to ignore/remove): `cos.db`, `database.sqlite`, `backend/cos.db`, `backend/cos_theta.db`, `backend/leads.db`.
- **Backups**: `backups/zero7_crm_backup_*.db`.

---

## 6. Local Development, Installation, Database Init & Testing Runbook

### Prerequisites
- Python **3.12+**
- Node.js **18+** (only needed for `whatsapp-sync-agent/` and `tests/frontend/*.cjs`)
- Git

### Step-by-Step Setup (Fresh Machine)
1. **Clone & Enter Repository**:
   ```bash
   git clone https://github.com/zero7space/cos-zero7.git
   cd cos-zero7
   ```
2. **Create Virtual Environment & Install Dependencies**:
   ```bash
   python -m venv venv
   # Windows PowerShell:
   .\venv\Scripts\Activate.ps1
   # Linux/macOS:
   # source venv/bin/activate

   pip install -r requirements-dev.txt
   ```
3. **Configure Environment**:
   ```bash
   cp .env.example .env
   ```
   - For local SQLite development, ensure `DATABASE_URL` is commented out or empty in `.env`.
   - Set `ZERO7_DISABLE_EXTERNAL_SYNC=1` in `.env` (or your shell) to prevent background Meta/Google Sheet/Zoho/Sentinel loops from hitting external APIs during local dev.
   - Obtain `.env` secrets, `google_drive_credentials.json`, and `.zoho_token_*.json` securely from the project owner (`abhijeet@zero7.space`) if testing live integrations.
4. **Initialize Database & Start App**:
   ```bash
   python run_app.py
   ```
   `backend.app` automatically runs `init_db()` and `seed_if_empty()` on startup, creating `zero7_crm.db` if absent.
   - Web UI: `http://127.0.0.1:8000`
   - Swagger API Docs: `http://127.0.0.1:8000/docs`
   - Health Check: `http://127.0.0.1:8000/api/health`
5. **Run Automated Tests**:
   ```bash
   # Unit tests (must be 100% green before any push/deploy)
   python -m pytest tests/unit/

   # Integration tests
   python -m pytest tests/integration/

   # Linter / formatter check (ruff is configured via .pre-commit-config.yaml; install ruff separately if not in venv)
   pip install ruff && ruff check .
   ```
   *(Optional)* For `whatsapp-sync-agent/`:
   ```bash
   cd whatsapp-sync-agent && npm install
   ```

---

## 7. Production Deployment, Monitoring & Troubleshooting

### Deploying Updates
- **Automated CI/CD**: Pushing to `main` triggers `.github/workflows/deploy.yml`, which SSHs into `68.183.92.215`, pulls `main`, and runs `docker compose down || true && docker compose up -d --build`.
- **Manual SSH Deploy**:
  ```bash
  ssh -i scratch/id_cos_theta root@68.183.92.215
  cd /root/cos-theta
  git pull origin main
  docker compose up -d --build
  ```

### Monitoring & Health Checks
- **API Health**: `curl -f https://cos.zero7.space/api/health`
- **Container Logs**: `docker logs -f cos-theta` (or `docker compose logs -f cos-theta-app`)
- **WhatsApp Daemon (Host Systemd)**: `systemctl status zero7-whatsapp.service` and `journalctl -u zero7-whatsapp.service -f`

### Common Operational Issues & Troubleshooting
1. **Meta Leads Missing `ad_name` / `campaign_name` (showing `"Ad on Lead form - Higher intent"`)**:
   - Meta webhooks only send `leadgen_id`. The Graph API strips `ad_name`, `adset_name`, `campaign_name` unless `?fields=...` is explicitly requested. Verify `backend/app.py` Meta fetch query parameters.
2. **Google Sheet Phone Numbers Truncated (e.g., 4 digits)**:
   - Shifted Meta columns in the sheet trigger the column-shift guard in `backend/database.py:sync_sheet_priorities`. Check the sheet header alignment and ensure `sync_sheet_priorities` is not bypassed.
3. **WhatsApp History Missing After Reconnect**:
   - Baileys triggers `messaging-history.set` only on initial QR pairing. Reconnects do not resend old history; placeholder messages require `requestPlaceholderResend` and LID-to-PN mapping. Never pair primary personal/client SIMs (ban risk).
4. **Modal Backdrop Appears But Dialog Is Collapsed / Invisible**:
   - Ensure `#modal-container` in `static/index.html` is a direct child of `<body>` (never inside `.app-shell` flexbox) and static asset cache-busters (`?v=...`) are bumped after UI edits.
5. **OmniRoute AI Timeouts**:
   - Check Tailscale status on the host/Droplet (`tailscale status`) to verify `100.101.21.96:20128` is reachable; otherwise `backend/ai/client.py` automatically falls back through LAN, Cloudflare Tunnel, Localhost, Legacy Gateway, and direct `GEMINI_API_KEY`.

---

## 8. Compressed Historical Context, Known Discrepancies & Next Priorities

### Key Historical Decisions
- **Pivoted from Supabase to Single-Container FastAPI + SQLite/Postgres**: Reduced latency and operational complexity for Zero7's internal CRM (`cos-zero7`), while keeping `postgres_schema.py` and `migrator.py` ready for Postgres 16 via Docker Compose.
- **UI & Concurrency Hardening**: Atomically hardened `/api/actions/{id}/approve` (`transition_action_status_if_not_final`), added `normalize_email` to prevent case-duplicate users, fixed blank `password_hash` wipes, and rolled out the HeroUI compact UI (`?v=hero_notes_11` with rollback scripts under `/var/backups/cos-theta-ui/` on the Droplet).
- **Generalized Product Vision (`COS Θ`)**: Long-term multi-tenant SaaS roadmap targets Indian SME verticals (furniture, security, stone crushing, chemicals) using Postgres schema-per-tenant, PowerSync offline SQLite, `COS-Bridge` (Tally/Busy local daemon), and a dedicated WhatsApp Sentry Bot.

### Known Discrepancies & Tech Debt to Address Next
1. **Uncommitted Local Workspace**: `git status -s` currently has ~22 modified files and 60+ untracked files/directories (`AGENTS.md`, `CONSTRAINTS.md`, `.ai-context/`, `backend/db/`, `backend/routers/`, `backend/repositories/`, `tests/`, `android/`, `static/mail/`, `entrypoint.sh`, etc.). Audit, clean up scratch/export artifacts, and commit cleanly to `main`.
2. **`.gitignore` Security Gap**: Add `google_drive_credentials.json` to `.gitignore` immediately.
3. **Hardcoded Fallback Secrets in Source**: Remove hardcoded fallback tokens/passwords in `backend/integrations/{zoho_mail,dns_provisioner,github_vault,deepgram,whatsapp_vision_ocr}.py`, `backend/ai/client.py`, `backend/mcp_server.py`, and `whatsapp-sync-agent/config.json`.
4. **CI/CD Repo URL Mismatch**: Update `.github/workflows/deploy.yml` line 25 from `zerosevenspace-pixel/cos-theta.git` to `zero7space/cos-zero7.git`.
5. **Auth Token Signing**: `backend/auth.py` currently issues unsigned base64 JSON tokens instead of HMAC-SHA256 signed JWTs using `JWT_SECRET`.
6. **Test Count Documentation Drift**: `AGENTS.md`, `CONSTRAINTS.md`, and `.ai-context/PROJECT_STATE.md` cite "25/25 unit tests", whereas `tests/unit/` now contains **33 unit tests** across 9 files (all passing).
7. **Postgres Entrypoint Gap**: `entrypoint.sh` imports `get_all_create_table_statements()` from `backend/db/postgres_schema.py`, which does not currently exist in `postgres_schema.py`. Fix before enabling `DATABASE_URL` with PostgreSQL in production.
8. **DO Hatch Credits Expiry**: Monitor DigitalOcean Hatch credits before **Feb 22, 2027**.

---

## 9. Antigravity & Multi-Agent Workspace Setup

To replicate the exact Antigravity + multi-agent development environment on a new workstation:

### Single Source of Truth Context Files
All coding agents (Antigravity, OpenAI Codex CLI, Claude Code CLI) automatically orient from these workspace files:
- `AGENTS.md`: Multi-agent 3-role operating model (Coordinator/Integrator, Bounded Implementer, Independent Verifier), Ambition Framework, CLI dispatch protocols, and Frozen Invariant Zones.
- `CLAUDE.md`: Foundation non-negotiables, Indian financial units (`₹K`, `₹L`, `₹Cr`), IST timezone.
- `CONSTRAINTS.md`: Frozen invariant contracts (Sheet columns 14–24, 50-action daily cap, TRAI 09:00–21:00 IST hours, Zero Empty Leads rule, test gate).
- `.ai-context/PROJECT_STATE.md`: Active branch, Droplet state, OmniRoute primary endpoint, UI release/rollback pointers, and protected uncommitted modules.
- `.ai-context/SCHEDULING_SPEC.md`: Mathematical Expected Value scoring ($EV = \text{Scale} \times \text{Momentum} \times \text{Urgency}$) and 50-slot Battle Plan specification.
- `.ai-context/ARCHITECTURE.md`: Module map, SQLite schema overview, ingestion pipelines, and container topology.

### Workspace-Local Skills (`.agents/skills/`)
- `.agents/skills/find-skills/SKILL.md`: Discovers and installs additional agent skills when extending capabilities.
- `.agents/skills/subdomain-provisioner/SKILL.md`: Automates `proto-{client}.zero7.space` DNS A-record provisioning and Droplet Nginx routing.

### Multi-Agent CLI Tooling
- **OpenAI Codex CLI** (`codex-cli 0.164.0`):
  - Default model `gpt-6-luna` configured in `~/.codex/config.toml`; master handoff directive in `CODEX_HANDOFF_PROMPT.md`.
  - Dispatch pattern (PowerShell):
    ```powershell
    Get-Content codex_task_prompt.txt | codex exec --dangerously-bypass-approvals-and-sandbox -
    ```
- **Claude Code CLI**:
  - Dispatch pattern:
    ```powershell
    claude -p --dangerously-skip-permissions
    ```

### Connecting Windows `agent_worker/` & OmniRoute
- **OmniRoute AI Gateway**: Ensure Tailscale is connected so `http://100.101.21.96:20128/v1` is reachable (or run a local OmniRoute node at `http://localhost:20128/v1`). Configure `OPENAI_BASE_URL`, `ANTHROPIC_BASE_URL`, `OMNIROUTE_PRIMARY_URL`, and `OMNIROUTE_API_KEY` in `.env`.
- **Windows Local Bridge (`agent_worker/`)**:
  - `agent_worker/worker.py` (CLI) and `agent_worker/tray_worker.py` (Windows system tray) poll the cloud CRM (`cos.zero7.space`) for `agent_jobs` and execute them against the local Antigravity engine.
  - Worker identity and linked user email are stored in `agent_worker/worker_config.json` (gitignored).
  - Run locally via:
    ```powershell
    python agent_worker/worker.py
    # or for tray mode:
    python agent_worker/tray_worker.py
    ```
