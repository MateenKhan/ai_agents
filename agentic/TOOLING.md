# Tooling decision registry

A single place to decide what the framework **adopts**, **borrows**, or **skips** — so each new suggestion becomes one row and a decision, not a restart of the whole plan.

## Legend

- **ADOPT** — install/use directly; it becomes part of the stack.
- **BORROW** — take the *pattern or templates*, not the codebase.
- **REFERENCE** — mine for ideas only; nothing integrated.
- **SKIP** — wrong fit for this project's goal (an unattended, Claude-native, coding-task runtime).

The test every tool must pass to be ADOPTED: *does it fit the `claude -p` headless-agent + git-worktree paradigm, and does it fill a layer we don't already own?*

## The stack (decided)

| Layer | Choice | Decision |
| :-- | :-- | :-- |
| Orchestration runtime | our own `agentic-core` | build (moat) |
| Agent methodology | **superpowers** | ADOPT |
| Code intelligence | **graphify** | ADOPT |
| Document context | **MinIO** (S3) | ADOPT |
| Spec/definition quality | **spec-kit** templates | BORROW |
| Live workflow UI | **ComfyUI**-style node graph (React Flow) | BORROW (after v1) |
| Control & reach | in-app chat now; hermes patterns later | build / BORROW |

## Full registry

| Tool | What it is | Decision | Why / how it fits |
| :-- | :-- | :-- | :-- |
| obra/superpowers | Methodology skills for coding agents (spec→plan→TDD→review), auto-loads in Claude Code | **ADOPT** | Agents run it; replaces hand-written architect/dev/qa prompts. Same paradigm (`claude -p`). |
| safishamsi/graphify | Claude Code skill: folder → knowledge graph, ~71x fewer tokens/query, `--watch` for parallel agents | **ADOPT** | Backs the `CodeIndex` seam; better version of the homegrown `db:search` index. |
| MinIO | S3-compatible object storage | **ADOPT** | Backs the `DocStore` seam; `@aws-sdk/client-s3` already in deps. |
| github/spec-kit | Spec-driven-dev toolkit (constitution/specify/plan/tasks) + spec & checklist templates | **BORROW** | Mine its spec/checklist templates for the intake decomposition + GWT scenarios. Do NOT run as a 2nd methodology — it competes with superpowers. |
| Comfy-Org/ComfyUI | Node-graph editor with live execution (for image-gen) | **BORROW** | Copy the *live node-graph UI pattern* for the workflow tab via React Flow. Not the tool itself. After v1. |
| NousResearch/hermes-agent | Self-improving personal assistant: VPS, messaging gateways, memory, cron, subagents | **BORROW** | Steal patterns (persistent memory, cron, chat control) for the control layer. Don't import the Python codebase. |
| langgenius/dify | LLM-app platform (RAG, chatbots, workflows) | **SKIP** | Builds LLM *apps*, not coding-agent orchestration. Different architecture. |
| langflow-ai/langflow | Visual low-code LLM-workflow builder | **SKIP** | Same as dify. The only takeaway (visual flow) is covered by the ComfyUI-pattern borrow. |
| langchain-ai/langchain | SDK for chaining LLM calls into agents/tools | **SKIP** | Wrong layer — your agents are full Claude Code sessions, not chains. |
| open-webui/open-webui | Self-hosted chat UI (PWA, RAG, voice, pipelines) | **SKIP (core)** | Heavy service just for task intake; the in-app chat page covers the need. Optional later if you want a full AI chat workspace. |
| VibeKanban | Kanban UI for orchestrating coding agents | **SKIP** | You're building your own board with resilience it doesn't have. |
| AUTOMATIC1111/stable-diffusion-webui | Stable Diffusion image-generation UI | **SKIP** | Image gen — unrelated to your UI, docs, or agents. Only relevant if you add an image-generation *feature*. |
| msitarzewski/agency-agents | Roster of AI agent *personas* installable into Claude Code | **REFERENCE** | Optional flavor; your architect/dev/qa roles already exist. |
| f/prompts.chat | Curated prompt library | **REFERENCE** | Prompt inspiration only. |
| Shubhamsaboo/awesome-llm-apps | Catalog of example LLM apps (mostly Python/LangChain) | **REFERENCE** | Learning catalog; nothing to integrate. Does not contain your kind of agent. |
| thedotmack/claude-mem | Claude Code plugin: episodic cross-session memory (hooks + SQLite/Chroma + MCP search) | **v1 need — owned Memory seam; claude-mem = pluggable backend** | Memory is v1 (agents must not repeat work / lose the thread). Built as an owned default behind the `Memory` seam; claude-mem or a vector store plugs in behind it. Note: associated crypto token ($CMEM) — why it's not the core dependency. |
| browser-use/browser-use | AI-driven browser automation (DOM + vision) | **v1 need — QA browser (Playwright default; swappable)** | QA verifies against a live URL with Playwright + screenshot vision-checks ("grid loads, draw + extrude"). browser-use / chrome-mcp swap in behind the same QA capability. |
| karpathy/autoresearch | Autonomous *neural-net training* experiment harness (agent edits train.py) | **SKIP** | Misread — it's ML training research, not answer-finding. The "unblock a stuck agent" need is covered by architect-rescue + systematic-debugging + web search. |
| ChatGPTNextWeb/NextChat | Lightweight cross-platform ChatGPT-style chat UI | **SKIP (core)** | Redundant with the in-app chat box. Lighter than open-webui if a standalone chat app is ever wanted. |
| nextlevelbuilder/ui-ux-pro-max-skill | Claude Code UI/UX design skill | **ADOPT (dev role) — verify quality** | Installed for the dev role (cheap — a skill). I vet its quality and cut it only if thin; your app UI is complete, so it will fire rarely. |

## Build order — nothing is dropped, only sequenced by dependency

"Later" here means "can't be built until the thing before it exists," not "unimportant." Each item has a real slot.

**v1 (the running loop + what your app genuinely needs to call a task done):**
1. Runtime: DB (scenarios/stage), runner (worktrees/models), stage orchestrator, wiring
2. Memory seam + owned default (agents record/recall learnings; injected at task start)
3. QA browser verification (Playwright + screenshot vision-checks against a URL)
4. In-app chat intake (message → tasks) + Logs upgrade
5. Dev-role skills: superpowers + graphify + ui-ux-pro-max (quality-vetted)

**v1.x (unblocked once v1 runs):**
6. claude-mem / vector store as a richer Memory backend
7. spec-kit templates folded into intake for sharper scenarios
8. ComfyUI-style live node-graph workflow view (React Flow)

**v2 (reach layer):**
9. hermes-style external messaging control + cron; open-webui as optional chat workspace

## v1 finish line

Type in the app chat → N tasks appear → agents run them (plan → build → qa) → land in "Your Review" → approve → merged. On your machine. Nothing on the backlog is v1.
