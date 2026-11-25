# HeroUI interface change — 30 October 2026

Reference: recording walkthrough_1793371059.mp4, heroui.com homepage, and its public Dashboard, Mail, Chat, Finances, CRM examples. This is a visual adaptation for the existing Vanilla JS application. It does not install HeroUI React or copy paid template source.

Measured reference: Inter; pale neutral canvas, white surfaces; blue accent; 8px navigation corners; compact 14px navigation titles; 12–14px controls; grouped sidebar; metric cards; mail folder/list/reader arrangement; conversation sidebar and plain message canvas. The public CRM example exposes OKLCH background 97.02%/0.0015/253.83, surface 100%/0.0008/253.83, accent 62.04%/0.1950/253.83. Local theme uses corresponding HSL colors and existing semantic status colors.

## UI and backend ownership

| UI elements | Data / action contract | Change |
| --- | --- | --- |
| Navigation, collapsed state, theme | Existing setView / handleRoute, localStorage preferences | Group labels, compact titles, expanded default on desktop and collapsed default on narrow screens; stored preference retained |
| Leads metrics, table, search, filters, next steps | GET /api/leads; filters operate on loaded records; existing create/update/note/sync routes | Presentation only; metric calculations and remarks intact |
| Deals metrics, cards, tables, delivery and payments | GET /api/deals and /api/deals/{id}; existing deal/milestone/deliverable handlers | Presentation only |
| Schedule metrics, capacity, ranked rows, completion | GET /api/schedule/daily?capacity=50; POST /api/schedule/regenerate; POST /api/schedule/{id}/complete | Presentation only; ranking, top 10 and 50-action limits intact |
| Mail aliases, folders, labels, search and pagination | GET /api/mail/overview; GET /api/mail/messages with existing query parameters | Presentation only |
| Mail message selection and reader | messageId, folderId, senderName, recipientName, subject, summary, timestamp from zoho_mail.py list_messages_and_counts; existing openMailThread calls GET /api/mail/messages/{folder_id}/{message_id} and consumes message/thread | New persistent folder message index beside reader at desktop widths; IDs passed through data attributes and existing URL encoding |
| Mail replies, compose, attachments, archive, spam, trash | Existing /api/mail/send, /api/mail/attachments/... and /api/mail/messages/action contracts | Existing handlers retained |
| WhatsApp list, filters, conversation, composer, lead linking | GET /api/whatsapp/central/conversations; GET /api/whatsapp/central/conversations/{phone}; POST /api/whatsapp/central/send and /link | Presentation only; connection status continues to come from existing state |
| Agents, execution history, composer, approval controls | Existing /api/agents, /api/agent/runs, /api/leads/{id}/agent/jobs, /api/actions contracts | Shared surfaces and selected state colors only |
| Integration statuses and controls | /api/integrations/status, /api/integrations/google-tasks/status, /api/admin/whatsapp/status, /api/agent/workers | Shared visual tokens only; status values and connected/disconnected states unchanged |
| Team metrics, admin controls, edit/password dialogs | GET /api/users, GET /api/deals; POST/PUT /api/users; backend require_admin/self-edit restrictions | Shared visual tokens and shell title only; existing authorization preserved |

## Verification

- Required Python unit suite: 25 passed.
- Node syntax check passed for application and staged production bundle.
- node tests/frontend/heroui-contract.cjs: mail selection, encoded identifiers, active state, text escaping, closing reader, list restoration/pagination, member/admin shell controls, API call parity passed. Uses fixtures without live service writes.
- Compared captured production source: all 421 existing inline event binding expressions retained; all 128 API call expressions identical.
- Public production OpenAPI confirms 14 principal route contracts. This checks route presence, not external provider availability.
- Rendered actual frontend templates locally for leads, deals, team, mail, WhatsApp, integrations, schedule and agents. Inspected desktop mail reader, messages, schedule, navigation, and mobile schedule. Fixture data is never deployed.
- Production mail thread GET marks a message read; live thread opening and sending were excluded from the checks. External email delivery, WhatsApp sending, paid provisioning and agent execution have not been exercised.

