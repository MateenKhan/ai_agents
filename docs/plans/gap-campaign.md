# Gap campaign — 100 gaps, worked in verified waves

Evidence-based inventory from a codebase survey (12 TODO/FIXME, 113 empty `catch`, 267 `any`,
85 raw `console.*`, ~90 HTTP endpoints in one file) plus architectural review. Worked in **waves**:
each wave = a batch of file-disjoint tasks dispatched to agents, then verified + merged before the
next. **Security-critical items (marked 🔴) are NOT auto-agented** — they need human design.

Status: ✅ done · 🚧 in a running wave · ⬜ pending · 🔴 human-only · ⛔ blocked

---

## Wave 1 — DONE ✅ (committed b24f2eb)
1. ✅ ai-edit: cap uploads at 2 MB (413).
2. ✅ ai-edit: clear 504 on model timeout (not generic 502).
3. ✅ intake gate: flag scenarios with no THEN.
4. ✅ redact secrets from git pull/push/ls-remote output.
5. ✅ stage-history (journal) timeline in the Changes panel.
6. ✅ architect's plan shown alongside the dev's summary.
7. ✅ "needs refinement" badge on gated intake tasks.

## A. Security & hardening (🔴 = human)
8. 🔴 Auth on the db-server (:6952) — no authn/authz at all; anyone on the network is admin.
9. 🔴 TLS termination for the API (tokens cross the wire in plaintext).
10. 🔴 `--dangerously-skip-permissions` on every agent — sandbox the agent's file/command scope.
11. 🔴 Prompt-injection mitigation — hostile repo content flows into agent prompts unfiltered.
12. 🔴 Secret-key management — `db/.secret.key` lives on disk beside the data.
13. 🔴 Per-task / per-project token & cost budget (unbounded spend today).
14. ⬜ Rate-limit the public endpoints (search, intake, ai-edit) — no throttling.
15. ⬜ Validate + bound every request body size (large-body DoS on JSON.parse).
16. ⬜ Path-traversal audit sweep across ALL file endpoints (not just /file*).
17. ⬜ CORS policy review — confirm the allowlist is tight for a public deploy.
18. ⬜ Redact secrets in agent_logs generally (not just failureDetail + git output).
19. ⬜ `/db/table/:t` DB-browser: confirm table allowlist can't be bypassed (SQLi via table name).
20. ⬜ Escape/parameterise any remaining string-built SQL (audit for interpolation).

