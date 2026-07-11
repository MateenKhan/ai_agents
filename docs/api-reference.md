# Piranha db-server — API Reference

This is the complete HTTP API of Piranha's **db-server** (`db/server.ts`), a raw Node
`http` server. The browser app is only a client of this API — every endpoint below is
something it (or an agent, or `curl`) can call. For a runnable version of the core flow,
import [`./piranha.postman_collection.json`](./piranha.postman_collection.json) into Postman.

## Conventions

- **Base URL:** `http://127.0.0.1:6952` (override the port with `DB_SERVER_PORT`). The
  server binds to `127.0.0.1` by default; set `HOST=0.0.0.0` only on a trusted, firewalled
  network.
- **Project scoping:** almost every route is scoped to a project. Pass `?project=<id>` in the
  query string (default `default`). Body routes may instead carry `projectId` in the JSON body;
  the query string wins when both are present.
- **Content type:** requests with a body send `Content-Type: application/json`; all responses
  are JSON (a few GitHub-App browser-redirect routes return HTML — noted inline).
- **Errors:** the repo convention is that **any non-2xx response is `{ "error": string }`**
  (sometimes with extra context fields). Common codes: `400` bad input, `404` not found,
  `409` conflict, `413` body too large, `422` invalid document, `500` server error, `501`
  unsupported on this backend, `502/504` upstream model failure, `503` DB unavailable /
  index rebuilding. The request-body cap is 10 MB (`413` past that).
- **Request size:** bodies over 10 MB are rejected with `413`.

> ### ⚠ Security note (this repo is public)
> **The db-server has NO authentication or authorization.** Any client that can reach the
> port can read and mutate every project, task, file, and git credential. It further holds
> secrets (GitHub PATs, GitHub App private keys, encrypted datastore URLs) which it stores in
> plaintext locally. Mitigations baked in: it binds to loopback by default, CORS is restricted
> to same-host/localhost origins (override with `CORS_ALLOW_ORIGIN`), and tokens are masked on
> read and stripped from git output. **Do not expose this port to an untrusted network.** If you
> set `HOST=0.0.0.0`, put it behind a firewall / reverse proxy you control.

---

## Health & status

| Method | Path | Params / body | Success response |
|---|---|---|---|
| `GET` | `/health` | — | `{ ok: true }` |
| `GET` | `/version` | — | `{ version, build: { commit, builtAt, node }, environment }` |
| `GET` | `/system-status` | `?project` | Live snapshot (see below) |
| `DELETE` | `/system-status/events` | `?project` | `{ ok, removed }` — clears the project's event feed |
| `DELETE` | `/system-status/events/:id` | — | `{ ok, removed }` — deletes one feed event (a `logs.db` row) |
| `POST` | `/heal` | — | `{ ok, healed, steps }` — recovery sweep |

`GET /system-status` returns:
`{ ok, activity, indexRebuilding, boardCorrupt, activeAgents, circuit, mode, indexRoot,
orchestrator: { agentStatus, statusLine, lastBeatAt, ageSec, up }, counts: { pending, working,
testing, done }, events }`.

`POST /heal` resets stuck/dead-lettered tasks, prunes orphan worktrees, integrity-checks the
DBs, clears stale logs, checks orchestrator liveness, and GCs context memory. `steps` is an
array of `{ step, status: 'ok'|'fixed'|'warn', detail }`.

> Status/diagnostic routes (`/health`, `/version`, `/heal`, `/agent-status`) always respond even
> while the board DB is paused. When the durable board DB fails its integrity check, every
> `/tasks*`, `/db/*`, and `/task-logs*` request returns `503 { error, reason, retryAfter }`.
> While the code index is rebuilding, `/search` returns `503`.

---

## Projects

