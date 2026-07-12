# Sandbox verification — does P0.3 constrain the LIVE agent path? (2026-07)

Investigation of SPEC Release 1 · P0.3 ("replace blanket `--dangerously-skip-permissions`
with a per-role sandbox"). Question: does the sandbox actually bite on the path that real
agents execute on?

**Verdict up front: NO. On the live path the P0.3 sandbox is entirely inert.** The runner
executes agents through a hand-rolled `@anthropic-ai/sdk` tool loop, not `claude -p`. Every
artifact P0.3 produces — `writeWorktreeSettings`, `buildSandboxSettings`' allow/deny lists,
`sandboxSpawnFlags` — governs the Claude Code CLI and is never consulted by the SDK loop.
A live agent (any role) can run arbitrary shell, exfiltrate over the network, and read/write
outside its worktree. The sandbox is real only for a dormant/utility CLI path.

---

## 1. The live agent execution path

`spawnHeadlessAgent` in `agentic/engine/runner.ts` is the sole entry point the orchestrator
calls to run an agent (`agentic/engine/orchestrator.ts:782`, `:836`, `:1108`). Despite the
file's header comment still claiming it "Spawns `claude -p` as a child process per task"
(`runner.ts:2-3`), the actual implementation does not:

- `runner.ts:311` — constructs `new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })`.
- `runner.ts:351-453` — a hand-written agentic loop that calls
  `anthropic.messages.create(...)` (`:360`) directly against the Messages API and dispatches
  tool calls itself.
- `runner.ts:327-349` — the tool set is defined inline in code: `Bash`, `Edit`, `Write`,
  `Read`.
- `runner.ts:398-419` — the tool executor: `Bash` → `execSync` (`:401`), `Read` →
  `readFileSync` (`:403`), `Write` → `writeFileSync` (`:405`), `Edit` → read/replace/write
  (`:408-410`).

There is **no `spawn(claude …)` anywhere in this path.** The CLI machinery in the same file
is dead code left from the previous design:

- `spawn` is imported (`runner.ts:11`) but never called in the file.
- `CLAUDE_BIN` (`runner.ts:21`) is never referenced after definition.
- `claudeFlags(...)` (`runner.ts:30-35`) — including its `role === 'plan'` →
  `--disallowedTools Edit,Write` clause — is defined but never called (grep: only the
  definition site references it).

**Which is real: the SDK tool loop.** The spawned-`claude` path is real only in unrelated
one-shot utility calls in `db/server.ts` — chat intake decomposition
(`db/server.ts:1929`, a text-only JSON call that passes `sandboxSpawnFlags('architect',
'standard')`), project-type detection (`db/server.ts:243`), and similar. None of these run a
task's agent; they are stateless helpers that emit JSON. The agent worker loop is 100% the
SDK path.

## 2. Do `writeWorktreeSettings` / `sandboxSpawnFlags` affect the SDK loop? No.

`runner.ts:293` calls `writeWorktreeSettings(cwd, opts.role, opts.permissionProfile)`, which
writes `<worktree>/.claude/settings.json` with the `{ permissions: { allow, deny } }` block
(`sandbox.ts:174-185`). **Nothing reads that file on the live path.** `.claude/settings.json`
is a Claude Code CLI configuration file; the Anthropic Messages API
(`anthropic.messages.create`) has no knowledge of it. The write succeeds and the file sits
on disk unused.

`sandboxSpawnFlags` (`sandbox.ts:159-165`) produces CLI flags (`--permission-mode`,
`--disallowedTools`). The SDK loop passes no such flags anywhere — it is not a CLI. Its only
consumer is the dormant `claude -p` intake call (`db/server.ts:1929`).

**What actually constrains a live agent (the full list):**

- **Turn cap** — `MAX_TURNS_PER_RUN = 80` (`runner.ts:41`, enforced at the `while` on
  `:355`). A looping agent stops after 80 API turns.
- **Wall-clock timeout** — `AGENT_TIMEOUT_MS` (default 30 min, `runner.ts:36`) aborts the run
  via `AbortController` (`:322`).
- **Per-command timeout** — each `Bash` `execSync` is capped at 30 s (`runner.ts:401`).
- **Tool surface** — only `Bash`/`Edit`/`Write`/`Read` are offered; no `WebFetch`/`WebSearch`
  tool is defined. (Irrelevant to network: `Bash` can `curl`.)
- **cwd** — tools run with `cwd` set to the worktree (`:401`, and `join(cwd, path)` for
  file tools). This is a *default directory*, not a *boundary* (see §3).

That is the entire enforcement envelope. File writes, bash execution, and network access are
**otherwise unconstrained**.

### File writes
`Write`/`Edit` do `writeFileSync(join(cwd, input.path), …)` (`runner.ts:405`, `:408-410`).
`join(cwd, '../../anything')` or an absolute path escapes the worktree. No boundary check, no
deny for `.env`/secrets. The P0.3 `Edit(./**)` / `Write(./**)` worktree-scoping and the
`Read(.env)` / `Read(**/*.db)` denies (`sandbox.ts:91-100`, `:132`) never run.

### Bash exec
`execSync(input.command, { cwd, … })` (`runner.ts:401`) runs the raw command string with no
allow/deny consultation. The P0.3 `BASE_DENY` (`sandbox.ts:91-100`) — `curl`, `wget`,
`git push` — and the strict-level `Bash(git:*)` deny are never checked. `git push`, `curl`,
`rm -rf ~`, all run.

### Network access
No network restriction exists. `Bash` `curl`/`wget` is the open channel; the deny list that
would close it is inert. (The absence of a `WebFetch` tool is cosmetic — bash replaces it.)

## 3. Does the SDK loop enforce per-role write/deny intent? Effectively no — and the one
guard it has is broken.

The only role-based gate in the loop is `runner.ts:328`:

```ts
if (opts.role !== 'plan') { tools.push(Bash, Edit, Write); }
tools.push(Read);
```

This compares the **role** against the string `'plan'`. **No agent role is ever named
`'plan'.'** The real roles are `owner`, `architect`, `dev`, `qa`, `security-engineer`, … 
(`agentic/db/defaults.ts:33-695`). `'plan'` is a *workflow stage id* (`agentic/workflow/
defaultWorkflow.ts:35`) and a *`WorktreeMode`*, whose role is `architect`. The orchestrator
passes the role name, e.g. `role: 'architect'` for triage (`orchestrator.ts:783`) and
`role: role as AgentRole` from `stage.agentRef ?? ac.role` for dispatch (`orchestrator.ts:806`,
`:837`). So the guard's condition is **always true**: every live agent — including the
read-only roles that `sandbox.ts` explicitly classifies (`isReadOnlyRole`: `owner`,
`architect`, `security-engineer`, `ui-ux-designer`, …, `sandbox.ts:55-64`) — is handed
`Bash`, `Edit`, and `Write`.

Concretely: the architect triage run (`orchestrator.ts:782-788`) executes with
`worktree: 'none'`, so `resolveCwd` returns the **repo root / host cwd**
(`runner.ts:125`), and the architect gets full `Bash`/`Edit`/`Write` **in the main checkout**,
not an isolated worktree. A "read-only" reviewer can write product code and run any shell
command.

**This is a critical finding:** on the live path an agent of any role can write outside its
worktree and run arbitrary bash, and the sole per-role restriction (`!== 'plan'`) never fires.

## 4. Conclusion & the change that closes the gap

**SPEC P0.3 is satisfied only for a dormant CLI path.** `buildSandboxSettings` and its tests
(`agentic/__tests__/sandbox.test.ts`) are correct and pass — but they validate a policy object
that governs `claude -p`. On the live SDK path that object is never consulted. The live agent
runs closer to the pre-P0.3 `--dangerously-skip-permissions` posture than to a sandbox: the
only real limits are turn count, wall-clock, per-command timeout, and tool surface.

### The one change that makes the sandbox bite (design only)

**Move enforcement out of `.claude/settings.json` and into the runner's own tool executor**,
because on the live path the runner *is* the permission engine. In `runner.ts::spawnHeadlessAgent`:

1. **Derive the profile in-process.** Call
   `buildSandboxSettings(opts.role, opts.permissionProfile || 'standard')` (already exported,
   `sandbox.ts:117`) once at spawn and keep its `allow`/`deny` lists.

2. **Gate the tool surface by role correctly.** Replace `opts.role !== 'plan'`
   (`runner.ts:328`) with `!isReadOnlyRole(opts.role)` (and also honor `disallowedTools`), so
   read-only roles genuinely get only `Read`.

3. **Enforce allow/deny inside the tool switch, before side effects** (`runner.ts:398-419`):
   - *Bash*: parse the command into subcommands (split on `&&`, `||`, `;`, `|`) and reject the
     call (return a `tool_result` with `is_error: true`) if any subcommand matches a `deny`
     rule (`curl`, `wget`, `git push`, strict's `git:*`) or, for `strict`, is not in `allow`.
     This needs a small Claude-Code-glob matcher (`Bash(prefix:*)` → prefix match); it belongs
     next to `buildSandboxSettings` so policy stays in one place.
   - *Read/Write/Edit*: resolve `path.resolve(cwd, input.path)` and reject if it does not stay
     within `cwd` (`resolved === cwd || resolved.startsWith(cwd + sep)`), closing the `../` and
     absolute-path escape. Additionally apply the `Read(.env)` / `Read(**/*.db)` /
     `Write`/`Edit` denies.
   - Deny → return an error `tool_result` so the model sees the refusal and continues, matching
     Claude Code's "denied tool" semantics.

The single highest-value edit, if only one is made: **add the allow/deny + worktree-boundary
check to the tool executor in `runner.ts` (step 3).** Without it, every other P0.3 artifact is
decoration. (Fixing only the `!== 'plan'` role gate in step 2 is necessary but not sufficient —
it re-reads-only the read-only roles while still leaving `dev`/`qa` with unbounded bash and
network.)

Secondary cleanup (not security-load-bearing): delete the dead `spawn`/`CLAUDE_BIN`/
`claudeFlags` remnants and correct the file header (`runner.ts:2-3`) so the next reader is not
misled into believing a CLI sandbox is in force.

---

### Evidence index
- Live loop / SDK client: `agentic/engine/runner.ts:311`, `:351-453`, `:360`
- Inline tool defs: `agentic/engine/runner.ts:327-349`
- Unchecked tool executor: `agentic/engine/runner.ts:398-419` (Bash `:401`, Read `:403`,
  Write `:405`, Edit `:408-410`)
- Broken role gate: `agentic/engine/runner.ts:328`
- Inert settings write: `agentic/engine/runner.ts:293`, `agentic/engine/sandbox.ts:174-185`
- Inert flags: `agentic/engine/sandbox.ts:159-165`
- Policy (correct but unused on live path): `agentic/engine/sandbox.ts:91-153`
- Dead CLI remnants: `agentic/engine/runner.ts:11`, `:21`, `:30-35`
- No role named 'plan': `agentic/db/defaults.ts:33-695`; stage id 'plan' →
  `agentic/workflow/defaultWorkflow.ts:35`
- Orchestrator spawn sites / roles passed: `agentic/engine/orchestrator.ts:782-788`, `:806`,
  `:836-837`, `:1108`
- Real CLI path (separate, utility): `db/server.ts:1929` (intake), `:243` (detect)
