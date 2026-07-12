# Piranha Security Audit — 2026-07 (pre-commercial gate)

Read-only audit of the open items in `docs/SPEC.md` §5 against the actual code. Scope: the
db-server (`db/server.ts` + `db/router.ts` + `db/routes/*`) and its supporting libs. Every
finding cites `file:line` against the tree at audit time. No product code was changed.

**Headline:** the db-server has **no authentication of any kind** (SPEC P1.7 not yet landed) and
ships an entire unguarded `/api/fs/*` endpoint family — including arbitrary shell execution. These
are release-blocking. The path-traversal guards on the *documented* `/file` endpoints are actually
sound against basic traversal; the danger is the *undocumented* `/api/fs/*` twin that bypasses them.

Default posture that partially mitigates: the server binds `127.0.0.1` unless `HOST` is set
(`db/server.ts:3407`), and CORS is not wide-open. But loopback-only is not a security boundary
against CSRF / DNS-rebinding, and "going commercial / public deploy" is precisely the case that
removes the loopback bind.

---

## Severity counts

| Severity | Count |
|---|---|
| Critical | 4 |
| High | 3 |
| Medium | 4 |
| Low | 3 |

---

## 1. Path traversal across file endpoints

### 1a. CRITICAL — `/api/fs/*` is a fully unguarded arbitrary filesystem + RCE surface
`db/server.ts:3291-3372`. Six endpoints, **no path confinement, no allowlist, no auth**:

- `GET /api/fs/read?path=` (`:3312-3319`) → `readFileSync(filePath)` on the **raw** query param.
  `GET /api/fs/read?path=C:\...\db\.secret.key` (or `/etc/passwd`, `~/.aws/credentials`,
  `~/.claude/.credentials.json`) returns the file body. Arbitrary file read.
- `POST /api/fs/write {path,content}` (`:3322-3331`) → `mkdirSync(dirname(body.path))` +
  `writeFileSync(body.path, ...)` anywhere. Overwrite `~/.bashrc`, a systemd unit, or the app's own
  source. Arbitrary file write → code execution.
- `DELETE /api/fs/delete?path=` (`:3343-3358`) → `rmSync(filePath, {recursive:true,force:true})`
  on any directory. Arbitrary recursive delete.
- `POST /api/fs/run {command}` (`:3360-3372`) → `spawnSync(body.command, {shell:true})`.
  **Direct arbitrary command execution.** This is unauthenticated RCE.
- `PUT /api/fs/rename {oldPath,newPath}` (`:3333-3341`) → `renameSync` anywhere.
- `GET /api/fs/list?dir=` (`:3291-3310`) → recursive directory tree of any path (defaults to cwd).

**Exploit:** any process on the host, any page a victim visits (a `fetch('http://127.0.0.1:6952/api/fs/run', {method:'POST', body:'{"command":"..."}'})` CSRF — CORS does not stop the request from executing, only from being *read* — and DNS-rebinding defeats the loopback bind), or any LAN peer if `HOST=0.0.0.0`, gets full RCE and file read/write on the operator's machine.

**Fix (must, before any release):** delete these routes, or gate them behind (a) the P1.7 bearer
auth, AND (b) the same `join(root, rel)` + `!abs.startsWith(root+sep) && !rel.includes('..')`
confinement the `/file` routes use, AND (c) drop `/api/fs/run` entirely — an unbounded
shell-exec endpoint has no safe form. They appear to be leftover scaffolding; nothing in the
documented API reference uses them.

### 1b. HIGH — `/file` family operates on the host repo for the `default` project
`db/server.ts:1275-1339`, `1344`. For the `default` project `projectRepoPath()` returns
`process.cwd()` (`db/server.ts:174-177`), i.e. the Piranha install repo. `GET /files` guards this
with an `isHost` check (`:1268`), but `GET/PUT/POST/DELETE /file` and `POST /file/ai-edit` do **not**.
So `GET /file?path=db/.secret.key&project=default` passes the traversal guard (path is under cwd,
no `..`) and returns the AES master key; `PUT /file` can rewrite `db/server.ts` itself.

**Exploit:** read the secret key / write the server source via the "confined" file API without ever
tripping the traversal check — the file legitimately *is* inside root.
**Fix:** apply the `isHost`/`root===process.cwd()` refusal (already used at `:1268`) to all `/file`
verbs, and add `db/.secret.key`, `.env`, `*.db` to a denylist regardless of project.

### 1c. MEDIUM — `/file` traversal guard is symlink-unsafe (string check, not `realpath`)
`db/server.ts:1282, 1302, 1318, 1333, 1359, 1422, 1497`. The guard is
`!abs.startsWith(root) || rel.includes('..')`. This is effective against `../` and absolute-path
escapes (because `join(root, rel)` with no `..` cannot leave root). But it is a **string** check: it
does not resolve symlinks. A repo (hostile clone, or a file an agent wrote) containing a symlink
`link -> /etc/passwd` lets `GET /file?path=link` read outside root — `abs` is textually under root,
but `readFileSync` follows the link.

