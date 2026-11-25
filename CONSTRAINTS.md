# CONSTRAINTS.md: Quality Contracts & Frozen Invariants
**Project**: `COS Theta` (zero7.space)  
**Standard**: Institutional Reliability, IPO-Grade Engineering & Operational Rigor

---

## 1. Frozen Invariant Zones (Zero-Regression Barriers)

### Invariant 1: Google Sheet Remark Preservation
- Columns parsed:
  - Column 14: `what_is_your_approximate_monthly_revenue?` (or employee count e.g. 50-200)
  - Column 15: `full_name`
  - Column 16: `NEXT STEP` (critical team operational remarks)
  - Column 17: `Priority` (`high`, `medium`, `low`, `lost`, `won`)
  - Column 18: `phone_number`
  - Column 19: `company_name`
  - Column 20: `email`, Column 21: `city`
  - Column 22: `UPDATES` (ongoing team context & software requirements)
  - Column 23: `MEETING` (`Y` / `N`)
  - Column 24: `Call Brief / Additional Notes`
- **Rule**: Never flatten, truncate, or overwrite Column 16 (`NEXT STEP`) or Column 22 (`UPDATES`) with generic AI summaries. These remarks contain ground-truth human context.

### Invariant 2: Daily Schedule Capacity & Allocation Budget
- Daily human execution bandwidth is strictly capped at **50 actions maximum**.
- **Slots 1–10 (Top Needle Movers)**: Must be exclusively reserved for **Disproportionate Returns** accounts (high business scale e.g. 50–200 employees, ₹25L–₹50L+ revenue, or late-stage closing momentum: Advance Collection, Quotation Closing, Prototype Presentation).
- **Slots 11–20 (Necessity Commitments)**: Must capture hard calendar commitments ("meeting on 23rd", "call at 2 PM", "today callback") and lead decay alerts.
- **Slots 36–50 (Squeeze Queue)**: Early exploratory tasks squeezed into response gaps; never permitted to displace high-yield accounts.

### Invariant 3: Calling Hours & Compliance
- **TRAI Calling Hours (09:00 to 21:00 IST)**: No outbound automated call triggers, scheduled call alerts, or Knowlarity bridges outside 09:00:00 to 20:59:59 IST.
- **Timezone**: Indian Standard Time (IST, UTC+5:30) across all UI displays, logs, and database records.
- **Currency Standards**: Indian financial units strictly (`₹K`, `₹L`, `₹Cr`). Never display "million" or "billion".

### Invariant 4: Blank/Empty Lead Prevention (Enforced Oct 27, 2026)
- **Zero Empty Leads Rule**: Under no circumstance may a lead record be created or ingested if both `name` and `phone` are blank/null.
- Trailing empty rows or formula artifacts in Google Sheets must be skipped at the start of the row iteration loop before ID generation or DB insertion.
- Any invocation of `Repository.create_lead` with blank name and phone must immediately raise a `ValueError`.

### Invariant 5: Testing & Verification Gate
- Every change to scheduling math, ranking weights, sheet parsing, or database schemas must have automated unit tests.
- Full test suite (`python -m pytest tests/unit/`) must remain **100% green (25/25 passed)** before pushing or deploying to the production Droplet.
