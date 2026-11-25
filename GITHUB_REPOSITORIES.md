# GitHub Repositories Master Directory: Agent Capabilities & Tooling Matrix

> **Purpose**: Single source of truth for all external open-source repositories, agent skills, and automation libraries referenced across the COS Theta intelligence pipeline.  
> **Target Audience**: AI Agents (Antigravity, Codex CLI, Claude Code) and human operators. Agents should reference this catalog when selecting tools for lead enrichment, client prototyping, context navigation, and pipeline automation.

---

## Quick Reference Index by Capability

| Category | Primary Repositories | Core Function |
| :--- | :--- | :--- |
| **1. Lead Intelligence & Scraping** | Crawl4AI, Firecrawl, Maxun, Huginn, Check-If-Email-Exists, Google Maps Scraper | Extract clean company data, team size, pricing, and verify contact reachability |
| **2. Agent Navigation & Multi-Agent Teams** | Understand Anything, Craft, Agency-Agents, Repomix, GitIngest, Superpowers, Code-Interpreter | Map codebases, pack context, deploy 232 specialized agent personas, execute code |
| **3. Client Prototype, UI & Video Generation** | Awwards Skill, Remotion, OpenMontage, Motion Canvas, Three.js / R3F, Satori, Frontend Slides | Build award-grade client portals, automated pitch videos, and interactive 3D demos |
| **4. Autonomous Web & Workflow Agents** | Browser Use, OpenHands, Dify, Langflow | Control headless browsers, execute end-to-end coding tasks, visual RAG pipelines |
| **5. CRM, Outreach & Communication** | Twenty CRM, Listmonk, ItsaPlan, Open WebUI | Self-hosted deal management, high-volume transactional outreach, agent project boards |
| **6. Self-Hosted Cloud & Utilities** | Coolify, Supabase, Stirling PDF, ChangeDetection.io, SearXNG, Vaultwarden, OpenTakeoff | Self-hosted PaaS, relational database/auth, local PDF manipulation, page monitoring |

---

## 1. Lead Intelligence & Web Scraping

### [Crawl4AI](https://github.com/unclecode/crawl4ai)
- **Slug**: `unclecode/crawl4ai` | ⭐ **68K+** | *Python*
- **Primary Function**: High-performance, open-source asynchronous web crawler engineered specifically for LLMs and AI agents. Converts complex web pages into clean, structured Markdown while filtering out ads, popups, and cookie banners.
- **When Agents Should Use**:
  - Ingesting a lead's corporate website to extract company scale, services, tech stack, and pain points before sales calls.
  - Feeding unstructured web data directly into prompt context without hitting token limits.

### [Firecrawl](https://github.com/mendableai/firecrawl)
- **Slug**: `mendableai/firecrawl` | ⭐ **68K+** | *TypeScript / Node*
- **Primary Function**: Turns entire websites into clean Markdown or structured JSON with a single API call or self-hosted container. Handles JavaScript rendering, pagination, sitemaps, and sub-page crawling.
- **When Agents Should Use**:
  - Deep-crawling entire client domains (e.g. `numbertree.in`, `vishaldama.com`) to generate complete client dossiers for high-intent leads.

### [Maxun](https://github.com/getmaxun/maxun)
- **Slug**: `getmaxun/maxun` | ⭐ **16.7K+** | *TypeScript / Playwright*
- **Primary Function**: Visual, no-code web scraper that converts websites into structured data and custom REST APIs without manual scraper scripting.
- **When Agents Should Use**:
  - Extracting recurring structured records (directories, pricing tables, public registries) without writing custom CSS selectors.

### [Huginn](https://github.com/huginn/huginn)
- **Slug**: `huginn/huginn` | ⭐ **41K+** | *Ruby*
- **Primary Function**: System for building automated online agents that watch the web 24/7, monitor Twitter/X, forums, and RSS feeds, and perform automated actions when triggers match.
- **When Agents Should Use**:
  - Real-time intent monitoring: Detecting when potential clients publicly post about CRM migrations, ERP issues, or agency hiring.

### [Check-If-Email-Exists](https://github.com/reacherhq/check-if-email-exists)
- **Slug**: `reacherhq/check-if-email-exists` | ⭐ **8.5K+** | *Rust*
- **Primary Function**: Verifies whether an email address actually exists on the target MX server without ever sending a test message.
- **When Agents Should Use**:
  - Lead sanitation: Validating prospect email addresses before initiating cold outreach or proposal sending to maintain 0% bounce rates.

### [Google Maps Scraper](https://github.com/omkarcloud/google-maps-scraper)
- **Slug**: `omkarcloud/google-maps-scraper` | ⭐ **7K+** | *Python*
- **Primary Function**: Scrapes local business details (business name, phone, address, website, review score, category) directly into CSV/Excel.
- **When Agents Should Use**:
  - Local B2B prospecting across target industrial clusters (e.g. logistics in Indore, manufacturing in Pune, CA firms in Mumbai).

