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
| 1 | Limit detection + global pause/auto-resume (backend) | agentic/types.ts, agentic/engine/runner.ts, agentic/engine/orchestrator.ts, agentic/db/migrations.ts, agentic/db/tasks.ts, agentic/__tests__/limitPause.test.ts | dispatched | 🚧 |
| 2 | /events endpoint + limitPausedUntil on /agent-status + api-reference | db/server.ts, docs/api-reference.md, db/__tests__/events.test.ts | dispatched | 🚧 |
| 3 | EventsFeed table component (Task/Agent/Action/Link/Time/Attempt) | src/pages/tasks/components/EventsFeed.tsx + __tests__/EventsFeed.test.tsx | dispatched | 🚧 |
| 4 | LimitBanner component (countdown banner) | src/pages/tasks/components/LimitBanner.tsx + __tests__/LimitBanner.test.tsx | dispatched | 🚧 |

## Integration (governor = the orchestrating session; do AFTER agents finish)
- [ ] Review each agent's diff; agents edited ONLY their assigned files.
- [ ] Wire EventsFeed into the UI (tabsConfig.ts + TasksPage.tsx — new "Events" tab, closeable).
- [ ] Wire LimitBanner into TasksPage.tsx next to the offline banner.
- [ ] `pnpm run typecheck` clean; full `pnpm test` green; `pnpm run build` clean.
- [ ] Update SPEC P0 items 7+8 status; update this ledger; report to the user. NO commits.

## Next actions (for a resumed session)
1. Check wave status above; if agents are still running, wait/monitor.
2. If agents finished: do the Integration checklist.
3. If everything is checked: CronDelete the safety-net job and stop.
