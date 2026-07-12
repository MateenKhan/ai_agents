# Dispatch ledger — Canvas exhaustive catalog + context-aware inspector wave

## WAVE COMPLETE — 2026-07-12
All 9 tasks shipped, integrated, gated (typecheck clean, 802/802 unit, 12/12 e2e live, audit 0) and
pushed: 66cf491 (catalogs), f331bbe (engine P0.3+P0.4, UI, deps, doc), 9b90d13 (canvas UI + navbar
wiring). Integration fixes by governor: designer test mocks StudioNavbar (needs router context);
e2e selector strictness. Follow-ups carried: verify which runner path (SDK loop vs CLI) is live and
whether generated worktree settings apply to it; remaining skip-flag sites (db/server.ts:124,1396,
db/brief.ts:94, Dockerfile:21, .env.example:10); revisit dompurify override on monaco upgrade;
SPEC P0 items 1,2,5,6 + P1 auth still open.

_Operational state for the current agent wave. A resumed session reads THIS file first and
continues from "Next actions". Spec: docs/canvas-control-flow-pending.md plus the user's
2026-07-12 instruction: exhaustive options from the OFFICIAL sources (start.spring.io
metadata, incl. Spring Cloud legacy Ribbon/Config Server/Hystrix), every option with a docs
link + one-line description, and clicking a canvas node must switch the left-menu options
to that node's catalog. Do not commit anything unless the user says push._

## Previous wave (complete, still uncommitted in tree — do not touch)
- 10 default IT-role agents added to agentic/db/defaults.ts + agentic/__tests__/defaultRoles.test.ts.
  QA-approved: typecheck clean, 694/694 tests. Awaiting the user's push decision.
- Follow-up parked: src/pages/tasks/components/AnalyticsTab.tsx hardcodes ROLE_ORDER/ROLE_COLOR
  for architect/dev/qa/merge — new roles render uncolored. Fold into a later UI wave.

## Contracts (agents build to these; do not renegotiate)
- Shared types: src/pages/canvas/data/catalogTypes.ts (CatalogOption { id, label, description,
  docsUrl, status?, successor?, children? }, CatalogCategory, FrameworkCatalog). Every option
  MUST have an official docsUrl and a one-line description.
- Data files: springCatalog.ts (SPRING_CATALOG), nestCatalog.ts (NEST_CATALOG),
  nextCatalog.ts (NEXT_CATALOG), fastapiCatalog.ts (FASTAPI_CATALOG) — all under
  src/pages/canvas/data/, data-only, lazy-loadable.
- Spring Cloud Netflix legacy (Ribbon/Hystrix/Zuul) included with status + successor
  (LoadBalancer / Resilience4j / Gateway). Eureka + Config Server + Gateway as GA entries.
- Validation tests live in src/pages/canvas/data/__tests__/ (one file per research agent).

