# Dispatch ledger — P0 items 7+8 (events feed + usage-aware auto-resume)

_Operational state for the current agent wave. A resumed session (cron firing after a plan-limit
window, or a fresh conversation) reads THIS file first and continues from "Next actions".
Spec for the items: docs/SPEC.md → Release 1 → P0 items 7 and 8. Do not commit anything._

## Safety-net schedule
- A session-scoped cron re-invokes the orchestrating session periodically with "read
  docs/LEDGER.md and continue". Firings during a limit window fail harmlessly; the first
  firing after the reset resumes the work. Cron id: `ed335228` (fires :13 and :43 each hour;
  session-scoped — dies if the VS Code session closes; auto-expires after 7 days).
- Delete the cron (CronDelete) when the Integration section is fully checked off.

## Contracts (agents build to these; do not renegotiate)
- `FailureKind` (agentic/types.ts:37) gains `'limit'`; `RunResult` (:207) gains
  `resetAt?: string | null` (ISO, from the parsed epoch).
- Limit detection: only the explicit usage-limit message (e.g. `usage limit reached|<epoch>`,
  epoch in seconds or ms) classifies as `limit`; plain 429/overloaded stays `network`.
- Persistence: new `system_state(key TEXT PRIMARY KEY, value TEXT)` kv table (tasks DB group,
  idempotent migration); key `limitPausedUntil` holds an ISO timestamp; helpers
  `getSystemState/setSystemState` exported from agentic/db/tasks.ts.
- `GET /agent-status` additionally returns `limitPausedUntil: string | null` (server reads the
  kv via raw SQL with a try/catch so a missing table = null).
- `GET /events?project=&limit=&offset=` → `{ ok, events: [{ id, taskId, taskTitle, agent,
  message, type, ts, attempt, logPath }] }`, newest first, limit default 100. Source:
  `agent_logs` (id, taskId, message, type, timestamp, projectId — logs DB) joined with tasks
  (title, claimedBy → agent, attempts, logPath).
- UI relative time: reuse `timeAgo` from src/pages/tasks/lib/timeUtil.ts.

## Wave status
| # | Task | Files | Agent | Status |
|---|---|---|---|---|
| 1 | Limit detection + global pause/auto-resume (backend) | agentic/types.ts, agentic/engine/runner.ts, agentic/engine/orchestrator.ts, agentic/db/migrations.ts, agentic/db/tasks.ts, agentic/__tests__/limitPause.test.ts | dispatched | ✅ 10/10 tests; limit branch in handleAgentExit before merge-kickback; pause gate reads durable kv each tick (restart-safe) |
| 2 | /events endpoint + limitPausedUntil on /agent-status + api-reference | db/server.ts, docs/api-reference.md | dispatched | ✅ tsc clean; tests skipped (server binds port at import — no seam; the planned server-split fixes this). ⚠ DEVIATION: /agent-status changed bare-array → { agents, limitPausedUntil } (grep found no in-tree consumers; governor must re-verify) |
| 3 | EventsFeed table component (Task/Agent/Action/Link/Time/Attempt) | src/pages/tasks/components/EventsFeed.tsx + __tests__/EventsFeed.test.tsx | dispatched | ✅ 7/7 tests; props { onOpenLog?(taskId, agent) }; polls /events every 5s; filter bar; sticky-header table |
| 4 | LimitBanner component (countdown banner) | src/pages/tasks/components/LimitBanner.tsx + __tests__/LimitBanner.test.tsx | dispatched | ✅ 5/5 tests; no props (self-contained poll); amber-100/900 for AA contrast; icon CirclePause |

## Integration (governor = the orchestrating session; do AFTER agents finish)
- [x] Review each agent's diff; agents edited ONLY their assigned files. (Confirmed via git status; the /agent-status shape deviation was verified safe — LimitBanner is the only in-tree consumer.)
- [x] Wire EventsFeed into the UI (tabsConfig.ts + TasksPage.tsx — new "Events" tab, closeable; onOpenLog opens the Logs tab on that agent).
- [x] Wire LimitBanner into TasksPage.tsx next to the offline banner.
- [x] `pnpm run typecheck` clean; full `pnpm test` green (684/684, +22 from the wave; tabsConfig test expectation updated for the new tab); `pnpm run build` clean.
- [x] SPEC P0 items 7+8 marked SHIPPED; safety-net cron deleted. NO commits (per standing rule).

## WAVE COMPLETE — 2026-07-12
All work is uncommitted in the working tree for the user's review. Note: the user committed
the earlier session's work themselves as 75624a2 mid-wave. Remaining follow-up (not this
wave): observe a real limit window end-to-end (SPEC §6 verification backlog).
