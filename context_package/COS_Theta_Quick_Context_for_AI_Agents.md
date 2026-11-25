# COS Θ — Quick Context for Antigravity and Other AI Agents

> **Read this first.** A portable context brief based on Zero7's original COS Θ architectural manifesto and subsequent founder brainstorming through **13 October 2026**.  
> **Status:** Founder vision + recommended strategy + open hypotheses. **Not an assertion of completed code, approved architecture, or signed customer contracts.**  
> For end-to-end detail read `COS_Theta_Master_Context_and_Strategic_Blueprint.md`.

## 1. The project in 60 seconds

Zero7 is pursuing an **AI-native business technology company**, transitioning from bespoke consulting to a reusable horizontal platform called **COS Θ (Company Operating System Theta)**.

**Founder's key insight:** AI reduces the cost of producing custom applications, so a company's software should increasingly adapt to that company's actual workflows. Business owners and teams should describe what they need; AI can translate that intent into specifications and micro-apps. However, **business-critical data, authorization, integration and execution must remain trustworthy**. Software generation alone is not the durable moat.

**Long-term vision:** Make business software as adaptable as the business itself. COS becomes the trusted first operating interface across a company's systems and can create new software capabilities when existing systems are insufficient.

**Recommended sequence:**

```text
Connect existing business systems
 -> build trustworthy, permission-aware business context
 -> present role-specific insights in a unified cockpit
 -> coordinate actions with approval and audit
 -> generate and evolve micro-apps using that context
```

**Initial product components:**

- **COS Bridge:** Reusable integrations for on-prem and cloud tools, including a local Windows agent where needed.
- **COS Context:** Structured business entities, relationships, source provenance, freshness and access policies.
- **COS Cockpit:** Partner/owner/manager/staff views, sourced questions, exceptions and allowed actions.
- **COS Execute:** Approval, action orchestration, idempotency and audit (minimal initially).
- **COS Studio / Shell:** Later natural-language micro-app creation using a stable, versioned UI/action component system.

## 2. Why this, not vertical SaaS or pure consulting?

The founder explicitly questions traditional 'pick one industry' advice because AI may make domain-specific software inexpensive enough to generate per business. **Do not reinterpret the product as quarry-only SaaS, audit-only SaaS, or another drag-and-drop workflow builder.** Instead focus the initial job to be done: fragmented operational context and cross-system coordination. Use customers from different industries to prove whether the underlying primitives generalize.

Zero7's reported consulting workflow has been WhatsApp/voice feedback → AI/Antigravity coding → changes in customer-specific repositories → live prototypes. The source manifesto reports cases in quarrying, chemical trading, CCTV/field services and furniture. That approach is fast but may scale poorly due to maintenance, integration and per-customer engineering time.

Consulting should continue to fund delivery and customer learning while reusable platform capabilities gradually replace repetitive custom work. **Measure fully loaded cost and Zero7 engineering hours per customer change**, not only server count.

## 3. Most relevant real-world cases

- **Consulting/audit LLP — proposed initial pilot:** Uses a spreadsheet to track audit engagements, roles, projects, deadlines and flows. Wants integrated project visibility and messaging. The proposed product connects its tracker and one permitted document/email source; gives partners and managers reliable progress views, pending-evidence follow-ups, role-sensitive access and an approved communications workflow. **No contract, exact tech stack, permissions or signed scope has been verified.**
- **Quarry:** Weighbridge, dispatch slips, driver photos, local accounting/Busy, occasionally unreliable internet. Useful for local bridge, hardware data, reconciliation and later offline functionality.
- **Chemical trading:** Quotes, broker communications, credit terms, market prices. Useful for context freshness, risk policies and approvals.
- **Security/field services:** Technician assignments, service contracts, complaints, voice UX. Useful for roles/tasks/mobile experiences.
- **Furniture:** Catalogs, production stages, specialized cutting calculations. Useful for domain-specific extensions.

## 4. Key technical decisions and guardrails