| Method | Path | Params / body | Success response |
|---|---|---|---|
| `GET` | `/projects` | — | `{ ok, projects, activeCount }` |
| `POST` | `/projects` | `{ name, repoPath?, emoji?, branch?, cloneUrl? }` | `{ ok, project }` |
| `PUT` | `/projects/:id` | `{ name?, repoPath?, emoji?, branch?, cloneUrl?, maxConcurrency? }` | `{ ok }` |
| `DELETE` | `/projects/:id` | — | `{ ok }` (400 for `default` — undeletable; purges tasks + embeddings + logs) |
| `GET` | `/project/readiness` | `?project` | `{ ok, ready, bypass, checks: { repo, runConfig, preview }, previewVerifiedAt, reasons }` |
| `POST` | `/project/readiness/bypass` | `{ noExistingProject: true, notExecutable: true }` | `{ ok, bypass }` (400 unless BOTH true) |
| `GET` | `/project/run-config` | `?project` | `{ ok, config, repoPath }` |
| `PUT` | `/project/run-config` | `{ config: { install, run, build, test, cwd? }, confirm? }` | `{ ok, config, confirmed }` |
| `POST` | `/project/detect-run` | `?project` | `{ ok, config, source, repoPath }` — heuristic + Claude stack detection |
| `POST` | `/project/run` | `{ which: 'install'\|'run'\|'build'\|'test' }` | `{ ok, runId, which, cmd }` |
| `GET` | `/project/run/logs` | `?runId` | `{ ok, which, cmd, running, exitCode, log, startedAt }` |
| `GET` | `/project/runs` | `?project` | `{ ok, runs }` — run summaries (no logs) |
| `POST` | `/project/run/stop` | `{ runId }` | `{ ok }` — kills the process tree |

A project only dispatches tasks once **ready**: a cloned git repo, a confirmed run-config, and a
verified preview (or an explicit bypass).

---

## Tasks — the run loop

| Method | Path | Params / body | Success response |
|---|---|---|---|
| `GET` | `/tasks` | `?project` | Array of task objects |
| `POST` | `/tasks` | `?project`, task fields (`{ id, title, description, status, priority, ... }`) | `{ ok }` |
| `PUT` | `/tasks/:id` | task fields / agent verbs (see below) | `{ ok }` |
| `DELETE` | `/tasks/:id` | — | `{ ok }` |
| `PUT` | `/tasks/bulk-priority` | array of `{ id, priority }` | `{ ok }` |
| `POST` | `/tasks/:id/trigger` | `{}` | `{ ok, agentPrompt }` — queues the task for the orchestrator |
| `POST` | `/tasks/:id/start` | `{}` | `{ ok }` — fresh dispatch (attempts reset) |
| `POST` | `/tasks/:id/pause` | `{}` | `{ ok }` — hold from next dispatch (running agent left alone) |
| `POST` | `/tasks/:id/resume` | `{}` | `{ ok }` — clear hold, re-queue |
| `POST` | `/tasks/:id/stop` | `{}` | `{ ok, stopping: true }` — orchestrator kills the agent + parks the task |
| `POST` | `/tasks/:id/accept` | — | Report `{ taskId, status, logsPurged, branch, prompts }` — mark DONE + reclaim disk/DB |
| `POST` | `/tasks/:id/approve` | `{}` | `{ ok, stage }` — reports the gate's `approved` outcome (409 if the stage declares none) |
| `POST` | `/tasks/:id/reject` | `{ reason? }` | `{ ok, stage }` — reports `rejected` (409 if the stage declares none) |
| `GET` | `/tasks/:id/changes` | `?project`, `?meta=1` | The review diff (see below) |
| `POST` | `/tasks/:id/preview` | — | `{ status }` — build the branch and serve it on a free port |
| `GET` | `/tasks/:id/preview` | — | `{ status, url, port, apiPort, error, logTail, logName }` or `{ status: 'none' }` |
| `DELETE` | `/tasks/:id/preview` | — | `{ ok }` — tear the preview down |

**`GET /tasks/:id/changes`** is the review endpoint the UI depends on. It returns:

