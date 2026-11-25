# AGENTS.md: Local Agent Directives & Universal Context Hub
**Workspace**: `COS Theta` (zero7.space)  
**Standard**: Institutional IPO-Grade Engineering & Commercial Rigor  
**Core Strategic Thesis**: The Game is **Capital Per Unit Time**. Maximize revenue velocity by spending time on disproportionate return actions first, followed by hard necessity commitments, squeezing minor tasks into response gaps. Daily capacity is strictly capped at 50 actions.

---

## 1. Single Source of Truth
Every AI coding tool (Antigravity, OpenAI Codex CLI, Claude Code CLI) operating in this repository MUST read and follow:
- [`.ai-context/PROJECT_STATE.md`](file:///c:/Users/m_hit/Desktop/COS%20Theta/.ai-context/PROJECT_STATE.md): Active git branch (`main`), live Droplet container (`cos-theta` on `68.183.92.215`), OmniRoute endpoints (`http://100.101.21.96:20128/v1`), uncommitted state.
- [`.ai-context/SCHEDULING_SPEC.md`](file:///c:/Users/m_hit/Desktop/COS%20Theta/.ai-context/SCHEDULING_SPEC.md): Mathematical Expected Value scoring ($EV = \text{Scale} \times \text{Momentum} \times \text{Urgency}$), Disproportionate Returns vs Necessity taxonomy, 50-call capacity rules.
- [`.ai-context/ARCHITECTURE.md`](file:///c:/Users/m_hit/Desktop/COS%20Theta/.ai-context/ARCHITECTURE.md): System modules, SQLite tables (`zero7_crm.db`), data ingestion pipelines, Droplet container topology.
- [`CONSTRAINTS.md`](file:///c:/Users/m_hit/Desktop/COS%20Theta/CONSTRAINTS.md): Quality contracts, frozen invariant zones (TRAI hours, zero dropped sheet remarks, zero empty leads).
- [`GITHUB_REPOSITORIES.md`](file:///c:/Users/m_hit/Desktop/COS%20Theta/GITHUB_REPOSITORIES.md): Master matrix of external open-source repositories, agent skills, scrapers, and video/UI engines.
- [`CLAUDE.md`](file:///c:/Users/m_hit/Desktop/COS%20Theta/CLAUDE.md): Foundation non-negotiables, Indian financial standards (₹K, ₹L, ₹Cr), IST timezone.
- **Living Memory (Antigravity Transcript)**:
  - Compact: `C:\Users\m_hit\.gemini\antigravity\brain\cdb5bb33-8b97-4a6f-8855-662142f5207a\.system_generated\logs\transcript.jsonl`

---

## 2. Multi-Agent 3-Role Operating Model
- **Coordinator & Integrator (Antigravity)**: Owns overall system orchestration, task decomposition, dependency allocation, final merge queue, context synchronization, and user interaction.
- **Bounded Implementer (Claude Code CLI / Codex CLI)**: Implements assigned modules in isolated branches/files. Writes tests first (TDD), applies the Ponytail minimalist ladder, and never touches files outside assigned scope.
- **Independent Verifier & Reviewer (Codex CLI)**: Conducts fresh-context adversarial review of diffs against specs and frozen constraints using model `gpt-6-luna` (Sol 6 light version).

---

## 3. Ambition Framework (Felix Rieseberg Tutorial Standard)
All agents must operate across four foundational dimensions:
1. **Speed**: Automate repetitive CRM and pipeline tasks end-to-end so human attention is preserved exclusively for high-leverage closing conversations.
2. **Altitude**: Elevate goals from micro-tasks ("schedule call for lead X") to macro economic outcomes ("maximize capital per unit time; ensure the first 10 actions taken today move the bank account the most").
3. **Depth**: Demand expert domain rigor, strict schema enforcement, verifiable metrics, mathematical expected-value ranking, and external validation rather than surface-level grading.
4. **Range**: Synthesize interdisciplinary perspectives—sales psychology, executive prioritization, algorithmic queueing theory, CRM automation, and live WhatsApp/sheet intelligence.

---

## 4. Direct CLI Dispatch Protocol
When invoking the OpenAI Codex CLI:
- **CLI Binary**: `codex-cli 0.164.0` (installed and trusted for `C:\Users\m_hit\Desktop\COS Theta`).
- **Default Model**: `gpt-6-luna` (configured in `~/.codex/config.toml`).
- **Master Handoff Directive**: [`CODEX_HANDOFF_PROMPT.md`](file:///c:/Users/m_hit/Desktop/COS%20Theta/CODEX_HANDOFF_PROMPT.md)
- **Primary Roles**: Independent adversarial review, schema validation, edge case stress-testing, bounded implementations.
- **Invocation Pattern**:
  ```powershell
  Get-Content codex_task_prompt.txt | codex exec --dangerously-bypass-approvals-and-sandbox -
  ```
  Or via CMD:
  ```cmd
  type codex_task_prompt.txt | codex exec --dangerously-bypass-approvals-and-sandbox -
  ```
- **Claude Code CLI** (when used): `claude -p --dangerously-skip-permissions`

---

## 5. Frozen Invariant Zones (Never Prune Without Tests & Human Review)
1. **TRAI Calling Hours (09:00 to 21:00 IST)**: No automated call triggering or scheduled call alerts outside these hours.
2. **Daily Action Capacity (50 Calls/Actions Max)**: Daily human execution bandwidth is capped at 50 items. The top 10 items MUST be Disproportionate Return needle-movers.
3. **Sheet Remark Preservation**: Google Sheet columns 16 (`NEXT STEP`), 17 (`Priority`), 22 (`UPDATES`), 23 (`MEETING`), and 24 (`Call Brief`) must be ingested and retained without flattening or truncating.
4. **Zero Empty Leads Rule**: Never create or ingest lead records where both `name` and `phone` are empty.
5. **Currency & Time Standards**: All currency rendered in Indian units (₹K, ₹L, ₹Cr). All timestamps in IST.
6. **Automated Test Bar**: Full test suite (`python -m pytest tests/unit/`) must remain 100% green (25/25 passed).