**Exploit:** a malicious repo the operator clones carries a symlink; the File Browser reads/writes
the link target outside the repo. Blast radius is bounded by the sandbox for *agents*, but the HTTP
file API is not sandboxed.
**Fix:** after building `abs`, `realpathSync` it (and for writes, `realpathSync` the parent dir) and
re-check the resolved path is inside `realpathSync(root) + path.sep`. Also make the prefix check
boundary-safe: compare against `root + path.sep`, not bare `root` (guards the `/repo` vs
`/repo-secrets` sibling case, currently unreachable only by accident).

### Endpoints that ARE correctly guarded (verified, no action needed)
- `GET /task-logs/:id/file` — reads `task.logPath` and rejects paths outside the logs root via
  `isInsideLogsRoot` (`db/server.ts:911`), never recomputed from the URL.
- `GET/DELETE /agent-logs/:name` — `safeLogName` regex `^[A-Za-z0-9_.-]+$` + `!includes('..')`
  (`db/server.ts:164-166, 940, 962`).
- `GET /spec/:name` — `^[\w.\-]+\.md$` (no separators) confined to `next_changes/specs`
  (`db/server.ts:776-786`).

---

## 2. CORS allowlist — LOW (defensible; not the control that matters)
`db/server.ts:623-643`. Logic: reflect `Origin` only when the origin host is localhost/127.0.0.1/`[::1]`,
OR equals the request `Host` header host, OR `CORS_ALLOW_ORIGIN='*'`; a specific `CORS_ALLOW_ORIGIN`
is echoed as-is. It does **not** reflect an arbitrary attacker origin, and it never sets
`Access-Control-Allow-Credentials: true` — and the server uses no cookies — so the classic
"reflect + credentials" and "wildcard + credentials" holes are absent. `Vary: Origin` is set.

Residual notes (not exploitable on their own):
- CORS only governs whether a browser may **read** the response. It does **not** prevent a
  cross-site request from **executing** — so `/api/fs/run` (finding 1a) is reachable by CSRF
  regardless of this CORS logic.
- `sameHost` trusts the `Host` header; on a public deploy behind a proxy that forwards arbitrary
  Host values this could reflect an attacker origin. Minor; pair CORS with real auth.

**Fix:** keep the logic, but treat CORS as defence-in-depth only. The real fix for public deploy is
auth (P1.7) + not binding `0.0.0.0` without it.

---

## 3. `/db/table/:table` allowlist — LOW / none (no bypass found)
`db/server.ts:1538-1587`. The table name is captured by `([a-zA-Z_]+)` (`:1538`) and then must pass
`TASKS.includes(table)` / `LOGS.includes(table)` or the handler returns 400 (`:1544-1545`). The
`includes` check is **case-sensitive**, so `Tasks`, `TASKS`, `sqlite_master` etc. are all rejected —
no case/quoting bypass. Column names are interpolated but sourced from `PRAGMA table_info(table)`
and filtered through `colNames`/`safeCols` (`:1550-1552`), never from request keys — so the
`{"a=1; DROP …": 1}` update-key injection is defeated (`:1547-1549` comment documents this). All row
values are bound parameters. Postgres is refused outright (`:1520-1523`). This one is well done.

---

## 4. String-built SQL — LOW / none exploitable
Audited every interpolated query:
- `/db/table` `${table}`/`${col}` — allowlisted / schema-derived (see §3). Safe.
- `keywordSearch` (`db/server.ts:66-80`) — LIKE terms are bound `?` params. Safe.
- `q` free-text search `CAST(${c.name} AS TEXT) LIKE ?` (`:1570`) — `c.name` from schema, value
  bound. Safe.
- `purgeProjectData` `IN (${taskIds.map(()=>'?')})` (`:339`) — placeholder generation, values bound.
  Safe.
- budget/spend reads (`:683-689`) — bound params. Safe.
- `agentic/db/logs.ts` writers/readers — all bound params.

No request input is concatenated into SQL text anywhere I could find. No finding.

---

## 5. Prompt-injection surface — MEDIUM (note; sandbox is the intended mitigation)
Hostile repo content flows unfiltered into model prompts at three sites. Per SPEC this is
note-only (the P0.3 sandbox contains blast radius), but two of the three still spawn with the
**full** `--dangerously-skip-permissions` bypass, which the sandbox work was supposed to retire:

- `ragAnswer` (`db/server.ts:109-140`): top code snippets from the index inlined into the prompt;
  spawned with `CLAUDE_FLAGS` defaulting to `--dangerously-skip-permissions` (`:124`).
- `POST /file/ai-edit` (`db/server.ts:1344`): tagged repo file contents + user uploads inlined
  (`:1379-1381`); spawned with `--dangerously-skip-permissions` hard-coded (`:1397`).
