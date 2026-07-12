# Dispatch ledger — Canvas exhaustive catalog + context-aware inspector wave

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

## Wave status
| # | Task | Files | Agent | Status |
|---|---|---|---|---|
| 1 | Spring Boot + Spring Cloud exhaustive catalog (scrape start.spring.io metadata + spring.io docs) | springCatalog.ts + springCatalog.test.ts | research agent | DISPATCHED |
| 2 | NestJS / Next.js / FastAPI(+AI) exhaustive catalogs (official docs) | nestCatalog.ts, nextCatalog.ts, fastapiCatalog.ts + ecosystemCatalogs.test.ts | research agent | DISPATCHED |
| 3 | Canvas UI: control-flow nodes (§3 of pending doc) + context-aware inspector — clicking a node swaps the left panel to that node type's catalog accordions (lazy-loaded, checkboxes, docs links rendered) | NodePalette.tsx, EdgeInspector.tsx, InspectorPanel.tsx, CanvasPage.tsx, new CatalogInspector component + tests, e2e spec | dev agent | BLOCKED ON 1+2 |
| 4 | Rewrite docs/canvas-control-flow-pending.md as the full-blown catalog document generated from the data files (links + descriptions per item) | docs/canvas-control-flow-pending.md | tech-writer agent | BLOCKED ON 1+2 |

## Next actions (governor)
1. When agents 1+2 report: verify diffs stayed in their file lists; run typecheck + full suite.
2. Dispatch agents 3 (dev) and 4 (tech-writer) in parallel with the real catalog exports named.
3. Integrate: typecheck + full vitest + attempt `pnpm run test:e2e` for the canvas spec.
4. Report to user; NO commits without an explicit push instruction.
