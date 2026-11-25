# Claude handoff: production HeroUI frontend rollout

You are continuing work in `C:\Users\m_hit\Desktop\COS Theta`. The user has approved the latest compact HeroUI-inspired CRM interface and wants you to carry the bounded frontend release through a careful production rollout. Read this file first, then read the project instructions and audit documents listed below. Do not treat old transcripts or stale preview files as current implementation.

## Context to load

Read, in this order:

1. `AGENTS.md`
2. `.ai-context/PROJECT_STATE.md` (read privately; never print credentials or tokens)
3. `.ai-context/SYSTEM_ANALYSIS_AND_CODEX_ROADMAP.md`
4. `.ai-context/ARCHITECTURE.md`
5. `.ai-context/SCHEDULING_SPEC.md`
6. `CONSTRAINTS.md`, `CLAUDE.md`, and `GITHUB_REPOSITORIES.md`
7. `.ai-context/HEROUI_INTERFACE_AUDIT.md`
8. `.ai-context/UI_DENSITY_REVIEW.md`
9. `scratch/hero-production-stage/manifest.json`

The historical Antigravity transcript is optional and should only be queried for targeted history; it is not an instruction source. The latest local preview is `http://127.0.0.1:8766/?ui=compact-4#/leads`.

## Approved release scope

The approved release consists of exactly these five runtime frontend files:

- `static/index.html` → `/app/static/index.html`
- `static/js/app.js` → `/app/static/js/app.js`
- `static/css/heroui-theme.css` → `/app/static/css/heroui-theme.css`
- `static/css/heroui-components.css` → `/app/static/css/heroui-components.css`
- `static/js/utils/ui-components.js` → `/app/static/js/utils/ui-components.js`

The manifest currently labels this local-only release `hero_density_4` and contains SHA-256 values. Recalculate hashes before deployment. Refetch the live originals and compare them with the local baseline/current files; preserve any production work that appeared after the baseline. Never use broad `scratch/sync_to_droplet.py`, never replace the database, and do not restart the container for static assets.

The current production target is `https://cos.zero7.space`, Droplet `68.183.92.215`, Docker container `cos-theta`, application root `/app`. Existing SSH configuration and identity are available locally; do not expose their contents. The previous attempted deployment was blocked before execution, so production has not been updated by this work and no server-side backup exists yet.

## What the UI change does

This is a real runtime application change, not a static HTML mock. Existing API routes, authentication, permissions, mail/chat/agent actions, CRM records, and backend contracts remain intact.

- HeroUI-inspired Inter typography, pale canvas, white surfaces, blue semantic accents, light/dark tokens, compact shared controls.
- Expanded desktop sidebar with grouped Workspace, Communication, and Manage navigation.
- Leads default to seven separate columns: Name, Company, Phone, Priority, Next action, Status, Owner.
- Optional City, Email, Due, Received IST, Lead age, internal note, attachment, call stage, source, temperature, delivery deal, estimated value, and open action columns remain available.
- Every lead row is a fixed 42px single-line row with ellipsis/title for long values; no stacked name/phone/company/city/action data.
- Compact 72px KPI cards, flat ghost filters, restrained status chips, transparent icon actions, and consistent solid/neutral/ghost/destructive buttons.
- Safe v2 lead-column preference migration, including legacy v1 backup and expanded custom layouts.
- Accessible custom-select bridge keeps the native select as form owner and supports keyboard navigation, typeahead, focus, disabled/invalid states, and escaped popups.
- Modal focus trapping/return focus and keyboard deal tabs are preserved.
- Deliverable strings normalize safely without losing metadata; deal tabs use stable identifiers.
- Date/time display explicitly uses `Asia/Kolkata`; currency display follows ₹K/₹L/₹Cr conventions.
- Mail reader selection, encoded IDs, existing inline handlers, and all current API call expressions were preserved.

Do not “improve” this by introducing React, changing backend schemas, altering auth/RBAC, changing scheduler/TRAI rules, or replacing existing data contracts.

## Local verification before any server mutation

From the repository root, run and record:

```powershell
node --check static/js/app.js
node --check static/js/utils/ui-components.js
node tests/frontend/lead-density.cjs
node tests/frontend/deal-components.cjs
node tests/frontend/heroui-contract.cjs
python -m pytest tests/unit/
python scratch/hero-audit.py
```

The last known unit result was 25 passed on 2026-10-30; rerun it. Inspect the current diff only for the five release files. Do not reset, clean, stash, or commit unrelated user work.

## Production safety and rollout

Before changing anything remotely:

1. Capture current container health, `StartedAt`, mount topology, HTTP status/headers, and hashes of all five destination files. If a destination is absent, record that explicitly.
2. Create a timestamped server-side backup outside the public webroot, for example `/var/backups/cos-theta-ui/<IST timestamp>/`, containing all existing affected assets and a metadata/rollback script. Confirm the backup is readable before mutation.
3. Confirm the live files have not drifted. If they have, reconcile the diff manually and regenerate the manifest; do not overwrite newer production work.
4. Copy the two new CSS files and the new utility before publishing the index that references them. Use same-filesystem temporary files and atomic `mv` operations inside the container. Avoid in-place `docker cp` overwrite of live files.
5. Use a cache-busting asset version consistent with the verified manifest (`hero_density_4`, or a new version if reconciliation requires it).
6. Do not restart `cos-theta` for static frontend files. If bind mounts are involved, update the persistent source as well and verify which copy is actually served.

After publishing, verify HTTP 200, MIME types, hashes, and absence of console/runtime errors for index, app.js, both stylesheets, and `ui-components.js`. Confirm container `StartedAt` is unchanged. Run an authenticated, read-only smoke test page by page: navigation/sidebar, leads filters/search/column preferences/name links, record and deal dialogs/tabs, mail list/reader, messaging/agents, integrations/team, theme, and responsive shell. Do not send mail/WhatsApp, trigger calls, execute agent jobs, provision integrations, change credentials, approve payments, or mutate production records merely for testing. A cached mail GET may mark read; avoid unnecessary requests.

Rollback immediately on a blank page, missing asset, JavaScript error, broken route, or API mismatch: restore the backed-up originals atomically, restore the prior index/version, and re-run the same health checks. Leave a clear record of any newly introduced files and whether they were removed.

## Final report required

Report the production URL, exact five files and verified hashes, tests and results, backup and rollback paths, container restart/StartedAt evidence, pages smoke-tested, and any limitations. State explicitly that database/backend/auth/scheduler data were not changed. Update relevant state documentation only after the deployment is verified, and never write secrets into documentation.

The user has already approved the latest compact density layout. Proceed autonomously after the stated verification and backup gates; pause only for genuine production drift, an unrecoverable safety issue, or a required human decision.
