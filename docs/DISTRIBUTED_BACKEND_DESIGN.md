# Distributed Backend + Secrets-at-Rest — Design

Status: proposed. Goal: let one project be worked by **many machines** sharing **one central DB**
(so memory-heavy Claude agents scale horizontally), with **pluggable Postgres** as an alternative
to the default SQLite, a **UI to connect / create the DB**, and **all secrets encrypted at rest**.

---

## 1. Why

- Claude Code agents are memory-hungry; one box can't run many in parallel.
- Split the work across N machines, but keep ONE source of truth (tasks, agents, tokens, projects,
  logs, readiness) so every machine has a common understanding.
- Optionally store that source of truth in **Postgres** (shared, networked) instead of local SQLite.
- While here: stop storing git tokens / GitHub-App private keys in **plaintext**.

Non-goals (v1): sharing the *code index* across machines (each machine indexes its own clone),
sharding a single task across machines, real-time UI multi-tenant auth.

---

## 2. What is shared vs. per-machine

| Data | Where | Notes |
|---|---|---|
| tasks, agents, projects, git_tokens, github_apps, board_settings, logs, readiness | **Central DB** (SQLite *or* Postgres) | the "brain" |
| **git clone + worktrees + node_modules** | **per-machine** | code is local; each machine clones the repo and passes the readiness gate locally |
| **code index** (embeddings) | **per-machine** (`local.db`) | same code → each machine can build its own; shared pgvector is a later option |
| secrets master key | **per-machine** (env or key file) | NOT in the DB |

Consequence: the DB holds *metadata* (repoPath, branch, cloneUrl, run-config, readiness); the actual
files live on each worker. A worker that joins a project must clone + install + verify preview before
it can run that project's tasks (the existing readiness gate already enforces this, per machine).

---

## 3. Layered plan

### Phase 1 — DB abstraction + Postgres adapter (SQLite stays default)  [L]
Introduce a thin store interface; keep SQLite as the default adapter; add a `pg` adapter.

- **Interface** (`agentic/db/store.ts`): a minimal query surface the rest of the code targets:
  ```ts
  interface Store {
    run(sql: string, params?: any[]): void;          // exec / write
    get<T>(sql: string, params?: any[]): T | null;    // one row
    all<T>(sql: string, params?: any[]): T[];         // rows
    tx<T>(fn: (s: Store) => T): T;                     // transaction
    dialect: 'sqlite' | 'postgres';
  }
  ```
- **Portable SQL**: replace SQLite-only constructs behind the adapter:
  | SQLite | Postgres |
  |---|---|
  | `INSERT OR REPLACE` | `INSERT … ON CONFLICT(pk) DO UPDATE` |
  | `INSERT OR IGNORE` | `INSERT … ON CONFLICT DO NOTHING` |
  | `INTEGER PRIMARY KEY AUTOINCREMENT` | `BIGINT GENERATED … AS IDENTITY` |
  | `PRAGMA quick_check` / `VACUUM` | no-op / `VACUUM` (admin) |
  | `?` placeholders | `$1,$2,…` (adapter rewrites) |
  | booleans as `0/1` | `boolean` (adapter coerces) |
  Adapter rewrites `?`→`$n` and `INSERT OR …` per dialect so call-sites stay dialect-agnostic.
- **Migrations**: keep the current additive-migration list, expressed in portable SQL; the Postgres
  adapter runs the same list to "create tables".
