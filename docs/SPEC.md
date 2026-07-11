# Piranha — Product Spec & Roadmap

_The single spec file. Supersedes everything that used to live in `docs/plans/` (gap-campaign,
handoff, self-work-backlog, ui-backlog, screen-recorder, review-changes-panel,
file-browser-backend, ai-chat-metrics-ui — all deleted; their shipped work is noted below,
their open items are carried here). Update THIS file; do not create new plan files._

---

## 1. What Piranha is

A multi-agent orchestrator: a Kanban board that drives headless `claude -p` agents through a
**plan → build → qa → accept → review** pipeline, each task in an isolated git worktree, with a
**human-approved merge gate** before anything lands. Node/TS backend (raw `node:http` db-server
on :6952 + orchestrator worker) and a React/Vite UI (:6951). Two SQLite DBs by default
(`tasks.db` durable, `logs.db` disposable); an optional Postgres backend exists behind
`configureBackend()`.

Start the stack: `pnpm run agents`. Tests: `pnpm test` (~660 green). Typecheck: `pnpm run typecheck`.

### Already shipped (from the old plan files — do not re-plan these)
- Screen recorder (manual, opt-in `getDisplayMedia`) — `RecordButton.tsx` + `services/screenRecorder.ts`.
- Review-gate **Changes** panel consuming `GET /tasks/:id/changes` — `ChangesPanel.tsx`.
- File Browser write + AI-edit backend (`PUT/POST/DELETE /file`, `POST /file/ai-edit`).
- AI-chat response metrics (TPS + response time) in `FileChat.tsx`.
- Failure→retry injection (`failureDetail`), stage journal, plan/summary split, intake gate,
  secret redaction (one shared util), gitAuth extraction — all unit-tested.
- UI polish backlog: 105/105 items done and verified (a11y, empty states, tokens, shortcuts).
- Gap campaign waves 1–5 (~30 of 100 gaps): upload caps, clear 504s, DB indexes, typed row
  mappers, body-size bounds, `unifiedDiff` module, API reference, GET /tasks/:id fix, etc.

---

## 2. RELEASE 1 — Standalone, single machine (the current mission)

**Definition:** one person, one computer, `npx @airtajal/piranha` (or `pnpm run agents`), a
usable and safe out-of-box experience. Everything below is ordered by priority.

### P0 — must land before calling it a release

1. **First-run starting screen** *(in progress — this session)*
   The flow today drops a new user onto an empty board bound to whatever folder the process
   started in. Wrong: the project source is the root decision everything else depends on.
   On first launch (no configured project, no tasks) show a full-screen setup:
   - **Clone an existing repository** — URL (+ optional branch/folder/token), reuses
     `POST /git/clone` (which already creates + activates a project and indexes the repo).
   - **Start in a new folder** — path + project name; new endpoint `POST /git/init-repo`
     creates the folder, `git init`s it, and registers the project.
   - **Use this folder as-is** — escape hatch for the "I launched it inside my repo" flow.
   - **Workspace settings on the same screen**: max concurrent agents and the agent-safety
     (skip-permissions) toggle, via the existing `GET/PUT /agent-defaults`.
   Completion is remembered (`piranha:setup-done`); the screen never nags again.

2. **Tabbed task creation: Manual | From AI** *(in progress — this session)*
   One "New task" modal with two tabs. **Manual** = the current full form. **From AI** = the
   chat-intake composer (plain-language description → `POST /intake` splits it into
   GIVEN/WHEN/THEN scenario-tasks), with the fields that make no sense for AI intake removed
   (title/DoD/status/priority/depends/files/parent — the model generates those). The separate
   ChatIntake modal is folded into this and deleted.

3. **Agent sandbox — replace blanket `--dangerously-skip-permissions`**
   Keep headless agents unattended WITHOUT full permissions bypass:
   - Write a generated `.claude/settings.json` into each worktree at spawn:
     allow Edit/Write (cwd-scoped) + `Bash(pnpm test|build|typecheck)` + read-only git;
     deny `curl/wget`, `git push`, `Read(.env)`, `Read(**/.secret.key)`, WebFetch/WebSearch.
   - Spawn with `--permission-mode acceptEdits` instead of the skip flag.
   - Per-role profiles: plan = read-only (`--disallowedTools Edit,Write`), qa = no push,
     dev = full worktree write.
   - Settings toggle becomes a 3-level profile: strict / standard (default) / dangerous.

