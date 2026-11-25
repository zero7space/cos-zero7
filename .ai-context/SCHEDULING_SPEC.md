# SCHEDULING_SPEC.md: Capital-Per-Unit-Time Scheduling Algorithm Specification

## 1. Mathematical Scoring Function

Each lead $L$ is evaluated with an Expected Capital Velocity Score ($EV$):

$$EV(L) = \text{ScaleScore}(L) \times \text{MomentumScore}(L) \times \text{UrgencyMultiplier}(L)$$

### A. ScaleScore (0 to 100)
Derived from company employee count and monthly revenue:
- **Employee Count**:
  - `200+`: 100 points
  - `50-200`: 85 points
  - `11-50`: 55 points
  - `2-10`: 25 points
  - `1` / `just_me`: 10 points
- **Monthly Revenue**:
  - `₹25L - ₹50L` or above: 95 points
  - `11-50` / `2-10`: 50 points
- **Business Nature**:
  - Manufacturing / Multi-unit distribution / Clinic chain: $+20$ points
  - Managing in Excel/Tally/Paper: $+15$ points
  - Mention of ERP / complex billing: $+15$ points

### B. MomentumScore (0.2 to 1.0)
Based on stage of deal closure:
- Proposal sent / Costing discussion: $1.0$ (Immediate revenue event)
- Advance payment / Closing discussion: $1.0$
- Prototype demo scheduled / ready: $0.85$
- Technical discovery meeting booked / agreed: $0.70$
- Speed-to-lead fresh inquiry: $0.50$
- Uncontacted / Unexplored: $0.30$
- Lost / DNP with no response: $0.10$

### C. UrgencyMultiplier (1.0 to 2.5)
- Commitment made for today / specific calendar date: $2.5\times$
- Overdue follow-up / Sentinel alert ($\ge 1.3$ days touchpoint gap): $1.8\times$
- High-priority flag from team: $1.5\times$
- Normal pacing: $1.0\times$

---

## 2. Dual-Tier Taxonomy

1. **⚡ Disproportionate Returns**:
   - $EV \ge 60$ OR Late-Stage Deal (Proposal/Advance/Demo) with known business scale.
   - These are the top 10–15 accounts that generate $\ge 80\%$ of quarterly revenue.
2. **⚠️ Necessity Tasks**:
   - Explicit calendar commitments ("meeting on 23rd", "call at 2 PM", "call Monday").
   - Critical fatigue prevention (avoiding prospect drop-off).
   - Formality or operational gate (e.g. sending promised deck/SOP before call).
3. **🔄 Squeeze Queue**:
   - Inquiries with $EV < 40$ or fresh speed-to-lead checks.
   - Handled strictly in interstitial time windows while waiting for whale client responses.

---

## 3. Daily Capacity Budget
- Total actions per day: **50 maximum**.
- Execution Order:
  - Slots 1–10: **⚡ Top 10 Disproportionate Returns**
  - Slots 11–20: **⚠️ Today's Necessity Commitments**
  - Slots 21–35: Remaining High/Medium pipeline deals
  - Slots 36–50: **🔄 Squeeze Queue** (interstitial speed-to-lead)