- SQLite adapter wraps `node:sqlite` (today's `DatabaseSync`); Postgres adapter wraps `pg` Pool.

### Phase 2 — Connect UI + create-DB/tables + encrypted creds  [M]
- **Backend config** (`db/backendConfig.ts`): `{ kind:'sqlite'|'postgres', url?, ... }` persisted to
  `db/backend.json` (gitignored). Postgres URL/creds **encrypted at rest** with the master key
  (§5). Read at db-server boot to pick the adapter.
- **Endpoints** (db-server):
  - `GET  /backend` → current kind + masked target (never returns the password)
  - `POST /backend/test` `{url}` → connect, report ok/err (does NOT persist)
  - `POST /backend/migrate` `{url}` → run migrations against the target ("create tables")
  - `PUT  /backend` `{kind, url}` → persist (encrypted) + switch on next boot (or hot-swap)
- **UI** (`DbBackendTab.tsx`, in Git Control or Settings): pick SQLite/Postgres, enter URL/creds,
  **Test**, **Create tables**, **Save**. Creds live in browser memory only while typing; on Save they
  post to the server which encrypts + stores them. (Browser-memory "encryption" is not real security —
  the server is the trust boundary.)

### Phase 3 — Multi-orchestrator safety (REQUIRED for multi-machine)  [L]
Today the orchestrator assumes **single writer**. Two machines on one DB will double-run and
double-merge unless:
- **Atomic task claim** — replace "read pending → set claimedBy" with a conditional claim:
  - Postgres: `SELECT … FOR UPDATE SKIP LOCKED` then `UPDATE … WHERE id=? AND claimedBy IS NULL`.
  - SQLite (single box): unchanged.
  Add a **worker id** (`WORKER_ID`, default hostname+pid). `claimedBy` becomes `worker:agent`.
- **Distributed merge lock** — a `locks` row (`name='merge:<projectId>'`, holder, expiresAt`) taken
  before a merge; `mergeInFlight()` reads the DB lock, not process memory.
- **Lease reclaim across machines** — `leaseExpiresAt` already exists; the watchdog reclaims a task
  whose lease expired AND whose worker hasn't heartbeat (a `workers` table: id, lastBeatAt). A dead
  machine's tasks return to the pool.
- **Preview ports / URLs** — per machine; the review preview must target the worker that built it
  (store `previewHost` on the task/preview record).

### Phase 4 — (optional) shared code index via pgvector  [M/L]
Move embeddings to Postgres `vector` so all machines query one index. Default stays per-machine.

---

## 4. Multi-machine flow

```
Machine A (has orchestrator) ─┐
Machine B (has orchestrator) ─┼─▶ ONE central Postgres (tasks/agents/tokens/projects/readiness/logs)
Machine C (has orchestrator) ─┘
   each: clones repo locally → readiness gate (clone+run-config+preview) → then claims tasks
   claim is atomic (FOR UPDATE SKIP LOCKED) → no double-run
   one merge at a time via DB lock → no double-merge
   dead machine → its leases expire → other machines reclaim its tasks
```

---

## 5. Secrets at rest (the "fix this too")

Today `git_tokens.token`, `github_apps.privateKey/clientSecret/webhookSecret` are **plaintext** in
the DB file. Fix: encrypt those columns (and the Postgres creds from §2) with **AES-256-GCM**.

- **`db/secretbox.ts`** (shared primitive):
  - `encrypt(plaintext): string` → `v1:<ivB64>:<tagB64>:<ctB64>` (self-describing)
  - `decrypt(token): string` (returns input unchanged if it isn't a `v1:` blob → back-compat with
    already-stored plaintext, enabling lazy migration)
  - `isEncrypted(s): boolean`
- **Master key** (`getMasterKey()`): from env `AGENTS_SECRET_KEY` (base64, 32 bytes). If absent,
  generate once and write `db/.secret.key` (gitignored, `chmod 600`) with a loud one-time log. The key
  is **never** in the DB and never leaves the machine.
- **Where applied**:
  - `addGitToken` / token reads → encrypt on write, decrypt in `…Raw` readers only (HTTP still masks).
  - `github_apps` privateKey/clientSecret/webhookSecret → same.
  - Postgres creds in `backend.json` → same.
- **Migration**: on boot, opportunistically re-encrypt any plaintext secrets found (decrypt() passes
  plaintext through, so reads never break during rollout).
- **Threat model**: protects the DB file/backup at rest. Does NOT defend a live host with the key
  (the server must decrypt to use them). Document this in `SECURITY.md`.

---

## 6. Rollout / ordering
1. **secretbox + secrets-at-rest** (independent, ship first — closes the plaintext gap on SQLite today).
2. **DB abstraction + pg adapter** (foundation; SQLite default unchanged).
3. **Connect UI + create-tables + encrypted creds**.
4. **Multi-orchestrator safety** — the gate that actually makes multi-machine correct.
5. (optional) pgvector shared index.

Do NOT point multiple machines at one Postgres before Phase 4 — without atomic claim + merge lock
they will double-run and corrupt merges.

---

## 7. Work split (parallel agents)
- **Agent A — Secrets at rest**: wire `secretbox` into `git_tokens` + `github_apps` persistence + boot
  re-encryption + SECURITY.md. Files: `agentic/db/tasks.ts` (token/app fns), SECURITY.md.
- **Agent B — Postgres connect (UI + endpoints + encrypted creds)**: `db/backendConfig.ts`,
  new db-server endpoints, `DbBackendTab.tsx`. Uses `secretbox`.
- **Core (owned by lead)** — DB abstraction/adapter (Phase 1) + multi-orchestrator (Phase 3): the
  coupled surface that touches every db call; done in sequence to avoid conflicts.
