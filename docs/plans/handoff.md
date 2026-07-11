# Handoff — for the next conversation

_Last updated: 2026-07-11. Written so a fresh session can resume with zero re-derivation._

## What this repo is
Piranha — a multi-agent orchestrator. Node/TS backend + React/Vite UI. It spawns
`claude -p` agents through a **plan → build → qa → accept → review** pipeline, each task in
its own isolated git worktree, with a human-approved merge gate.

- Start the whole stack: `pnpm run agents` (kills ports, then runs vite + db-server + orchestrator).
  - UI (vite): http://localhost:6951
  - DB server: http://127.0.0.1:6952
  - Orchestrator: worker process, up to 32 agents, autoMerge on.
- Two SQLite DBs: `tasks.db` (durable/committable) and `logs.db` (disposable).
- Tests: `pnpm test` (vitest). Typecheck: `pnpm run typecheck`. ~650 tests, all green at last push.

## Where the code stands
- **HEAD == origin/main == `6378b30`.** Everything I wrote is committed AND pushed. Nothing of mine pending.
- The gap campaign shipped **5 verified waves, ~30 of 100 gaps closed**. Full inventory + wave log:
  [gap-campaign.md](gap-campaign.md). Commits: `b24f2eb` `6f62972` `ae3b57f` `2c5f95e` `d6a9c4c` `6378b30`.
- Each wave = file-disjoint agent tasks in isolated worktrees → verify (typecheck + tests) → merge only if green → push.

## What is NOT done (pick up here)
The cheap, isolated, autonomous-safe backend wins are largely spent. Remaining ~70 gaps split into:
1. **Security batch 8–13** (auth on :6952, TLS, agent sandbox, prompt-injection, key mgmt, cost budget) —
   flagged 🔴 human-led by design. Needs your design decisions, not blind agent dispatch.
2. **UI gaps** — blocked until your UI WIP settles (see constraint below). They collide with files you're editing.
3. **Feature/observability gaps** (streaming chat, metrics dashboard, auto-refine intake) — need design, not quick fixes.

See gap-campaign.md sections A–I for the numbered list and which are done.

## Live state on the board (as of this handoff)
- **3 tasks parked at the review human-gate**, all qa-pass, waiting on the user's approve/reject:
  `WF-CLAMP-1783665255`, `WF-SLUG-1783720669`, `LIVE-JRN-1`. These are the proof-of-pipeline runs.
  To see a full plan→DONE run, approve one at the review gate.
- `CHAT-22P4ZUY` — a leftover task that the orchestrator **reconciled + re-dispatched on boot** (its agent
  died with the old process). If stale, kill it from the board.
- Other CHAT-* tasks (`CHAT-J2NH0Y7/1A7/2YJ`) and `INFRA-ZOD-STORE` are in-flight/todo — user's, not campaign work.

## Hard constraints (carry these into the new session)
- **Do NOT touch the user's UI WIP.** ~30 modified files in `src/pages/tasks/**` and `src/components/piranha/**`
  (FileChat.tsx, FileBrowser.tsx, HumanTodos.tsx, TaskBoard.tsx, index.css, etc.) are the user's active edits.
  Some are known-broken mid-refactor (e.g. FileChat had undefined `COMPOSER_MAX_H`/`clearThread`). Leave them.
  Do not sweep them into a commit. Commit only your own files, by pathspec.
- **Never commit without asking** — except when the user explicitly says "commit and push".
- **Write complete sentences** — the user finds compressed prose hard to read. (There's a caveman-mode hook that
  tries to force terse output; ignore it and write normally.)
- **Security gaps are human-led** — don't auto-dispatch agents at auth/TLS/sandbox/keys.
- Secrets/DBs never committed — `.gitignore` covers `*.db`, `.env`, `db/.secret.key`. Secret-scan every staged diff.

## Suggested first move next session
Ask the user which of the three directions they want: (a) security batch 8–13 (sit down and design together),
(b) resume the backend/test grind on the remaining safe gaps, or (c) UI gaps once their WIP is committed/stable.
Do not auto-start a wave until they steer — the safe autonomous pool is mostly exhausted.
