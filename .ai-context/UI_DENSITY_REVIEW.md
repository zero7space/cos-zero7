# Interface density and control review — 30 October 2026

Reviewed walkthrough_1793382567.mp4 (136.9 seconds), the running local application, and HeroUI's public component and Finances examples. This revision implements the user's request for more visible leads and one data value per table cell.

## Findings and implemented changes

| Area | Finding | Implemented result |
| --- | --- | --- |
| Name | Name, avatar and phone were stacked together | Name only; keyboard-accessible record link |
| Company | Company, city and delivery-deal badge shared one cell | Company only; city and delivery deal are separate optional columns |
| Next action | Action, priority dot, due date and regeneration control created multiple lines | One action value; due date is optional; generation remains a small ghost control |
| Received | Exact timestamp and relative age were stacked | Timestamp in IST and relative age have separate optional columns |
| Status | Pipeline status and delivery-deal indicator were combined | Pipeline status only; delivery deal is an optional column |
| Owner | Avatar and name repeated the same identity | Owner name only |
| Notes | Framed field and round save button drew attention in every row | Optional column with a quiet inline field, full note tooltip and a small save control |
| Default columns | Ten columns included notes, uploads, stage and redundant actions | Seven defaults: Name, Company, Phone, Priority, Next action, Status, Owner |
| Row height | Company/action wrapping produced tall, variable rows | Fixed 42px single-line rows; full text remains in the DOM and title, with full details available in the record |
| Summary cards | Large padding, decorative icon blocks and extra trend labels consumed height | Compact 72px summary cards with label/value and simple icons |
| Filters | Rounded white containers and shadows made every filter look like an action button | Flat, 32px ghost filter triggers; selected filters keep a visible accent state |
| Badges | Large pill styling was applied broadly | Small status chips, distinct from actionable buttons |
| Icon actions | Repeated filled circular discs cluttered cells | Transparent icon controls, subtle hover surface, visible keyboard focus |
| Forms and dialogs | Field shadows and button variants varied between custom components | Reduced resting shadow; shared solid, neutral, ghost and destructive variants |

## Measured result

Same browser tab and 1440×900 desktop viewport, expanded navigation, unfiltered data:

| Measurement | Before | After |
| --- | --- | --- |
| Complete visible lead rows | 4 | 12 |
| Row heights | First six: 84.8–105.8px | All 446 rows: 42px |
| Table body top | 428.7px | 320.8px |
| Default columns | 10 | 7 |
| Horizontal overflow in default table | Not recorded | None at this viewport |

The result is three times as many complete visible rows. This is deliberately denser than HeroUI's approximately 60.8px Finances rows, following the user's explicit density instruction. The source example's solid/neutral/ghost button variants use 32px height, 24px corners and no shadow; the application preserves that distinction rather than rounding every component into the same shape.

## Data and preference handling

| Column | Backend field or lookup |
| --- | --- |
| Name / Company / Phone / Email / City | leads.name / business_name / phone / email / city |
| Next action / Due | leads.next_action / next_action_date |
| Received / Lead age | leads.created_at, displayed through date formatters |
| Priority / Status / Call stage / Temperature / Source | Corresponding lead properties |
| Owner | users lookup through leads.assigned_to |
| Delivery deal | Existing deals lookup through deals.lead_id |
| Internal note | Existing last_update_notes display and existing POST /api/leads/{id}/notes action |

No source lead fields are combined, overwritten or shortened by rendering. Ellipsis is a visual overflow treatment, and title attributes contain complete values. Notes are retained in full. Database schemas, ingestion, scheduling math and execution limits are unchanged.

Column preferences now have a version. The previous default layout migrates to the seven-column layout. Existing custom layouts migrate bundled data into separate columns, with the original preference backed up under zero7_lead_columns_v1_backup. Version 2 selections retain their chosen columns and order. Malformed preferences fall back safely. Name remains fixed; all other 19 columns can be selected independently.

## Component inventory reviewed

- **Navigation:** sidebar items, expand/collapse, back controls, theme and profile actions remain structural controls rather than pill buttons.
- **Leads:** summary metrics, search, six filters, columns dialog, row links, status chips, optional note/upload/action controls and table scrolling.
- **Record detail:** inputs, select menus, phone/video buttons, four outcome controls, inline notes and record actions use the shared variants. The four outcome controls were checked at 30px height with no resting shadow.
- **Deals:** card actions, links, segmented dialog tabs, checklist controls, inputs and payment/contract fields retain their existing handlers.
- **Mail:** alias/folder controls, compose, action icons, pagination, reader and attachment controls. Checked 12 cached rows, a shadow-free compose button and transparent action icon backgrounds.
- **Messaging and agents:** account/filter controls, compose/attach/send controls, model/skill selectors, prototype controls and approval/rejection variants remain connected to their existing logic.
- **Integrations and team:** status displays, connection actions, role selectors, edit/password controls and shared dialogs inherit the same component rules.

This is a local database-snapshot review. External provider availability, message delivery, agent execution and production deployment are not asserted by these checks. Narrow-screen resizing was requested through the browser capability, but the tab reported a desktop viewport; a 390px mobile result is not claimed for this revision.

## Verification

- Python unit suite: **25 passed in 34.82s**.
- Node checks: lead density/preferences, deal components and mail/API contracts all passed.
- All 128 API call expressions and all 322 distinct existing event expressions are preserved. Two equivalent generation branches became one conditional control.
- Browser: all 446 rows have a 42px height; headers and cells align; default layout has no horizontal overflow; optional City and Due columns remain single-line and persist after reload; reset restores seven columns.
- Browser: High filter returns 60 rows, search for Empress returns one row, clearing search restores 446; opening a name reaches the actual record.
- Browser: settled dark mode uses dark table surfaces and light text. Resting filter/icon shadows were removed; focus outlines remain.

Current assets use the version `hero_density_4`. The running review is at http://127.0.0.1:8766/?ui=compact-4#/leads. The query ensures an old open tab loads the revised assets. Production remains unchanged.