```json
{
  "ok": true,
  "exists": true,
  "base": "<base branch>",
  "branch": "task/<id>",
  "commits": [{ "sha": "...", "subject": "..." }],
  "files": [{ "path": "...", "status": "M", "additions": 3, "deletions": 1 }],
  "diff": "<unified diff>",
  "truncated": false,
  "qaVerdict": null,
  "summary": null,
  "plan": null,
  "journal": []
}
```

Pass **`?meta=1`** to get the file list and commits *without* the heavy unified diff (`diff` is
`""`, `truncated: false`) — used to cheaply check whether a task has anything to preview. When
the branch does not exist yet, `exists` is `false` and `files`/`commits`/`diff` are empty. The
full diff is capped at ~200 KB (`truncated: true` past that).

**`PUT /tasks/:id`** is also the verb agents use to report progress. Recognized body keys:
`{ "outcome": "pass" }` advances the workflow, `{ "reject": "why" }` bounces the task back,
`{ "consult": { "to": "plan", "question": "..." } }` asks a peer, `{ "etc": <minutes> }` sets an
ETA (capped at 30). Control-plane fields (`handoffFrom`, `hops`, `consultLog`) supplied by a
caller are stripped.

> Note: the Postman collection lists a `GET /tasks/:id` ("Get one task"), but `db/server.ts`
> implements only `PUT`/`DELETE` on `/tasks/:id` — a `GET` on a single task id falls through to
> `404`. Fetch the full list with `GET /tasks` instead.

### Task & agent logs

| Method | Path | Params / body | Success response |
|---|---|---|---|
| `GET` | `/task-logs/:id/file` | — | `{ path, exists, lines }` — the task's append-only log file |
| `GET` | `/task-logs/:id` | — | `{ logs }` — DB-based per-task history (last 100) |
| `DELETE` | `/task-logs/:id` | — | `{ purged }` |
| `GET` | `/agent-logs/:name` | `?project` | Array of `{ id, message, timestamp }` (`__clone__`/`__index__` are synthetic streams) |
| `DELETE` | `/agent-logs/:name` | — | `{ ok }` — truncate one agent log file |
| `GET` | `/agent-log-files` | `?project` | `{ files }` — the Logs-tab chips |
| `GET` | `/agent-status` | — | Array of active agent names |
| `POST` | `/agent-stop/:name` | — | `{ ok }` — legacy no-op that clears a UI-tracking entry |
| `GET` | `/db-usage` | — | `{ usage }` — per-agent DB usage summary |

---

## Workflow (define the pipeline)

| Method | Path | Params / body | Success response |
|---|---|---|---|
| `GET` | `/workflow` | `?project` | `{ doc, source, valid, docErrors, stageIssues, occupied }` |
| `PUT` | `/workflow` | `?project`, `{ doc, expectedRev }` | `{ ok, doc }` |
| `DELETE` | `/workflow` | `?project` | `{ ok, doc }` — reset to the built-in pipeline |

`PUT` uses optimistic concurrency: `expectedRev` must match the current `rev` or the save is
rejected. Error responses: `409 { error, currentRev }` (someone else saved first),
`422 { error, docErrors, stageIssues }` (invalid graph), `409 { error, conflicts }` (a live task
would be stranded), `400` if `expectedRev` is not a whole number.

---

## Code index & context