## Production release scope

Only static/index.html, static/js/app.js and new static/css/heroui-theme.css. Stage is derived from captured live files with nine bounded replacements; preflight requires live hashes to still match. Back up previous static files outside the public web root. Install assets before index, using atomic rename for each file. Do not restart the container. Preserve a rollback script with the backup. Runtime start timestamp must remain unchanged.

Release status: **not deployed**. Automatic approval review rejected the deployment command with "blocked by policy" before execution. Production was not modified by this task. Reviewed files remain in scratch/hero-production-stage; the capture of the original production files is in scratch/hero-production-baseline. These local captures are not a server rollback backup.

## Component revision after walkthrough_1793377774.mp4

The shell-only review was insufficient. The running review now uses `python scripts/preview_ui.py --port 8766`: the real frontend, real FastAPI routes and an isolated copy of the local database. Background ingestion is off; remote connections and external actions are disabled. Do not deploy this local harness or its automatic local account selection.

Added `static/css/heroui-components.css` and `static/js/utils/ui-components.js`. These cover button geometry, icon controls, text fields, dropdown listboxes, keyboard selection/typeahead, checkboxes, badges, table spacing, scrollable table headers, segmented tabs, record cards, deal dialogs, deliverable rows, and modal focus handling. The dropdown retains its original native select, field name/value, form submission, and change handler.

Measured public HeroUI controls: example buttons 32px high / 24px corner radius / 14px text; standard action 36px high; input 36px high / 12px corners / 8px-by-12px padding; table headers 12px / 10px-by-16px padding; table cells 14px / 12px-by-16px padding. Local small buttons use 13px where dense app toolbars need it.

Two functional defects found in the referenced deal dialog were fixed:

- Legacy deliverables are text strings, while the renderer and toggle handler expected objects. `normalizeDealDeliverables` renders both formats, preserves object metadata, and sends normalized objects only when the operator edits a checklist. Source arrays are not rewritten by rendering.
- Engineering and Commercial tabs failed the old substring-based selected-state logic. Explicit tab identifiers now determine selection, ARIA state, and keyboard movement. The dialog uses the existing XL size preset.

Checks for this revision: all 421 existing inline event expressions and all 128 API call expressions retained; both Node contract checks pass; Python unit suite 25 passed in 36.54s. Browser checks on the running app confirmed filtered row counts (60 high / 139 medium), pointer and keyboard dropdown selection, seven restored deal titles, all dialog tabs, popup Escape without dismissing the dialog, modal focus containment, and dark field colors. A real checklist toggle persisted through the local backend, retained all seven titles, and was reversed in the local copy. Navigation to leads, deals, record detail, mail, WhatsApp, agents, integrations, and team was exercised.

Current release scope is **five frontend files**, listed in `scratch/hero-production-stage/manifest.json`. This supersedes the earlier three-file / nine-replacement staging description. The old `scratch/hero-stage.py` helper predates this revision and must not be used to rebuild it. Production remains unchanged.

Affected currency displays now use a shared Indian-unit formatter (`₹K`, `₹L`, `₹Cr`) with boundary checks. Amounts submitted through forms remain numeric. Asset versions were advanced to `hero_components_3` so reloading the running app loads the current JavaScript and CSS. The local server is retained as a hidden process on loopback port 8766; it serves the running application rather than the earlier static fixture pages.

## Production deployment — 31 October 2026, 02:27 IST