- `POST /intake` (`db/server.ts:1910`): user message inlined; **now** uses
  `sandboxSpawnFlags('architect','standard')` → `--permission-mode acceptEdits` (`:1929`), i.e. the
  SPEC §5 note "‑/intake still shells out with --dangerously-skip-permissions" is **already fixed**.
  Caveat: intake spawns in the server cwd with no `.claude/settings.json` written, so the
  `BASE_DENY` list (curl/.env/*.db) is not enforced for that run — only the permission-mode +
  `--disallowedTools` flags apply.

**Fix:** route `ragAnswer` and `/file/ai-edit` through `sandboxSpawnFlags` too (not the raw skip
flag), and write a transient `.claude/settings.json` (via `writeWorktreeSettings`) for the cwd of
every one-shot spawn so `BASE_DENY` actually applies. Prompt-content filtering remains future work.

---

## 6. Secret exposure

### 6a. CRITICAL (in combination) — master key readable over HTTP
`agentic/db/secretbox.ts:23-57` writes the AES-256-GCM master key to `db/.secret.key` (chmod 600,
gitignored, env-overridable) — a reasonable at-rest design **on its own**. But findings 1a and 1b
make that file remotely readable: `GET /api/fs/read?path=db/.secret.key` and
`GET /file?path=db/.secret.key&project=default` both return it. Reading the key defeats the
encryption of every stored git token / GitHub App private key / Postgres credential.
**Fix:** close 1a and 1b; additionally the sandbox already denies `Read(**/.secret.key)` for agents
(`agentic/engine/sandbox.ts:96`) — extend an equivalent denylist to the HTTP file routes.

### 6b. MEDIUM — `agent_logs` are stored with no redaction
`agentic/db/logs.ts:40-49`. `addAgentLog` inserts `message` verbatim. `redactSecrets`
(`agentic/redact.ts`) is applied only at specific call sites — git push/pull/ls-remote output
(`db/server.ts:2393, 2416, 2435`) and `failureDetail` — not at the storage layer. Any log line that
happens to carry a token (command output echoing an env var, an agent pasting a credential) is
persisted in plaintext and served by `GET /task-logs/:id`. This is exactly the SPEC §5 open item
"redact secrets in agent_logs generally". **Fix:** run `redactSecrets` inside `addAgentLog` so
redaction is centralized and unmissable.

### 6c. LOW — `redactSecrets` is keyword-anchored
`agentic/redact.ts:6-12` catches `user:pass@` URLs and `Bearer|token|password|secret|api_key`
followed by a value. It will **not** catch a bare token with no preceding keyword (e.g. a raw
`ghp_…`/`github_pat_…`/`sk-…` string in arbitrary output). **Fix:** add provider token-shape
patterns (`gh[pousr]_[A-Za-z0-9]{36,}`, `github_pat_\w+`, `sk-[A-Za-z0-9]{20,}`, `xox[baprs]-…`).

### 6d. LOW — git clone token handling is correct (verified, no action)
`db/server.ts:2137, 2154-2157, 2263` strip the token and its URL-encoded form from clone output and
progress; `:2165, 2266` reset the stored `origin` remote so the credential never lands in
`.git/config`. Well handled.

---

## Prioritised remediation

### MUST fix before charging customers (release-blocking)
1. **Remove / lock down `/api/fs/*`** (`db/server.ts:3291-3372`) — arbitrary read/write/delete and
   `spawnSync` RCE, unauthenticated. Delete `/api/fs/run` outright; gate the rest behind auth +
   path confinement, or remove them entirely. (Finding 1a — CRITICAL)
2. **Land the db-server auth** (SPEC P1.7 bearer token in the middleware chain). Every finding here
   compounds because *nothing* is authenticated. This is the single highest-leverage fix.
3. **Fix `/file` on the `default` project** — apply the `isHost` refusal to all `/file` verbs and a
   `db/.secret.key`/`.env`/`*.db` denylist (`db/server.ts:1275-1339`). (Finding 1b — HIGH)
4. **Do not bind `0.0.0.0` without auth**; keep the loopback default and document that public deploy
   requires P1.7 + TLS first (SPEC Release 2 Phase 3 already says this — enforce it in code with a
   refuse-to-start check when `HOST!=127.0.0.1` and no auth token is configured).

### SHOULD fix soon after (hardening)
5. Symlink-safe path confinement (`realpath` re-check + `root+sep` boundary) on all `/file`/`/context`
   routes. (Finding 1c — MEDIUM)
6. Route `ragAnswer` and `/file/ai-edit` through `sandboxSpawnFlags` instead of the raw
   `--dangerously-skip-permissions`, and write a transient `.claude/settings.json` for cwd spawns so
   `BASE_DENY` applies. (Finding 5 — MEDIUM)
7. Centralize secret redaction inside `addAgentLog`. (Finding 6b — MEDIUM)

### LATER (defence-in-depth / already acceptable)
8. Broaden `redactSecrets` with token-shape patterns. (6c)
9. Treat CORS as defence-in-depth; revisit `sameHost`/`Host`-header trust once behind a proxy. (§2)
10. TLS termination (SPEC §5 / Release 2 Phase 3) — tokens cross the wire in plaintext today.

### Verified clean (no action)
- `/db/table` allowlist — no case/quoting/injection bypass (§3).
- String-built SQL — all interpolation is allowlisted or schema-derived; values are bound (§4).
- git clone token redaction (6d); `/task-logs/:id/file`, `/agent-logs/:name`, `/spec/:name`
  traversal guards (§1).