| Method | Path | Params / body | Success response |
|---|---|---|---|
| `POST` | `/search` | `{ query, topK?, projectId?, agentName?, taskId? }` | `{ results, remembered, evicted }` |
| `POST` | `/ask` | `{ query, topK?, projectId? }` | `{ answer, sources }` — RAG answer grounded in the index |
| `GET` | `/context` | `?project`, `?cap` | `{ files, stats }` — the project's shared working memory |
| `GET` | `/context/ops` | `?project`, `?limit` | `{ ops }` |
| `GET` | `/context/usage` | `?project`, `?limit` | `{ usage }` |
| `POST` | `/context/sweep` | `?project`, `?cap` | `{ result }` — reconcile against disk + GC |
| `POST` | `/context/pin` | `{ path, pinned, actor? }` | `{ ok }` |
| `POST` | `/context` | `{ path, addedBy?, pinned?, taskId? }` | `{ file, evicted, stats }` — keep a file in context |
| `DELETE` | `/context` | `?path`, `?project` | `{ ok }` |
| `GET` | `/project-context` | `?project` | `{ brief, generatedAt, model }` — cached project brief |
| `POST` | `/project-context/rebuild` | `?project` | `{ ok, started }` — regenerate the brief (async) |
| `GET` | `/code-index/status` | `?project` | `{ ok, root, glob, isDefault, files, nodes, embedded, coverage, healthy, rebuilding }` |
| `GET` | `/code-index/progress` | `?project` | `{ building, lines }` |
| `POST` | `/code-index/rebuild` | `?project` | `{ ok, rebuilding: true }` |
| `PUT` | `/code-index/root` | `{ root?, glob? }` | `{ ok, rebuilding: true }` — retarget + rebuild |
| `GET` | `/files` | `?project` | `{ root, files }` (or `{ root, files: [], isHost: true }` for the host project) |
| `GET` | `/spec/:name` | — | `{ name, content }` — read-only spec markdown (`specs/` only) |

`/search` is the only door to the code index: searching also records who searched, remembers the
matched files in shared context, bumps their use counts, and evicts least-frequently-used.

---

## Agents & settings

| Method | Path | Params / body | Success response |
|---|---|---|---|
| `GET` | `/agents` | — | `{ agents }` — the agent roster (models, prompts, worktree modes) |
| `PUT` | `/agents` | agent object | `{ ok }` — upsert one agent |
| `DELETE` | `/agents/:role` | — | `{ ok }` |
| `POST` | `/agents/reset` | `{}` | `{ ok }` — restore shipped defaults |
| `GET` | `/agent-defaults` | — | Global agent defaults (`maxConcurrency`, `skipPermissions`) |
| `PUT` | `/agent-defaults` | `{ maxConcurrency?, skipPermissions? }` | Updated defaults |
| `GET` | `/settings` | — | Board settings object |
| `PUT` | `/settings` | settings fields | `{ ok }` |

---

## File browser (`/file` CRUD + AI edit)

| Method | Path | Params / body | Success response |
|---|---|---|---|
| `GET` | `/file` | `?path`, `?project` | `{ path, bytes, tokens, truncated, content }` (empty `content` if >512 KB) |
| `PUT` | `/file` | `{ path, content }` | `{ ok, path, bytes }` — overwrite (404 if missing) |
| `POST` | `/file` | `{ path, content? }` | `{ ok, path }` — create (+ parent dirs); 409 if it exists |
| `DELETE` | `/file` | `?path`, `?project` | `{ ok, path }` (404 if missing) |
| `POST` | `/file/ai-edit` | `{ instruction, files?, uploads?, sessionId?, model?, effort? }` | `{ answer, sessionId, proposals, metrics }` |

Every path is guarded against escaping the repo (`400 { error: 'path escapes repo' }`).

**`POST /file/ai-edit`** is the file-browser chat engine. It reads the tagged repo `files` and
reference `uploads`, sends the `instruction` to `claude -p` (no API key — same CLI/auth as
`/intake`), and returns a **proposal only** (it writes nothing; the human then calls `PUT /file`
to apply). Response:

```json
{
  "answer": "<short explanation>",
  "sessionId": "<uuid — pass back to continue the thread>",
  "proposals": [
    { "path": "src/x.ts", "oldContent": "...", "newContent": "...", "diff": "<unified diff>" }
  ],
  "metrics": { "responseMs", "responseSec", "ttftMs", "outputTokens", "inputTokens", "tps", "costUsd" }
}
```

Error responses include `400` (missing `instruction`), `413` (uploads over 2 MB), `504` (model
timed out after 150 s), and `502 { error, raw }` (could not parse a proposal). `model` is one of
`haiku`/`sonnet`/`opus` (default `sonnet`); `effort` is `low`/`medium`/`high`.

---

## Intake