**Status: deployed** to https://cos.zero7.space (`hero_density_4`). Exactly the five manifest files were published; live `index.html`/`app.js` matched the captured baseline before mutation (no drift) and the three new assets were absent. `/app/static` is a bind mount of `/opt/cos-theta/static`; files were installed there with same-directory temp files and atomic `mv` (assets first, index last). Container `cos-theta` was not restarted (`StartedAt` 2026-10-30T08:40:30Z unchanged, healthy). Server backup and rollback: `/var/backups/cos-theta-ui/20261031-022707-IST/` (`files/`, `backup.sha256`, `release.sha256`, `metadata.txt`, `rollback.sh` — restores index/app.js atomically and removes the three new files). Gates: node checks, three frontend contracts, `hero-audit.py`, unit suite 25 passed. Authenticated read-only Playwright smoke (all non-GET API calls and mail-thread GETs intercepted; none were attempted): leads (175 rows, all 42px, seven default columns, search/clear, columns dialog, record link), deal dialog with four tabs, schedule, mail list, WhatsApp, agents, integrations, team, light/dark theme, 390px fresh load (collapsed 60px sidebar, no overflow) — zero console/page errors and no failed requests. Database, backend, auth and scheduler were not changed.

## hero_fields_5 — deployed 31 October 2026, ~03:15 IST

Walkthroughs 1793394370 / 1793394652 / 1793395200. Changes: `heroui-theme.css`, `heroui-components.css`, four lines of `app.js` (column-settings dialog uses classes and `size: 'lg'`), `index.html` version. `ui-components.js` unchanged.

- **Fields on white surfaces were invisible** (white fill, 3% shadow). Adopted HeroUI's measured system: fields inside surfaces use a tinted "secondary" fill plus hairline (`--ui-field-bg`, `--ui-field-ring`), hover darkens, focus turns white with a blue ring; cards use HeroUI `--shadow-surface` (`0 2px 4px #0000000a, 0 1px 2px #0000000f, 0 0 1px #0000000f`); placeholders at full muted strength; `--border` 88%.
- **Dialogs collapsed to 200px with centred header/×** — root cause was the FastSave Chrome extension (Profile 24), whose content CSS injects `.modal{height:0vh;align-items:center;justify-content:center;background-color:transparent}` and `:root{--primary:#ea407f}` into every site. Dialog layout is now declared at `.modal.modal-content` specificity and theme tokens at `:root:root` / `html[data-theme="dark"]:root`, so injected sheets cannot override them regardless of order. Verified by loading FastSave's real stylesheet last in Chrome 156 against production: columns dialog 549px, deal dialog 625px, × 24px from the corner, solid backgrounds, blue primary buttons.
- Columns dialog: three-column grid, all 20 options visible without scrolling; selected options tinted.

Backup/rollback: `/var/backups/cos-theta-ui/20261031-024804-IST/rollback.sh` (restores hero_density_4). Container not restarted (StartedAt 2026-10-30T08:40:30Z). Read-only smoke: zero console/page/HTTP errors across leads, record, deals and tabs, schedule, mail, WhatsApp, agents, integrations, team, theme, 390px. Tests: three frontend contracts, hero-audit, 25 unit tests passed. Database/backend/auth/scheduler unchanged.

## hero_followups_6 — deployed 31 October 2026, ~18:05 IST

Walkthrough 1793446781 (schedule the next call from the Outreach Log, get alerted). Changes: `app.js`, `heroui-components.css`, `index.html` version. Theme and `ui-components.js` unchanged. Frontend only; no backend or schema change.