---

## 2. Agent Navigation, Context & Multi-Agent Teams

### [Understand Anything](https://github.com/dailydoseofds/understand-anything)
- **Slug**: `dailydoseofds/understand-anything` | ⭐ **86K+** | *TypeScript / Rust*
- **Primary Function**: Multi-agent codebase intelligence engine. Combines Tree-sitter AST parsing with LLM semantic reasoning to build an incremental interactive knowledge graph of the entire repository.
- **When Agents Should Use**:
  - Navigating large repositories without reading files one-by-one.
  - Determining exact function call graphs and impact analysis before modifying core backend routes or database schemas.

### [Craft](https://github.com/lucas-capp/craft)
- **Slug**: Codebase Mapping Standard | *Open Source*
- **Primary Function**: Maps repository structure, dependencies, and business domain boundaries once into an index so agents stop re-exploring the entire filesystem from zero on every prompt.
- **When Agents Should Use**:
  - Accelerating initial task bootstrap in Codex CLI and Claude Code sessions.

### [Agency-Agents](https://github.com/agency-agents/agency-agents)
- **Slug**: `agencyagents.app` / `agency-agents` | *Multi-Platform*
- **Primary Function**: Roster of **232 specialized agent personas** across 16 commercial domains (frontend design, copy, Reddit community engagement, security audits, reality checkers) installable into Claude Code, Codex, and Cursor.
- **When Agents Should Use**:
  - Delegating sub-tasks to specialized domain personas (e.g., using the "Design Wizard" for client prototypes or "SecOps Auditor" for OAuth flows).

### [Repomix](https://github.com/yamadashy/repomix)
- **Slug**: `yamadashy/repomix` | ⭐ **18K+** | *TypeScript*
- **Primary Function**: Packs an entire codebase into a single, clean, token-efficient text file formatted specifically for AI LLMs with repository file trees and syntax-aware formatting.
- **When Agents Should Use**:
  - Exporting scoped project slices to provide full context to independent verifier agents or offline models.

### [GitIngest](https://github.com/coderamp-labs/gitingest)
- **Slug**: `coderamp-labs/gitingest` | ⭐ **12K+** | *Python*
- **Primary Function**: Replaces `github.com` with `gitingest.com` to instantly format any public repository into prompt-friendly markdown.
- **When Agents Should Use**:
  - Quickly analyzing external repositories or libraries without cloning them locally.

### [Superpowers](https://github.com/obra/superpowers)
- **Slug**: `obra/superpowers` | *Agent Framework*
- **Primary Function**: Structured engineering protocol for coding agents enforcing strict Test-Driven Development (TDD), requirements decomposition, and verification gates before writing code.
- **When Agents Should Use**:
  - Enforcing zero regressions when building high-stakes features (e.g. scheduling algorithms, billing, database migrations).

### [Code-Interpreter Sandbox](https://github.com/e2b-dev/E2B)
- **Slug**: `e2b-dev/E2B` / Open Code Interpreter | ⭐ **10K+** | *Python / TypeScript*
- **Primary Function**: Secure cloud or local sandbox environments for AI agents to run real Python/Node code, analyze data, and verify execution output instead of guessing.
- **When Agents Should Use**:
  - Running data analysis on CRM leads, executing math scoring formulas, or verifying scripts safely.

### [Anthropic Skills](https://github.com/anthropics/skills) & [ECC](https://github.com/affaan-m/ECC)
- **Slug**: `anthropics/skills` & `affaan-m/ECC` | *Prompt Engineering*
- **Primary Function**: Ready-to-install agent skills, design guidelines, and context-window optimization suites.
- **When Agents Should Use**:
  - Standardizing agent behavior, slash commands, and multi-turn conversational memory.

---

## 3. Client Prototype, UI & Video Generation

### [Awwards Agent Skill](https://github.com/gittrend/awwards)
- **Slug**: `awwards-skill` | *Agent Skill*
- **Primary Function**: Instructs coding agents to build award-winning websites with sophisticated typography, color systems, and intentional motion. Self-evaluates desktop and mobile screenshots until quality exceeds 8/10.
- **When Agents Should Use**:
  - Generating client prototype frontends (`proto-{client}.zero7.space`) to deliver agency-grade polish in under 1 hour.

### [Remotion](https://github.com/remotion-dev/remotion)
- **Slug**: `remotion-dev/remotion` | ⭐ **25K+** | *TypeScript / React*
- **Primary Function**: Programmatic video creation in React. Build videos using standard web technologies (CSS, canvas, SVG, React components) and render them to MP4 via code.
- **When Agents Should Use**:
  - Automatically rendering personalized 30-second client video demos with the client's logo, metrics, and automated voiceover for WhatsApp outreach.

