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