- **Storage:** a scheduled call is the lead's existing `next_action` (`Call: <purpose>`) plus `next_action_date` as an IST timestamp (`2026-11-03T11:00:00+05:30`). AI tasks keep free-text dates ("Today, 2 PM"), so only timestamps count as scheduled calls. Sentinel `OVERDUE_DEADLINE` parses the offset correctly. Each schedule/reschedule/done/cancel writes a lead note for history.
- **Lead record:** "Next call" card above the Outreach Log (presets 1h / tomorrow / 2 days / next Monday / 1 week, date, time limited to 09:00–21:00 IST, purpose; done, reschedule, cancel). Logging a call completes a call due today/overdue; DNP or Follow-up outcomes prompt for the next call.
- **Follow-ups page** (`#/followups`, sidebar with due-count badge): overdue / today / tomorrow / this week / later, plus "Needs a next call" for active-stage leads with nothing scheduled. Lead table Due cell shows the call time coloured by bucket.
- **Alerts:** while the CRM is open, a toast and desktop notification fire 5 minutes before each call (once per call time); leads refresh every 5 minutes.
- **AI protection:** single-lead task regeneration asks before replacing a scheduled call; "Generate all" restores scheduled calls afterwards. Known gap: a non-admin's "Generate all" could still overwrite calls it cannot read back; fixing that needs a backend change.
- `.ui-segmented .btn-pill` active state added (also fixes Daily Schedule tabs).

Backup/rollback: `/var/backups/cos-theta-ui/20261031-180015-IST/rollback.sh` (restores hero_fields_5; drift gate confirmed live = hero_fields_5 before publish). Host and container hashes verified, HTTPS hashes match. Container not restarted by the deploy (StartedAt 2026-10-31T12:09:38Z before and after). Read-only smoke: zero console/page/HTTP errors and no blocked writes across leads (175), record with Next call card, Follow-ups (0 scheduled, 115 needing a next call), deals and tabs, schedule, mail, WhatsApp, agents, integrations, team, theme, 390px. Tests: four frontend contracts (incl. `tests/frontend/follow-ups.cjs`), hero-audit (128 baseline API calls preserved in order plus 7 declared follow-up calls), 25 unit tests passed. No real calls were scheduled on production.

## hero_leadflow_7 — deployed 2 November 2026, ~01:55 IST

Walkthroughs 1793527968 / 1793561214. Changes: `app.js`, `heroui-components.css`, `index.html` version. Frontend only.

- **Form labels:** 36 Meta-webhook leads carry the stale field key `what_is_your_approximate_monthly_revenue?` while answers are employee bands (the live Instant Form question is correct; Meta keeps the original key). Display relabels it "How many employees work in your company?" when answers are bands, and humanises keys/answers. Stored data is unchanged, so AI features reading `form_answers` still see the old key (backend fix pending).
- **Prev/next lead:** pager beside the page title (`N of M`) plus J/K keys, following the list the lead was opened from (Leads table with its filters, or Follow-ups), falling back to Leads order.
- **Lead flow** (HubSpot-style New → Attempting → Connected → Qualified → Deal / Lost) shown as a stepper under the lead header (replaces call-stage and status badges) with the next step. Outreach Log outcomes are grouped (No answer, Busy · call later | Spoke · follow up, Interested, Meeting booked, Not interested), required, and update `call_stage` and `status` together (status only forward, never off won; Not interested → lost and cancels the scheduled call). Notes required for connected outcomes. No-answer retries suggest 1h → next day → 2 days → weekly; after 6 attempts suggests Not interested.
- **"Speed to lead call (< 5 mins)" placeholder** is no longer displayed: uncontacted leads show "First call · waiting Nd" (red after 5 min), contacted leads without a task show "Set next step"; the static "Today, 2 PM" due text is hidden for placeholders.

Backup/rollback: `/var/backups/cos-theta-ui/20261102-014935-IST/rollback.sh` (restores hero_followups_6; drift gate passed). Host, container and HTTPS hashes verified; no restart (StartedAt 2026-10-31T12:09:38Z unchanged). Read-only smoke: zero console/page/HTTP errors, no blocked writes; leads (175, no placeholder shown), lead record (pager 3 of 175, J and ‹ work, six outcomes, employee label), follow-ups, schedule, deals, WhatsApp, agents, team, 390px. Tests: four frontend contracts, hero-audit (128 baseline calls in order + 8 declared, four outcome handlers replaced by generated ones), 42 unit tests.

