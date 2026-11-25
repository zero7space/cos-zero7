# Fluid UI — Design System & Style Reference
> Extracted & Refined from Davis Uche's Fluid UI Kit & Design System

**Theme:** Light (Fluid Modern)

Fluid UI transforms the Zero7 Operating System from an austere monochromatic blueprint into a vibrant, polished, and ergonomic enterprise suite. Built upon pure white card surfaces (`#FFFFFF`) floating on a luminous periwinkle canvas (`#F8FAFD`), illuminated by vibrant Fluid Electric Blue (`#2F80ED`) interactive accents, and stabilized with deep slate typography (`#1E293B`) set in Inter.

---

## 🎨 Tokens — Colors

| Token Name | Hex Value | CSS Variable | Semantic Purpose |
|------------|-----------|--------------|------------------|
| **Primary Fluid Blue** | `#2F80ED` | `--color-primary` | Primary action buttons, active navigation state, key brand highlights |
| **Primary Hover** | `#2563EB` | `--color-primary-hover` | Interactive hover state for primary elements |
| **Primary Light** | `#EBF3FE` | `--color-primary-light` | Soft tinted background for active navigation pills, badges, selection states |
| **Canvas** | `#F8FAFD` | `--color-canvas` | Main viewport and workspace background |
| **Paper Surface** | `#FFFFFF` | `--color-paper` | Card panels, floating dropdowns, table bodies, modal cards |
| **Surface Alt** | `#F1F5F9` | `--color-surface-alt` | Table header background, neutral filter pills, secondary surface fills |
| **Ink** | `#1E293B` | `--color-ink` | Primary display and body text (Slate 800) |
| **Ink Soft** | `#334155` | `--color-ink-soft` | Subheadings, section captions, card labels |
| **Mid Gray** | `#64748B` | `--color-mid-gray` | Muted metadata, helper labels, resting icon strokes |
| **Hairline** | `#E2E8F0` | `--color-hairline` | Subtle dividers, card borders, input resting borders |
| **Success** | `#27AE60` | `--color-success` | Won deals, verified integrations, connected status |
| **Success Light** | `#EAF7EE` | `--color-success-light` | Background tint for success badges |
| **Warning** | `#F2994A` | `--color-warning` | Follow-ups due, pending tasks, warm temperature leads |
| **Warning Light** | `#FEF6EC` | `--color-warning-light` | Background tint for warning badges |
| **Danger / Critical** | `#EB5757` | `--color-danger` | Lost deals, DNP calls, hot high-priority urgency |
| **Danger Light** | `#FDEEEE` | `--color-danger-light` | Background tint for critical badges |
| **Purple Accent** | `#6544EA` | `--color-purple` | Unexplored leads, AI research solutions, VIP client tags |
| **Purple Light** | `#F4F0FD` | `--color-purple-light` | Background tint for AI & VIP badges |

---

## 🔤 Tokens — Typography

### Inter — Primary Interface Font
Fluid UI uses **Inter** across the entire software application.

- **Weights:** Regular (400), Medium (500), SemiBold (600), Bold (700)
- **Scale:**
  - **Caption / Badges:** 11.5px – 12px (Medium / SemiBold, tracking: +0.02em)
  - **Body Text:** 13.5px – 14px (Regular / Medium, line-height: 1.45)
  - **Subheadings:** 15px – 16px (SemiBold, letter-spacing: -0.2px)
  - **Card / View Titles:** 18px – 20px (SemiBold, letter-spacing: -0.3px)
  - **KPI Metrics:** 26px – 32px (Bold, letter-spacing: -0.5px)

---

## 📐 Tokens — Spacing, Elevation & Radii

### Border Radii
* **Cards & Containers:** `16px` (`--radius-card`)
* **Modals & Dialogs:** `20px` (`--radius-modal`)
* **Buttons & Inputs:** `10px` (`--radius-btn`, `--radius-input`)
* **Status Badges & Category Pills:** Full Pill `9999px` (`--radius-pill`)

### Elevation Shadows
* **Card Ambient:** `0 4px 20px -2px rgba(26, 43, 76, 0.05), 0 2px 6px -1px rgba(26, 43, 76, 0.03)`
* **Card Hover:** `0 12px 30px -4px rgba(26, 43, 76, 0.08), 0 4px 12px -2px rgba(26, 43, 76, 0.04)`
* **Modal Elevation:** `0 24px 48px -8px rgba(15, 23, 42, 0.16), 0 12px 24px -4px rgba(15, 23, 42, 0.08)`
* **Primary Focus Ring:** `0 0 0 3px rgba(47, 128, 237, 0.18)`

### Easing Transitions
* **Fluid Smooth:** `all 0.25s cubic-bezier(0.16, 1, 0.3, 1)`
* **Fluid Fast:** `all 0.15s cubic-bezier(0.16, 1, 0.3, 1)`

---

## 🧩 Component Architecture

### 1. Collapsible Navigation Rail
- Background `#FFFFFF` with hairline right border `#E2E8F0`.
- Brand badge featuring Fluid electric blue gradient with bold `Z7` mark.
- Navigation items: rounded 10px pills with smooth hover `#F1F5F9` and active state `#EBF3FE` with electric blue `#2F80ED` text and icon strokes.
- Active item features an elegant left blue indicator bar.

### 2. Fluid Top Navigation
- Clean 64px header with contextual breadcrumb, section title, and primary actions.
- Fluid pill search bar with search icon, clear button, and keyboard hint (`⌘K`).

### 3. Fluid KPI Metric Cards
- 4-column responsive grid at the top of pipeline views.
- Clean rounded card with colored circular icon badges (Blue, Amber, Purple, Green).
- Prominent metric figures with delta trend badges.

### 4. Fluid Table System
- Rounded card enclosure (`16px`), overflow hidden, and clean hairline border.
- Header row styled in `#FAFCFE` with uppercase tracked text.
- Table rows illuminate with a soft blue tint (`rgba(47, 128, 237, 0.035)`) on hover.
- Color-coded Fluid pill badges for statuses, call stages, and priorities.
- Inline note input with smooth focus glow ring.

### 5. Frosted Glass Modals
- Backdrop blur `backdrop-filter: blur(8px)` with soft overlay `rgba(15, 23, 42, 0.45)`.
- Modal card with `20px` radius, smooth entry pop animation (`modalPop`), and primary action buttons.
