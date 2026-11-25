# CLAUDE.md: Operational Directives & Standards
**Project**: `COS Theta` (zero7.space)
**Target**: Institutional Reliability, High-Leverage Sales Optimization

---

## 1. Core Operating Philosophy
- **Capital Per Unit Time**: The product exists so that AI handles everything possible, freeing humans only for what machines cannot do (closing conversations, high-stakes relationship building).
- **Two Task Classes**:
  1. **Disproportionate Returns**: High-scale clients (revenue ₹25L-50L+, 50-200+ employees), proposal delivery, costing finalization, demo presentation, advance collection.
  2. **Necessity Tasks**: External commitments, fixed calendar dates, compliance formalities, preventing client relationship blowups.
- **Daily Budget**: 50 actions maximum. If only 10 get executed, those 10 MUST move the needle of the bank account. Squeeze secondary tasks into waiting gaps.

---

## 2. Formatting & Standards
- **Currency**: Indian numbering conventions ALWAYS:
  - Thousands: `₹25K`
  - Lacs: `₹1.5L` / `₹25L`
  - Crores: `₹1.2Cr`
  - Never display "million" or "billion".
- **Timezone**: Indian Standard Time (IST, UTC+5:30) for all dates, logs, and UI displays.
- **Calling Hours**: Respect TRAI regulations (09:00 to 21:00 IST).

---

## 3. Data Integrity & Safety Guardrails
- **No Overwriting Ground Truth**: Never overwrite team notes from Google Sheets or WhatsApp with generic AI text.
- **Idempotency**: All background synchronization and scoring loops must be idempotent.
- **Droplet Sync**: The production Droplet container is `cos-theta` at `68.183.92.215`. Primary OmniRoute node is `http://100.101.21.96:20128/v1`.