### [OpenMontage](https://github.com/CALESTHIOAILABS/open-montage)
- **Slug**: `CALESTHIOAILABS/open-montage` | *Open-Source Agentic Video*
- **Primary Function**: Autonomous video production system where AI agents direct, edit, and assemble complete multi-scene video presentations.
- **When Agents Should Use**:
  - Producing client onboarding videos, proposal explainers, and marketing assets end-to-end.

### [Motion Canvas](https://github.com/motion-canvas/motion-canvas)
- **Slug**: `motion-canvas/motion-canvas` | ⭐ **15K+** | *TypeScript*
- **Primary Function**: Programmatic vector animation tool with real-time preview designed for creating technical explainer videos and visual software architectures.
- **When Agents Should Use**:
  - Generating animated workflow diagrams demonstrating how COS Theta automates a client's business.

### [Three.js](https://github.com/mrdoob/three.js) & [React Three Fiber](https://github.com/pmndrs/react-three-fiber)
- **Slug**: `mrdoob/three.js` (⭐ **100K+**) / `pmndrs/react-three-fiber` (⭐ **27K+**) | *JavaScript / React*
- **Primary Function**: Declarative 3D scene rendering, cameras, lighting, and interactive models in the browser.
- **When Agents Should Use**:
  - High-impact client prototypes requiring spatial or 3D visualization (e.g. industrial warehouse layouts, real estate tours).

### [Satori](https://github.com/vercel/satori)
- **Slug**: `vercel/satori` | ⭐ **15K+** | *TypeScript*
- **Primary Function**: Converts HTML and CSS directly into SVG images and title cards at high speed.
- **When Agents Should Use**:
  - Generating dynamic social share cards, WhatsApp link preview images, and client proposal thumbnails.

### [Frontend Slides](https://github.com/zarazhangrui/frontend-slides)
- **Slug**: `zarazhangrui/frontend-slides` | *Agent Skill*
- **Primary Function**: Enables coding agents to build interactive, self-contained HTML slide presentations.
- **When Agents Should Use**:
  - Generating pitch decks and executive proposals hosted directly on `zero7.space`.

### [Lemo-Opuscar](https://github.com/gittrend/lemo-opuscar)
- **Slug**: `lemo-opuscar` | *Agent Skill*
- **Primary Function**: Directs short films and creative visual stories in 51 distinct artistic styles (watercolor, ink wash, architectural linework) without traditional video generators.
- **When Agents Should Use**:
  - Generating creative brand assets and distinctive storytelling for agency pitches.

---

## 4. Autonomous Web & Workflow Agents

### [Browser Use](https://github.com/browser-use/browser-use)
- **Slug**: `browser-use/browser-use` | ⭐ **83.5K+** | *Python*
- **Primary Function**: Connects LLMs directly to browser automation. Allows agents to click, type, navigate, fill out complex forms, solve captchas, and extract data autonomously.
- **When Agents Should Use**:
  - Automating tasks in web portals that lack public APIs (e.g. government tender portals, GST verification sites, legacy client ERPs).

### [OpenHands](https://github.com/All-Hands-AI/OpenHands)
- **Slug**: `All-Hands-AI/OpenHands` | ⭐ **81.2K+** | *Python / React*
- **Primary Function**: Autonomous AI software development agent capable of writing code, running bash commands, browsing the web, and resolving GitHub issues independently.
- **When Agents Should Use**:
  - Running parallel, long-duration code implementation tasks in isolated container workspaces.

### [Langflow](https://github.com/langflow-ai/langflow)
- **Slug**: `langflow-ai/langflow` | ⭐ **194K+** | *Python / React*
- **Primary Function**: Visual low-code UI and multi-agent builder for rapid experimentation with RAG pipelines, model routing, and vector retrieval.
- **When Agents Should Use**:
  - Prototyping multi-model RAG chains before codifying them into FastAPI backend endpoints.

### [Dify](https://github.com/langgenius/dify)
- **Slug**: `langgenius/dify` | ⭐ **143.8K+** | *Python / TypeScript*
- **Primary Function**: Production-grade LLM application development platform featuring visual workflow orchestration, prompt management, and enterprise agent hosting.
- **When Agents Should Use**:
  - Managing internal AI assistant workflows with built-in telemetry, logging, and model fallback.

---

## 5. CRM, Outreach & Communication

### [Twenty CRM](https://github.com/twentyhq/twenty)
- **Slug**: `twentyhq/twenty` | ⭐ **60K+** | *TypeScript / NestJS*
- **Primary Function**: Modern, open-source Salesforce alternative. Features deal boards, contact management, custom fields, and clean GraphQL/REST APIs.
- **When Agents Should Use**:
  - Architectural blueprint and schema reference for modernizing `zero7_crm.db` Kanban deals and stage transitions.