4. **Cost capture + budgets (spend is unbounded today)**
   The final `stream-json` `result` event already carries `total_cost_usd`; the runner parses
   that event and throws the number away (`runner.ts` `parseEvent`). Fix:
   - Capture `costUsd` into `RunResult`, accumulate on the task row across stages/retries.
   - Enforce at dispatch: task over per-task cap → park BLOCKED "budget exceeded" (visible on
     the card); project over daily cap → stop dispatching + banner. Defaults: $2/task, $25/day.
   - Pass `--max-turns` (~80) per spawn as the per-run bound. Both caps editable in Settings.

5. **db-server split: middleware spine, then route modules**
   `db/server.ts` is ~3.2k lines / ~90 endpoints of raw `node:http`. Order matters:
   1. A tiny internal router (~100 lines, zero deps): method+pattern matching, then a
      middleware chain — request-id + timing, CORS, body-size limit + JSON-parse→400, ONE
      error envelope `{error}`, and the auth hook (P1.7) when it lands.
   2. Move domains one wave at a time, **verbatim** (no refactoring during moves):
      `db/routes/git.ts` (biggest, ~30 endpoints), `tasks.ts`, `files.ts`, `agents.ts`,
      `context.ts`, `dbBrowser.ts`, `logs.ts`, `system.ts`.
   3. `server.ts` shrinks to bootstrap (<200 lines).

6. **Demo GIF in the README** — record a task flowing plan→build→qa→review→merge with the
   built-in recorder. Highest-ROI marketing artifact; the README placeholder is waiting.

7. **Live events feed — MANDATORY.** The event data exists (`agent_logs` rows + the task
   journal) but the UI has no single live activity view. Add an **Events** table:

   | Task | Agent | Action | Link | Time | Attempt |
   |---|---|---|---|---|---|
   | Draw arrow | Architect | planned (3 scenarios) | 📄 → task log | 30 sec ago | 2nd |

   - One row per pipeline event (stage start/finish, outcome, retry, merge, gate hold).
   - **Link** = an icon opening that task's log (`logPath` is already persisted per task) at
     the right run; **Time** = relative ("30 sec", "1 min ago"), live-refreshed; **Attempt**
     = ordinal from `task.attempts`/journal so a 2nd try is visible at a glance.
   - Filterable by task/agent; newest first; polls like the board does. Lives as a Board-tab
     panel or its own tab — decide in UI review.

8. **Usage-aware pause + auto-resume — MANDATORY.** When the Claude plan limit hits, agents
   fail; today that's classified as a generic `network` failure and blindly retried/backed
   off. Instead:
   - Parse the limit error from agent output — the CLI's message carries the **reset
     timestamp** (`usage limit reached|<epoch>`); extract `resetAt`.
   - New failure kind `limit`: does NOT count against `attempts`, never dead-letters, never
     trips the circuit breaker as a crash.
   - **Global pause**: orchestrator stops dispatching until `resetAt` (persisted, so a restart
     during the pause stays paused); waiting tasks return to the pool untouched.
   - **Auto-resume**: at `resetAt` (+ small jitter) dispatch resumes by itself — overnight runs
     survive a limit window without a human.
   - UI: page-wide banner with a live countdown — "Plan limit reached · swarm resumes 14:00".
   - Note: there is no official usage-status API for subscription plans; the reset time comes
     from the error itself. API-key deployments can additionally read the
     `anthropic-ratelimit-*` response headers. A best-effort local estimator (parsing
     `~/.claude` transcript usage, as ccusage-style tools do) can warn BEFORE the wall — P1.

### P1 — should land soon after

7. **Auth on the db-server** — bearer token (generated at first boot, shown on the start
   screen) checked in the middleware chain. Mandatory before any non-localhost deploy and
   a prerequisite for Release 2.
8. **Rate-limit / bound the public-ish endpoints** (`/search`, `/intake`, `/file/ai-edit`).
9. **Error-handling sweep of the orchestrator hot path** — the risky empty `catch {}`es:
   swallowed migration errors must mark the server unhealthy; `addAgentLog` failure counted
   and surfaced; spawn errors always produce a visible message.
10. **Live-fire the reliability claims** — force a crash and observe failure→retry; trigger a
    consult; kill an agent and watch the watchdog reclaim. Unit tests exist; the README's
    "runs unattended" checkmark needs a live proof.