1. **Do not replace source systems automatically.** Tally may remain authoritative for accounting; a sheet may remain authoritative for engagement status; COS owns only records explicitly assigned to it.
2. **Read-only first.** Tally/Excel/Sheets integrations should initially observe and reconcile, not silently edit financial or project data.
3. **TallyPrime can be integrated.** Official developer documentation supports HTTP/XML and ODBC; Tally published a September 2026 reference design for an outbound WebSocket bridge. A COS Local Bridge can access an authorized Tally installation on localhost/LAN without exposing its port on the public internet. Validate customer-specific versions and access.
4. **Desktop Excel is possible.** A local bridge reads stable saved `.xlsx` snapshots of approved files. Microsoft Graph Excel APIs operate on supported cloud-stored Excel workbooks, not arbitrary local files.
5. **Google Sheets/Drive and Microsoft 365** have official cloud APIs; use scoped OAuth, durable sync checkpoints, freshness and source IDs.
6. **WhatsApp official API** supports eligible business-number messaging/webhooks, not arbitrary personal chats/groups. The original Baileys-based prototype is unofficial and should not be treated as guaranteed production access.
7. **Separate facts, inferences and action proposals.** Source links and sync freshness must accompany operational answers. A connected context graph is not automatically business truth.
8. **AI interprets and proposes; governed services authorize and commit.** Financial and other high-risk actions require validation, permissions, approvals, idempotency, audit and reconciliation.
9. **Use role/engagement/tenant access controls at every layer.** This is critical for audit client data and connected email/documents.
10. **Architecture is deliberately open.** PostgreSQL is a reasonable candidate; schema-per-tenant, one shared container, PowerSync/SQLite, arbitrary Python hooks and direct-to-Wasm synthesis are NOT mandated MVP decisions. Build cross-industry reusable components only when proven.
11. **Dynamic micro-apps later.** Generate versioned, validated specs for UI/action bindings; run custom code only under appropriate isolation. Do not let AI push arbitrary code into a privileged shared runtime.

## 5. Recommended 90-day execution

**Days 1–15:** Map the LLP's actual process, sheet schema, tools, roles and permissions; inspect current Zero7 code; test safe Tally/Excel integrations separately.  
**Days 16–30:** Implement a read-only sheet/local Excel connector, stable source IDs, engagement/task model and useful cockpit.  
**Days 31–45:** Add source-linked, permission-filtered question answering and freshness/error visibility.  
**Days 46–60:** Complete one draft → approve → send → verify/log follow-up workflow (email or official messaging channel).  
**Days 61–75:** Harden connector onboarding/recovery, tests, operations and local bridge.  
**Days 76–90:** Reuse the same core in a distinct industry and quantify new engineering effort versus reused modules.

**MVP success:** Real staff use sourced operational insights; accounting/sheet data reconcile with original sources; no unauthorized access or unapproved writes; one action workflow is dependable; second-customer core reuse is measured.

**MVP non-goals:** Full ERP replacement, every connector, unrestricted chat scraping, one universal ontology, unlimited auto-generated production code, complex offline syncing everywhere, direct binary synthesis, or zero marginal costs.

## 6. Evidence status and open decisions

**Founder vision:** horizontal adaptive COS; business-led software generation; shared context above existing systems.  
**Assistant recommendation:** start with COS Bridge + Context + Cockpit, use the LLP as a paid pilot if accessible, then a different industry; defer broad Studio/generator.  
**Vendor-supported capabilities:** Tally HTTP/XML/ODBC and a documented outbound bridge pattern; Google Sheets APIs; Microsoft Graph cloud Excel; official WhatsApp Business APIs.  
**Open:** current repo implementation, production customer count, contracts/revenue, exact LLP data/stack, legal/compliance requirements, tenant-isolation strategy, bridge packaging, final product pricing and the pace of self-service.

Never state a recommendation as a finalized founder decision. Never assume a proposed module exists until its repository/deployment has been inspected. Do not infer customer contracts or app capabilities from a manifesto alone.

## 7. How to work with this project

For each task, first: (a) inspect actual sources/repository, (b) distinguish facts from assumptions, (c) identify authoritative systems, (d) define smallest safe scope, (e) plan data permissions and failures, (f) specify tests and measurable acceptance, (g) explain how it contributes to cross-industry reuse.

**Agent instruction to copy:**

> You are acting as a critical technical/product collaborator for Zero7's COS Θ. The north star is adaptive business software on a trusted context and execution layer. The current recommended product sequence is CONNECT → UNDERSTAND → COORDINATE → GENERATE. Avoid assuming a universal ERP, a fixed industry niche or a specific multi-tenant kernel is already required. Verify the actual code and customer data before implementation. Prioritize read-only connectors, provenance, access controls, reliable synchronization, grounded answers and approved actions. Distinguish founder goals from hypotheses and recommendations. The initial proposed use case is the consulting/audit LLP, and horizontal reuse must be demonstrated in a second, different industry. For any change, provide scope, technical approach, permissions, failure handling, tests, unknowns and how it reduces future customer delivery effort.

## 8. Primary references

- **Full context:** `COS_Theta_Master_Context_and_Strategic_Blueprint.md`.
- **Historical original manifesto:** `New_Age_COS_Theta_Architectural_Synthesis.md` (12 Oct 2026). Original proposals should not be treated as uniformly verified/approved.
- **Tally official integration:** https://help.tallysolutions.com/xml-integration/
- **Tally official bridge architecture:** https://help.tallysolutions.com/secure-websocket-integration-with-tallyprime/
- **Microsoft Graph Excel:** https://learn.microsoft.com/graph/excel-concept-overview
- **Google Sheets API:** https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/batchGet
- **WhatsApp Business Platform:** https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api

**One-sentence summary:** COS Θ aims to connect what businesses already use, understand their trusted operational context, help people act across those systems and eventually let the business generate its own reliable, evolving software.