## B. Reliability & correctness
21. ⬜ Prove failure→retry live (force a crash; observe failureDetail inject). (verification, me)
22. ⬜ Consult path never fired live — craft a task that triggers a consult; verify.
23. ⛔ Postgres path end-to-end — needs a live PG.
24. ⬜ Multi-orchestrator: two-worker lease/lock contention test (WORKER_ID isolation).
25. ⬜ Watchdog: lease-expiry reclaim test (a dead agent's task is requeued).
26. ⬜ reconcileStranded: a started-but-unleased task is recovered — test.
27. ⬜ Circuit breaker: opens on 3 network fails, half-opens, recovers — test.
28. ⬜ acquireLock TOCTOU is atomic on BOTH dialects — test the race (sqlite done; pg pending).
29. ⬜ Merge-lock release on every merge exit path (success/conflict/crash) — test.
30. ⬜ Idempotent migrations: re-run adds no duplicate columns — test.
31. ⬜ `dependsOn`: confirm dispatch actually blocks a task whose deps aren't DONE.
32. ⬜ Task with a huge diff: /changes truncation correct with and without meta=1.
33. ⬜ unifiedDiff on a NEW file (no old content) and a DELETION render correctly.
34. ⬜ Concurrent PUT /tasks/:id from two agents — last-write-wins vs lost-update audit.
35. ⬜ ETC countdown (etcMinutes cap 30) — boundary test.

## C. Error handling (from 113 empty catches — the risky ones)
36. ⬜ Audit empty `catch {}` in the orchestrator hot path — log or surface, don't swallow silently.
37. ⬜ db-server: a swallowed migration error should mark the server unhealthy, not boot silently.
38. ⬜ addAgentLog failure is swallowed — count consecutive failures, surface if logs.db is wedged.
39. ⬜ preview/run spawn errors surface a clear message, not a silent no-op.
40. ⬜ mintInstallationToken failure paths return actionable errors everywhere they're used.
41. ⬜ JSON.parse of request bodies wrapped with a 400 on malformed input (audit all handlers).

## D. Test coverage (modules with thin/no tests)
42. ⬜ agentic/workflow/route.ts edge cases (nearestHumanGate with no gate, cycles).
43. ⬜ agentic/workflow/validate.ts: every rejection reason has a test.
44. ⬜ db/searchContext.ts: selectForContext floor/cap/dedup.
45. ⬜ agentic/db/context.ts: LFU eviction ordering under ties.
46. ⬜ agentic/engine/prompts.ts: consultBlock, contextBlock, rulesBlock render paths.
47. ⬜ db/server.ts /changes: meta=1 vs full, exists:false, truncated.
48. ⬜ db/gitAuth.ts: already 6 tests — add IPv6/host:port and query-string cases.
49. ⬜ agentic/db/seed.ts: restore preview vs apply parity.
50. ⬜ agentic/db/migrations.ts: ALL_COLUMN_NAMES covers every declared column.
51. ⬜ src/pages/tasks/workflow/route + geometry: more edge cases.
52. ⬜ ChangesPanel: error/retry state test.
53. ⬜ FileBrowser CRUD component tests (create/save/delete flows).
54. ⬜ HumanTodos: approve/reject wiring test.
55. ⬜ TaskBoard drag-move test.
56. ⬜ previewable: a few more mixed-dir edges.
57. ⬜ DiffView: added/removed/hunk-header colourisation test.
58. ⬜ intakeGate: title/scenario unicode + whitespace edges.
59. ⬜ workflowApi client: 409/422/network mapping test.
60. ⬜ e2e: a real (mocked-claude) pipeline pass through the graph.

## E. Type safety (from 267 `any` — the load-bearing ones)
61. ⬜ Type the db-browser row shapes (avoid `any` on user-facing edit paths).
62. ⬜ Type the /changes response and share it with the frontend client.
63. ⬜ Type the workflow doc coming off the wire (validate + narrow).
64. ⬜ Type agent report bodies ({outcome}/{reject}/{consult}) at the PUT boundary.
65. ⬜ Replace `as any` casts in tasks.ts row mappers with a typed row.

## F. Observability & ops
66. ⬜ Structured event log (JSON lines) alongside the human agent_logs.
67. ⬜ Historical metrics: success rate, mean stage time, cost per task over time.
68. ⬜ External alerting hook when the health monitor reports DOWN (webhook).
69. ⬜ Replace raw console.* in libraries with a levelled logger (85 call sites).
70. ⬜ Per-project + global cost dashboard (sum of costUsd from ai-edit + agents).
71. ⬜ Automated tasks.db backup (snapshot + rotate) for a running instance.
72. ⬜ A /metrics endpoint (Prometheus-style) for the orchestrator's counters.
73. ⬜ Request-id + timing on every API response for tracing.

## G. Product & workflow
74. ⬜ Streaming AI chat (SSE) with a live token counter (needs a streaming endpoint).
75. ⬜ Auto-refine a gated intake task (one model pass to add scenarios/DoD) before holding it.
76. ⬜ Show the failureDetail on a BLOCKED task's card so a human sees why without digging.
77. ⬜ Surface the journal in the board card tooltip (quick trail at a glance).
78. ⬜ "Retry from here" action on a dead-lettered task.
79. ⬜ Bulk-approve at the review gate for a queue of small tasks.
80. ⬜ Per-project workflow templates (save/load a workflow doc).
81. ⬜ Task priority affects dispatch order — confirm + expose in UI.
82. ⬜ Owner accept gate: show the intent-vs-diff comparison it judged.
83. ⬜ ai-edit: multi-file proposal apply-all button.

## H. Performance & scale
84. ⬜ Index audit: agent_logs(projectId), tasks(projectId,status,stage) for the hot queries.
85. ⬜ /tasks list pagination (currently returns all).
86. ⬜ Debounce the code-index rebuild trigger.
87. ⬜ Cap the diff/context payloads consistently (200KB diff, 8 context — audit others).
88. ⬜ Avoid N+1 in purgeProjectData's per-task agent_db_usage delete (single IN query).
89. ⬜ WAL checkpoint / VACUUM schedule for long-running instances.
90. ⬜ Stream large file reads instead of readFileSync (the /file 512KB cap is coarse).

## I. Code quality & docs
91. ⬜ Resolve the 12 TODO/FIXME markers (triage: fix or file).
92. ⬜ README: architecture diagram + the failure/journal/plan model.
93. ⬜ CONTRIBUTING: how to add a stage behaviour / an agent role.
94. ⬜ API reference doc generated from the endpoint list.
95. ⬜ Extract more god-functions out of server.ts (it's ~3k lines, ~90 endpoints).
96. ⬜ Consolidate the duplicated redact helpers (orchestrator vs server) into one util.
97. ⬜ Dead-code sweep (unused exports, orphaned components).
98. ⬜ Consistent error-shape ({error} everywhere) — audit for stragglers.
99. ⬜ Lint pass + enable noUnusedLocals where safe.
100. ⬜ A CHANGELOG entry per shipped wave.

---

## Wave log
- **Wave 1** ✅ b24f2eb — gaps 1–7 (A–G). 579 tests green.
- **Wave 2** 🚧 — dispatched below.