Open: ad creatives — 0/175 leads have one; `backend/app.py:493` nests the Meta creative fetch under `if ldata.get("platform")`, stored Meta CDN thumbnails expire, Drive lookup matches only "Ad N" filenames, Meta fallback needs ads_read. Server-side read-only diagnosis not yet run.

## hero_notes_10 / hero_notes_11 — deployed 2 November 2026, ~12:13 and ~12:16 IST

Frontend only (`app.js`, `heroui-components.css`, `index.html`). Contents:
- **Dashboard** (`#/dashboard`, first sidebar item): KPIs (open hot leads + calls due, open proposals + ₹, invoiced-unpaid from deal milestones marked due + ₹ not billed, collected vs won), weekly new-leads-by-temperature stacked bars (8 IST weeks; palette validated light `#c42b3c/#c98a12/#3b6fd8`, dark `#e5566f/#bd8419/#5b8ff0`, legend counts + hover tooltip + sr-only table), "Where leads are" by flow step, and Hot leads / Proposals / Invoices lists. There is no invoice entity; milestones with status due/overdue/invoiced/sent count as invoiced.
- **Call-flow gaps:** No answer auto-schedules the retry (1h → next day → 2 days → weekly, stops after 6); missed calls log 0 min and hide duration/recording; Interested/Meeting booked → hot, Not interested → cold; an attached video meeting moves New/Attempting to Connected; header next step refreshes with the Next call card; stale tabs get a "new version · Reload" banner (5-min check + on tab focus).
- **Binary notes:** 17 notes on 7 leads hold PDF/PNG/ZIP bytes decoded as UTF-8 by the WhatsApp daemon (`scratch/updated_daemon.js`, fixed in source + `scratch/prepare_updated_daemon.py`; not yet running wherever the daemon is hosted). They now render as a file card; stored data unchanged.
- **hero_notes_11:** audio recordings use `preload="none"`. Concurrent Drive recording downloads through the shared Google API client crashed the backend (`[SSL] record layer failure` → `double free or corruption`, exit 139; RestartCount 2, latest 2026-11-02 06:43:38Z, triggered by the hero_notes_10 smoke opening a lead with five Drive recordings). Backend fix still needed (per-thread Drive client / lock, Range support on `/api/recordings/drive/*`).

Backups/rollback: hero_notes_10 `/var/backups/cos-theta-ui/20261102-121300-IST/rollback.sh` (→ hero_leadflow_7), hero_notes_11 `/var/backups/cos-theta-ui/20261102-121540-IST/rollback.sh` (→ hero_notes_10). Deploys did not restart the container. HTTPS hashes verified. Read-only smoke on hero_notes_11: zero console/page/HTTP errors, no blocked writes; leads, pager/J, outcomes, file cards (Mahtab Alam: 4, no raw bytes), dashboard, follow-ups, schedule, deals, WhatsApp, agents, team, 390px. Tests: four frontend contracts, hero-audit (128 baseline + 9 declared), 42 unit tests.

Storage audit (2 Nov, code-level, verified in code for the top items): unsigned base64 auth tokens (`backend/auth.py`); no automated DB backups; `Repository.update_call_recording_drive` missing (`routers/calls.py:175`); uncommitted writes at `backend/database.py:698,710,726,744`; startup migration deletes notes LIKE 'CREATED%' (`backend/db/migrations.py:340`); sheet sync overwrites priority/notes and matches by name. None fixed yet — all backend.

The subsequent walkthrough_1793382567.mp4 density revision supersedes the earlier lead-table layout and broad pill styling. See `UI_DENSITY_REVIEW.md` for the full review, one-value column mapping, saved-preference migration, button inventory and measured improvement from four to twelve complete rows at 1440×900. Assets now use `hero_density_4`. All 128 API call expressions remain identical; equivalent task-generation branches were consolidated while preserving all 322 distinct existing event expressions. Production remains unchanged.