| Method | Path | Params / body | Success response |
|---|---|---|---|
| `POST` | `/intake` | `{ message, autoStart?, project? }` | `{ ok, created, gated }` |

Decomposes one natural-language `message` into concrete tasks via `claude -p`. Created tasks land
as `WORKING` (so the orchestrator starts them) unless `autoStart` is `false` or a task fails the
spec quality gate — those are held as `AVAILABLE` with a refinement note. `created` is an array of
`{ id, title, status, needsRefinement, issues }`; `gated` is the count held for refinement. Errors:
`400` (empty message), `502 { error, raw }` (could not parse tasks from the model).

---

## Git

### Config & credentials

| Method | Path | Params / body | Success response |
|---|---|---|---|
| `GET` | `/git/config` | — | `{ configured, username, host, tokenMasked }` |
| `PUT` | `/git/config` | `{ token?, username?, host? }` | `{ ok }` (blank token preserves the stored one) |
| `DELETE` | `/git/config` | — | `{ ok }` — clears the token |
| `GET` | `/git/tokens` | `?project` | `{ ok, tokens }` — labeled PATs (masked) + installed GitHub Apps |
| `POST` | `/git/tokens` | `{ token, label?, scope?, username?, host? }` | `{ ok, id }` |
| `PUT` | `/git/tokens/:id` | `{ label?, token?, scope?, username?, host? }` | `{ ok }` |
| `DELETE` | `/git/tokens/:id` | — | `{ ok }` |
| `GET` | `/git/assignments` | `?project` | `{ ok, assignments, agents }` — which PAT each agent uses |
| `PUT` | `/git/assignments` | `{ agent, tokenId? }` | `{ ok }` |

### Repo operations

Most of these accept `repo` in the body (or `?repo=` for GETs); when omitted it defaults to the
project's `repoPath`. `tokenId` selects a stored PAT, or `app:<recordId>` to mint a GitHub App
installation token. Tokens are always stripped from returned output.

| Method | Path | Params / body | Success response |
|---|---|---|---|
| `GET` | `/git/status` | `?repo`, `?project` | `{ ok, repo, branch, ahead, behind, clean, files }` |
| `GET` | `/git/diff` | `?repo`, `?file` | `{ ok, diff }` |
| `POST` | `/git/clone` | `{ url, dir, branch?, tokenId?, project? }` | `{ ok, dir, output, project }` (async; poll progress) |
| `GET` | `/git/clone-progress` | `?project` | `{ lines, done, ok, dir }` |
| `POST` | `/git/delete-repo` | `{ dir }` | `{ ok, folderDeleted, deleted, folderKept, removedProject }` |
| `POST` | `/git/clone-import` | `{ url, tokenId?, emoji? }` | `{ ok, project, cloned, dir, output }` |
| `POST` | `/git/create-repo` | `{ name, private?, tokenId? }` | `{ ok, repo: { full_name, clone_url, html_url } }` |
| `POST` | `/git/init-repo` | `{ dir, name, emoji? }` | `{ ok, dir, project }` — mkdir + `git init` + register project (first-run "new folder") |
| `POST` | `/git/commit` | `{ repo?, message, addAll? }` | `{ ok, hash, output }` |
| `POST` | `/git/push` | `{ repo?, branch?, remote?, tokenId? }` | `{ ok, branch, output }` |
| `POST` | `/git/pull` | `{ repo?, tokenId? }` | `{ ok, branch, output }` |
| `POST` | `/git/remote-branches` | `{ url, tokenId? }` | `{ ok, default, branches }` |
| `GET` | `/git/branches` | `?repo` | `{ ok, current, branches, local }` |
| `POST` | `/git/checkout` | `{ repo?, branch }` | `{ ok, branch, output }` |
| `POST` | `/git/branch` | `{ repo?, name, from? }` | `{ ok, branch, output }` |
| `GET` | `/git/worktrees` | `?project` | `{ ok, worktrees }` — per-task checkouts joined to the board |
| `GET` | `/git/log` | `?repo`, `?ref`, `?limit` | `{ ok, repo, ref, commits }` |
| `GET` | `/git/show` | `?repo`, `?hash` | `{ ok, hash, author, email, date, subject, files, diff }` |