## Wave status (expanded 2026-07-12 — user requested max parallelism; push IS authorized for QA-approved work in this wave)
| # | Task | Files (exclusive territory) | Agent | Status |
|---|---|---|---|---|
| 1 | Spring Boot + Spring Cloud exhaustive catalog (scrape start.spring.io metadata + spring.io docs) | springCatalog.ts + springCatalog.test.ts | research agent | DISPATCHED |
| 2 | NestJS / Next.js / FastAPI(+AI) exhaustive catalogs (official docs) | nestCatalog.ts, nextCatalog.ts, fastapiCatalog.ts + ecosystemCatalogs.test.ts | research agent | DISPATCHED |
| 3 | Canvas UI: control-flow nodes (§3 of pending doc) + context-aware inspector — clicking a node swaps the left panel to that node type's catalog accordions (lazy-loaded, checkboxes, docs links rendered) | NodePalette.tsx, EdgeInspector.tsx, InspectorPanel.tsx, CanvasPage.tsx, new CatalogInspector component + tests, e2e spec | dev agent | BLOCKED ON 1+2 |
| 4 | Rewrite docs/canvas-control-flow-pending.md as the full-blown catalog document generated from the data files (links + descriptions per item) | docs/canvas-control-flow-pending.md | tech-writer agent | BLOCKED ON 1+2 |
| 5 | SPEC P0.4 cost capture + budgets: costUsd into RunResult + task rows, per-task $2 / daily $25 caps at dispatch, --max-turns 80 | agentic/types.ts, runner.ts, orchestrator.ts, migrations.ts, tasks.ts + costBudget.test.ts | dev agent | DISPATCHED |
| 6 | SPEC P0.3 sandbox profiles: strict/standard/dangerous, per-role .claude/settings.json generation; runner/-intake integration patches reported for governor (agent barred from runner.ts/orchestrator.ts/types.ts/db/server.ts to avoid collisions with #5) | new agentic/engine/sandbox.ts + sandbox.test.ts (+ worktree module if separate) | dev agent | DISPATCHED |
| 7 | StudioNavbar (4 studio tabs + health dot; wired into /tasks + /ide only) + AnalyticsTab role-color derivation for the 10 new roles | src/components/navigation/** , TasksPage.tsx, ide/index.tsx, AnalyticsTab.tsx | dev agent | DISPATCHED |
| 8 | Designer AI-chat drawer: collapsible FileChat drawer + selection→context bridge + e2e | src/pages/designer/** , e2e/designer.spec.ts | dev agent | DISPATCHED |
| 9 | Dependency vulnerability sweep — GitHub flagged 16 (13 moderate, 3 low) on push; pnpm update within semver + audit, full suite as gate | package.json, pnpm-lock.yaml | dev agent | DISPATCHED (isolated git worktree — user instruction: subagents use worktrees; future dispatches default to isolation:worktree) |

## Collision map (why these territories)
- #5 owns agentic/types.ts + runner.ts + orchestrator.ts exclusively; #6 builds sandbox.ts standalone and reports integration patches instead of touching them.
- #7 is barred from canvas/designer pages (#3 and #8 own those); governor wires StudioNavbar into CanvasPage/VisualDesignerPage at integration.
- #9 is sequenced after the wave because pnpm install mutates node_modules under running test processes.
- Parallel agents are told: failures in files outside their territory are expected mid-wave; the governor runs the final full-suite integration.

## Status log (newest first)
- #7 navbar+analytics DONE + governor-verified (13/13 on clean rerun; an earlier run flaked while #5 was mid-edit in agentic/ — rerun full suite at integration): StudioNavbar wired into /tasks + /ide (health dot polls /system-status via apiBase, 4s cadence); AnalyticsTab colors now derived (classic four unchanged, hash→10-hue palette, 11 roles→10 distinct slots, tests lock it). Governor still to wire navbar into CanvasPage + VisualDesignerPage after #3 lands (one import + one JSX line each, agent's report has the snippet).
- #8 designer drawer DONE + governor-verified (6/6 unit, e2e 10/10 in its run, typecheck clean): AiAssistantDrawer.tsx composes FileChat untouched via ChatStoreProvider tag() (FileBrowser's existing contract); toggle persisted to localStorage; Sandpack layout guarded (min-w-0 / shrink-0). In main tree, uncommitted.
- #9 deps DONE in worktree `.claude/worktrees/agent-a130e95c15ea9e7cb`: all 16 advisories = transitive dompurify 3.2.7 via monaco-editor; fixed with pnpm.overrides → 3.4.11; audit 0; 694 tests green there. MERGE PENDING: copy package.json override + lockfile to main and `pnpm install` once shared-tree agents (#5 cost, #7 navbar, #8 designer) finish — install churn would break their runs. Revisit override when monaco-editor upgrades.
- #6 sandbox DONE: agentic/engine/sandbox.ts + 16 tests green. Governor integration patches recorded by the agent: (A) runner.ts — import writeWorktreeSettings + call after resolveCwd (claudeFlags() already swaps the flag; NOTE agent observed the live runner drives the SDK tool loop, not `claude -p` — verify which path is live before claiming P0.3 done); (B) db/server.ts:1928 /intake → sandboxSpawnFlags('architect','standard'); backlog: skip-flag sites at db/server.ts:124,1396, db/brief.ts:94, Dockerfile:21, .env.example:10. Apply A after #5 lands (it owns runner.ts).
- #1+#2 catalogs ACCEPTED + committed/pushed (66cf491). #3 canvas dev + #4 tech-writer DISPATCHED in isolated worktrees.
- App started for the user: UI :6951, API :6952, orchestrator heartbeating; 14 roles confirmed live in DB.

## Next actions (governor)
1. As each agent reports: verify its diff stayed in territory; spot-review quality.
2. When 1+2 land: dispatch #3 (dev) and #4 (tech-writer) with the real catalog exports named.
3. When 5+6 land: apply #6's integration patches (runner spawn flags, /intake sandbox), then wire StudioNavbar into CanvasPage/VisualDesignerPage after #3/#8 land.
4. Integration gate: pnpm run typecheck + full vitest + e2e attempt; then commit+push QA-approved work (authorized) in logical commits.
5. Dispatch #9 (deps) once the tree is quiet. Update this ledger as statuses change.

---

# Research drill — "AI engineering team" competitor scan (2026-07-12)

5 background research agents, one search area each. This section is the full detail; chat got one line per agent. Not part of the canvas wave above.

## A. Vendor sites (official product pages/docs only)
- **Devin (Cognition)** — devin.ai. Autonomous cloud agent + Devin Desktop command center. Shell/editor/browser in sandboxed cloud env; takes Linear/Jira tickets; migrations, CI-failure fixes, docs/diagrams; visual QA + unit/E2E tests; ships GitHub PRs and iterates on review+CI to merge; 40+ integrations. Only public pricing in category: Free $0 / Pro $20 / Max $200 / Teams $80+$40 per dev / Enterprise (SSO, VPC). "AI Productivity Guarantee" up to $10M for enterprise.
- **Factory** — factory.ai. Specialized "Droids" per SDLC stage: Code (features/refactors/bugs), Knowledge (research/specs/docs), Reliability (on-call, RCA, incidents), Product (backlog, ticket→spec). HyperCode codebase understanding, ByteRank retrieval, model-independent; DroidShield pre-commit static analysis; SaaS/hybrid/on-prem/air-gapped; ISO 42001/SOC 2. Contact sales.
- **Blitzy** — blitzy.com. Thousands of parallel agents, days-to-weeks inference; requirements→design→repo up to 3M LOC, compile+runtime validated; knowledge graph of existing codebases; QA agents cross-review each other; PRs to GitHub/GitLab/Azure DevOps. Enterprise sales.
- **Tembo** — tembo.io. Governance layer running fleets of third-party agents (Claude Code, Codex, Cursor, Copilot) in cloud VMs (128GB/500GB); PR review, migrations, incident triage, Linear tickets, test coverage; centralized approval workflow + audit logs; 150+ integrations. Free tier + enterprise.
- **Cosine** — cosine.sh. Own Lumen model family (Scout/Outpost/Sovereign); end-to-end ticket→PR without supervision; legacy focus (COBOL/Fortran/Verilog); CLI + Cloud; managed/single-tenant/air-gapped.

## B. Community sentiment (HN + indexed Reddit)
- Devin: hype→debunked→"useful for narrow chores" (merge conflicts, linters, pushing PRs over the line); "runs around in circles," expensive ACU model ($2.25/ACU ≈ 15 min), review burden is the killer complaint.
- OpenHands: warmest sentiment; open source, model-agnostic, runs local; ~20% of own commits self-authored.
- Claude Code swarms: the dominant *actually used* pattern — devs build the team themselves (tmux parallel instances, agents verifying each other); consensus: swarms only pay off on independent subtasks.
- Codex liked for async batch model; Jules weakest (most PRs trashed); Copilot coding agent "safe but modest" (draft-PR guardrails praised).
- MetaGPT/ChatDev seen as demos, not tools. Cross-cutting: autonomy is the liability, review is the bottleneck, ROI negative outside narrow chores; winning pattern = developer-as-governor over parallel constrained agents.

## C. GitHub OSS
- **MetaGPT** ~69k★ (PM/Architect/PM/Engineer SOPs, requirement→full project + design docs), **ChatDev** ~34k★ (CEO/CTO/Programmer/Designer/Reviewer/Tester phases; MacNet DAG topologies >1,000 agents), **GPT Pilot** ~34k★ (10 roles incl. Spec Writer/Tech Lead/Reviewer/Debugger; human checkpoints) — the true team simulators.
- **OpenHands** ~80k★ (sandboxed Docker, issue→PR, Agent-Client Protocol for third-party agents), **GPT-Engineer** ~55k★ (archived 2026/04; precursor to Lovable), **CrewAI** ~45-54k★ (framework layer: roles/crews/flows).

## D. Review platforms
- Product Hunt is the category's home: Devin ~4.7 (65 reviews; "junior engineer teammate," MCP praised, setup friction), Factory 4.8/4, Cosine 4.7/6, AutonomyAI 5.0/7, Sweep 4.5/4, Agen (0 reviews).
- G2: listings exist (Cognition 4.5/15 as seller) but review volume thin vs IDE assistants. Capterra: near-zero coverage (only Agen; Devin/Factory not listed).
- Reviewer themes: ticket→PR core workflow, Slack+GitHub/Linear integrations, parallel delegation, "engineer becomes reviewer"; complaints: setup friction, trust/verification.

## E. Tech press / funding
- Cognition $1B raise at $25B pre (May 2026), ~$492M ARR post-Windsurf; Factory $1.5B valuation (Apr 2026; Nvidia, Adobe, EY, MongoDB logos); Blitzy $200M at $1.4B (May 2026; 66.5% SWE-Bench Pro claim); Reflection pivoted away to frontier lab.
- Tier 2: Qodo $70M (verification of AI code), Tembo, All Hands AI, Cosine (YC), Codegen (acquired by ClickUp 12/2025), Sweep, Zencoder; ~50% of recent YC batches are agent companies.
- Big-lab agents shaping narrative: OpenAI Codex, Google Jules, GitHub Copilot coding agent + Agent HQ (enterprise control plane for agent fleets).
- 2026 press themes: "pair programmer"→"autonomous workforce"; differentiators now enterprise governance, spec-driven development, verification of AI-written code.

## Consolidated feature set (what "a full AI engineering team" product ships in 2026)
1. Ticket→PR loop: ingest Jira/Linear/GitHub issue, plan, code, test, open PR, iterate on review + CI until merge.
2. Multi-agent role orchestration (PM/architect/dev/QA/reviewer) or fleet parallelism (dozens–thousands of agents).
3. Sandboxed cloud execution (VMs/containers with shell, editor, browser) with pause/resume/share.
4. Deep codebase understanding: indexing/retrieval/knowledge graphs across multi-repo orgs.
5. Autonomous testing & QA: unit/E2E generation, visual browser QA, agent cross-review.
6. SDLC breadth beyond coding: incident response/RCA, migrations, docs generation, backlog triage.
7. Integrations: GitHub/GitLab/Bitbucket, Slack/Teams, Jira/Linear, Sentry/Datadog/PagerDuty.
8. Enterprise governance: human approval gates, audit logs, RBAC/SSO, VPC/on-prem/air-gapped, security scanning, compliance certs.
9. Pricing: seat+usage ladders (only Devin public); usage-credit models are the norm and a common complaint.
10. Market gap per community: buyers don't trust full autonomy — the wanted product is governed parallel agents with strong review/verification tooling (exactly the Qodo/Tembo/Agent HQ angle).