11. **`/tasks` pagination** + WAL checkpoint/VACUUM schedule + `tasks.db` backup rotation.
12. **Levelled logger** replacing raw `console.*` in libraries (85 call sites).

### P2 — nice to have in the standalone release

13. Structured JSON event log + basic metrics endpoint (success rate, stage time, cost/task).
14. Streaming AI chat (SSE) with live token counter.
15. Auto-refine a gated intake task (one model pass to add scenarios/DoD) before holding it.
16. "Retry from here" on dead-lettered tasks; bulk-approve at the review gate.
17. Type-safety debt: the load-bearing `any`s (db-browser rows, `/changes` response,
    workflow doc, agent report bodies at the PUT boundary).
18. Dead-code sweep, `noUnusedLocals`, CHANGELOG per release.

---

## 3. RELEASE 2 — Fleet: centralised DB, multi-machine swarm

**Definition:** one shared task board; N machines each running an orchestrator; every instance
keeps pulling tasks from the same queue. Personas: one person with 10 computers on one Max
plan; a startup with API credits; a company with many seats.

**What already exists (dormant, never live-tested):** the `Store` seam with a full Postgres
implementation (`agentic/db/pgStore.ts`, `configureBackend({kind:'postgres'})` puts ALL tables
in one shared DB); worker identity + registry + heartbeat (`workers` table, `WORKER_ID`);
atomic `claimTask` (compare-and-set, `RETURNING` on PG); stale-worker reclaim (a dead
machine's tasks return to the pool); a per-project merge lock (holder + TTL) so only one
machine merges at a time.

**Phases:**
- **Phase 0 — prove the dormant machinery.** Postgres in Docker; full suite against PG; run
  TWO orchestrators on one machine against the same PG with distinct `WORKER_ID`s. Closes old
  gaps 23/24/28 (PG e2e, two-worker contention, claim TOCTOU on PG).
- **Phase 1 — git source-of-truth flip (the real feature).** Today a merge advances `main`
  only on the merging machine's disk — there is no push/fetch anywhere in the engine. Change:
  every project gets a `repoUrl`; the merge winner pushes to origin immediately; every worker
  fetches origin before dispatch and cuts worktrees from `origin/main`. Origin is the truth;
  clones are caches.
- **Phase 2 — worker mode + workspace convention.** `piranha worker --db postgres://hub/...`
  (orchestrator + local db-server, no UI). `PIRANHA_WORKSPACE` root where a worker auto-clones
  any project it doesn't have — the shared `projects.repoPath` is machine-specific and must
  not be trusted across machines.
- **Phase 3 — fleet security.** Bearer auth (from P1.7) + TLS; document Tailscale/WireGuard as
  the recommended personal-fleet network. An unauthenticated shared task DB is RCE on every
  worker — tasks are prompts are shell commands.
- **Phase 4 — fleet polish.** Workers panel in the UI (who's alive, chewing what); fleet-wide
  cost budget (sum over the shared PG); per-worker capacity (`MAX_AGENTS`); fleet-level 429
  backoff flag (10 machines on one Max plan share its rate limits).

**Design rule:** keep the hub dumb. No scheduler, no capability matching — the atomic claim IS
the scheduler. Pull, don't push.

**Data split (from the old DISTRIBUTED_BACKEND_DESIGN, whose phases 1–3 are now implemented):**
the central DB holds metadata only (tasks, agents, projects, tokens, logs, readiness); git
clones, worktrees, node_modules and the code-embedding index stay **per-machine**; the secrets
master key stays per-machine (env or key file), never in the DB. Optional later: shared code
index via pgvector; a mobile control-plane with real auth.

---

## 4. RELEASE 3 — Multi-engine agents + distribution

**Definition:** Piranha stops being Claude-only and stops being clone-only. Two independent
tracks; both are future work (nothing here blocks Release 1 or 2).

### 4a. Engine adapters — drive any headless coding agent

Today the runner hard-codes `claude -p --output-format stream-json` (`agentic/engine/runner.ts`).
Introduce an **EngineAdapter** interface so each agent slot can run a different vendor:

```ts
interface EngineAdapter {
  id: string;                       // 'claude' | 'codex' | 'gemini' | ...
  spawnArgs(prompt, model, opts): { bin: string; args: string[]; env?: Record<string,string> };
  parseEvent(line: string): AgentAction | null;   // vendor stream → readable action lines
  extractResult(output): { costUsd?: number; turns?: number };  // for budgets/metrics
  detect(): Promise<boolean>;       // is the binary on PATH + authenticated?
}
```

**Adapter candidates (headless CLIs — these can be runners):**
| Engine | CLI / headless mode | Notes |
|---|---|---|
| Claude Code | `claude -p` (stream-json) | current default; reference adapter |
| OpenAI Codex CLI | `codex exec` | GPT models; JSON output mode |
| Google Gemini CLI | `gemini` non-interactive `-p` | free tier attractive for QA-role agents |
| GitHub Copilot CLI | `copilot` / coding-agent | company seats scenario |
| Aider | `aider --message` | open-source, model-agnostic (GPT/Gemini/local) |
| Cursor CLI | `cursor-agent` | Cursor's headless agent |
| OpenHands | headless mode | open-source |
| Qwen Code / Goose / Amp | various | evaluate when demand shows up |

Design rules: per-agent engine choice in the Agents tab (architect on Claude, QA on Gemini is a
legitimate cost play); per-engine failure classification feeding the same circuit breaker; cost
capture normalised through `extractResult` so budgets stay engine-agnostic; the sandbox profile
(P0.3) must be re-expressed per engine (each CLI has its own permissions flags — an engine with
no equivalent runs only in the Docker hardened mode). Prompts stay engine-neutral: the pipeline
contract ({outcome}/{reject}/{consult}) is plain text, so adapters mostly translate spawn flags
and output framing, not the methodology.

**IDE/agentic editors (NOT runners — companion surfaces):** Cursor, Windsurf, Google
Antigravity, VS Code + Copilot, JetBrains, Zed. These integrate via the extension track below
(show the board, send tasks, review diffs) rather than by being spawned headlessly.

### 4b. Distribution — meet users where they are

1. **npm** — `@airtajal/piranha` already has a `bin`; add a release pipeline (version, publish,
   `npx @airtajal/piranha` smoke-tested on a clean machine) so install is one command.
2. **Docker** — Dockerfile + compose exist; publish a versioned image to Docker Hub/GHCR with
   the hardened sandbox as the default mode (the container IS the sandbox), volumes for
   `tasks.db` + workspace, and a one-liner `docker compose up` quick start.
3. **VS Code Marketplace extension** — the highest-leverage surface. v1 is thin: a webview
   panel embedding the board UI (localhost :6951), a status-bar review-gate badge, commands
   ("Piranha: new task from selection", "approve/reject"), and starting the stack if it isn't
   running. Because Cursor, Windsurf and Antigravity are VS Code forks, ONE extension covers
   all four marketplaces (publish to Open VSX too for the forks that use it).
4. Later: JetBrains plugin, a `brew`/`winget` formula, and a hosted demo instance.

---

## 5. Security backlog (human-led design; never auto-dispatch agents at these)

Carried from the old gap campaign, still open:
- TLS termination for the API (tokens cross the wire in plaintext). → Release 2 Phase 3.
- Prompt-injection mitigation — hostile repo content flows into agent prompts unfiltered.
  (The sandbox in P0.3 contains the blast radius; filtering is still open.)
- Secret-key management — `db/.secret.key` lives on disk beside the data.
- Path-traversal audit across ALL file endpoints; CORS allowlist review for public deploys;
  `/db/table/:t` table-allowlist bypass check; audit remaining string-built SQL;
  redact secrets in `agent_logs` generally (failureDetail + git output are done).
- `/intake` still shells out with `--dangerously-skip-permissions` directly — route it through
  the same sandbox profile as agents (P0.3).

---

## 6. Verification backlog (claims to prove, not code to write)

- Multi-orchestrator lease/lock contention (→ Release 2 Phase 0).
- Watchdog lease-expiry reclaim; `reconcileStranded` recovery; circuit-breaker
  open/half-open/recover; merge-lock release on every merge exit path — live, not just unit.
- `dependsOn` actually blocks dispatch; task priority affects dispatch order (+ expose in UI).
- Concurrent `PUT /tasks/:id` last-write-wins vs lost-update audit.

---

## 7. Working agreements (carried from the old handoff)

- Never commit/push without the user asking; work directly on `main` (no branches).
- Untracked/unexpected files that aren't yours are the user's parallel work — leave them.
- Secrets/DBs never committed (`*.db`, `.env`, `db/.secret.key` are gitignored); secret-scan
  every staged diff.
- Verify every change: `pnpm run typecheck` + relevant `vitest`; full suite before a release.