### GitHub App integration

| Method | Path | Params / body | Success response |
|---|---|---|---|
| `POST` | `/git/github-app/manifest` | `{ name?, org?, permissions?, dbPublicUrl?, appUiUrl? }` | `{ ok, state, postUrl, manifest }` |
| `POST` | `/git/github-app/manual` | `{ appId, privateKey, name?, slug? }` | `{ ok, id, installed, account, detectError }` |
| `GET` | `/git/github-app/callback` | `?code`, `?state` | **HTML** — GitHub redirect target (converts the manifest) |
| `GET` | `/git/github-app/setup/:state` | `?installation_id`, `?setup_action` | **HTML** — post-install redirect |
| `GET` | `/git/github-apps` | `?project` | `{ ok, apps }` — masked list |
| `POST` | `/git/github-apps/:id/detect-installation` | — | `{ ok, installed, account }` |
| `GET` | `/git/github-apps/:id/repos` | — | `{ ok, repos }` |
| `PATCH` / `PUT` | `/git/github-apps/:id` | `{ name }` | `{ ok }` — rename |
| `DELETE` | `/git/github-apps/:id` | — | `{ ok }` |

---

## DB admin

The DB browser is **SQLite-only** — under a Postgres backend every `/db/table*` route returns
`501 { error, reason }`. Allowlisted tables: `tasks`, `board_settings`, `agents`, `memory`
(tasks.db); `agent_logs`, `agent_db_usage` (logs.db).

| Method | Path | Params / body | Success response |
|---|---|---|---|
| `GET` | `/db/tables` | — | `{ tables: [{ name, rows }] }` |
| `GET` | `/db/table/:table` | `?limit`, `?offset`, `?q`, `?sort`, `?dir` | `{ columns, rows, total }` |
| `POST` | `/db/table/:table` | column/value object | `{ ok }` — insert |
| `PUT` | `/db/table/:table/:rowid` | column/value object | `{ ok }` — update by rowid |
| `DELETE` | `/db/table/:table/:rowid` | — | `{ ok }` |
| `POST` | `/db/table/:table/bulk-delete` | `{ rowids }` | `{ ok, deleted }` |
| `POST` | `/db/table/:table/bulk-update` | `{ rowids, set }` | `{ ok }` |
| `GET` | `/db/restore-defaults` | `?mode=delete\|overwrite` | Preview of what would change (no writes) |
| `POST` | `/db/restore-defaults` | `{ mode: 'delete'\|'overwrite' }` | `{ ok, agents, boardSettings }` |

`restore-defaults` never touches `projects` or `tasks`, and within `board_settings` only the
declared config keys. `400` if `mode` is anything but `delete`/`overwrite`.

---

## Orchestrator control

| Method | Path | Params / body | Success response |
|---|---|---|---|
| `POST` | `/orchestrator/pause` | `{}` | `{ ok }` — sets `board_settings.agentStatus = PAUSED` |
| `POST` | `/orchestrator/start` | `{}` | `{ ok }` — sets `agentStatus = STARTED` |

The orchestrator is a separate process; these routes only flip the flag it reads.

---

## Datastore backend

Selects/records the datastore (SQLite default, Postgres opt-in). Saving only records the
choice — the swap takes effect on the next db-server boot. Passwords are never returned.

| Method | Path | Params / body | Success response |
|---|---|---|---|
| `GET` | `/backend` | — | `{ kind, target }` — masked, no password |
| `POST` | `/backend/test` | `{ url }` | `{ ok }` or `{ ok: false, error }` (200 even on failure — the probe ran) |
| `PUT` | `/backend` | `{ kind, url? }` | Masked config — encrypts + persists |
| `POST` | `/backend/migrate` | `{ url }` | `{ ok }` or `{ ok: false, error }` — creates tables on a Postgres target |