### [Listmonk](https://github.com/knadh/listmonk)
- **Slug**: `knadh/listmonk` | ⭐ **15K+** | *Go*
- **Primary Function**: High-performance, self-hosted newsletter and email marketing engine with transactional email capabilities and negligible resource footprint.
- **When Agents Should Use**:
  - Dispatching high-volume personalized email follow-ups and weekly founder briefings with zero per-email fees.

### [ItsaPlan](https://osp.fyi/itsaplan)
- **Slug**: `osp.fyi/itsaplan` | *Open-Source Linear Alternative*
- **Primary Function**: Open-source, self-hosted project management and issue tracker designed for human teams and AI agents to collaborate on the same boards.
- **When Agents Should Use**:
  - Exposing structured task queues and sprint tickets that both humans and autonomous agents can claim and resolve.

### [Open WebUI](https://github.com/open-webui/open-webui)
- **Slug**: `open-webui/open-webui` | ⭐ **140K+** | *Python / Svelte*
- **Primary Function**: Feature-rich, self-hosted web interface for local and remote LLMs (Ollama, vLLM, OpenAI-compatible endpoints) with multi-model chat, RAG, and role-based access.
- **When Agents Should Use**:
  - Providing an internal team interface for chatting with local models served through OmniRoute.

---

## 6. Self-Hosted Cloud, Utilities & Security

### [Coolify](https://github.com/coollabsio/coolify)
- **Slug**: `coollabsio/coolify` | ⭐ **58.8K+** | *PHP / Docker*
- **Primary Function**: Self-hosted, privacy-first Heroku/Vercel/Render alternative. Deploys applications, databases, and Docker containers to any VPS with automated SSL and domain routing.
- **When Agents Should Use**:
  - Managing multi-container deployments and staging environments across DigitalOcean Droplets.

### [Supabase](https://github.com/supabase/supabase)
- **Slug**: `supabase/supabase` | ⭐ **102K+** | *TypeScript / PostgreSQL*
- **Primary Function**: Open-source Firebase alternative providing a PostgreSQL database, instant REST/GraphQL APIs, real-time websockets, and built-in authentication.
- **When Agents Should Use**:
  - Backend reference whenever real-time event streaming or row-level security (RLS) is required.

### [Stirling PDF](https://github.com/Stirling-Tools/Stirling-PDF)
- **Slug**: `Stirling-Tools/Stirling-PDF` | ⭐ **80K+** | *Java / Spring*
- **Primary Function**: Robust, self-hosted PDF utility for merging, splitting, signing, OCR converting, extracting text, and redacting PDFs locally.
- **When Agents Should Use**:
  - Parsing client proposals, NDAs, and balance sheet PDFs without leaking sensitive data to external SaaS services.

### [ChangeDetection.io](https://github.com/dgtlmoon/changedetection.io)
- **Slug**: `dgtlmoon/changedetection.io` | ⭐ **22K+** | *Python*
- **Primary Function**: Website change monitoring tool. Alerts via webhook whenever page elements, prices, job listings, or text content changes on target websites.
- **When Agents Should Use**:
  - Competitor intelligence and monitoring client websites for redesigns or new RFP postings.

### [Vaultwarden](https://github.com/dani-garcia/vaultwarden)
- **Slug**: `dani-garcia/vaultwarden` | ⭐ **45K+** | *Rust*
- **Primary Function**: Lightweight, single-container Bitwarden-compatible password manager.
- **When Agents Should Use**:
  - Securely managing and sharing API tokens, Droplet passwords, and credential vaults internally.

### [OpenTakeoff](https://github.com/kentucky-ai/opentakeoff)
- **Slug**: `kentucky-ai/opentakeoff` | *TypeScript / WebAssembly*
- **Primary Function**: Browser-based architectural blueprint measurement and takeoff engine. AI agents and humans use the same interface to calculate room boundaries and square footage.
- **When Agents Should Use**:
  - B2B vertical solutions for construction, real estate, or industrial architecture clients.

---

## 7. Agent Directives for Incorporating These Tools

When working in `COS Theta`, all agents must follow these selection heuristics:

1. **Before writing a custom scraper**: Evaluate if **Crawl4AI** or **Firecrawl** can fulfill the data requirement with zero custom parsing code.
2. **Before building a client demo**: Use the **Awwards Skill** styling standard and evaluate if a 30-second **Remotion** video pitch will multiply closing probability.
3. **Before refactoring unfamiliar code**: Use **Understand Anything** to inspect the AST call graph rather than blindly modifying files.
4. **Before cold contacting**: Run **Check-If-Email-Exists** to maintain pristine domain sender reputation.
5. **Always preserve the core thesis**: Only introduce a tool if it increases **Capital Per Unit Time** (revenue velocity divided by human effort).
