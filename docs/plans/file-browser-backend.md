# Backend spec — File Browser write + AI-edit endpoints

**For:** the backend agent.
**Where:** all handlers go in `db/server.ts`, appended alongside the existing `/file` routes (around line 1170–1186, right after the `GET /file?` handler). Match the surrounding style exactly — raw Node `http` request handler, `if (req.method === ... && req.url?.startsWith(...))` blocks, `res.end(JSON.stringify(...))`.

**Do not modify** any existing handler. These are four **new** blocks only.

---

## Context: what already exists (do not change)

The Context tab's file browser already reads the repo through two routes. The new frontend `FileBrowser` component reuses them verbatim:

```ts
// GET /files  → the project's git-tracked file list
//   { root: string, files: string[], isHost: boolean }
//   'isHost' true means the 'default' project == the orchestrator's own repo; files is [].

// GET /file?path=<repo-relative>  → one file's content + token estimate
//   { path, bytes, tokens, truncated, content }   (truncated=true when bytes > 512KB, content='')
```

Both are project-scoped by `?project=<id>` via `projectIdOf(req)` and rooted at `await projectRepoPath(projectIdOf(req))`.

**The path-traversal guard is mandatory and identical on every new route** — copy it exactly from `GET /file?`:

```ts
const abs = join(root, rel);
if (!abs.startsWith(root) || rel.includes('..')) {
  res.statusCode = 400; res.end(JSON.stringify({ error: 'path escapes repo' })); return;
}
```

Helpers available in scope: `readBody(req)` (returns the raw body string), `projectIdOf(req)`, `projectRepoPath(pid)`, `join` (node:path), `readFileSync/writeFileSync/statSync/existsSync/mkdirSync/unlinkSync` (node:fs), `spawnSync` (node:child_process — used already by `/intake`).

---

## 1. `PUT /file` — save (overwrite) an existing file

Body: `{ path: string, content: string }`

```ts
if (req.method === 'PUT' && req.url?.startsWith('/file')) {
  try {
    const body = JSON.parse(await readBody(req));
    const rel = String(body.path || '');
    const root = await projectRepoPath(projectIdOf(req));
    const abs = join(root, rel);
    if (!abs.startsWith(root) || rel.includes('..')) { res.statusCode = 400; res.end(JSON.stringify({ error: 'path escapes repo' })); return; }
    if (!existsSync(abs)) { res.statusCode = 404; res.end(JSON.stringify({ error: 'file does not exist — use POST to create' })); return; }
    writeFileSync(abs, String(body.content ?? ''), 'utf-8');
    const bytes = statSync(abs).size;
    res.end(JSON.stringify({ ok: true, path: rel, bytes }));
  } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
  return;
}
```

Route ordering note: `PUT /file` must be matched **before** any generic PUT fallthrough, and after the `GET /file?` block. Because it keys on `req.method === 'PUT'` it won't collide with the existing GET routes.

## 2. `POST /file` — create a new file (and parent dirs)

Body: `{ path: string, content?: string }`

Refuse if the file already exists (that's a save, not a create). Create missing parent directories.

```ts
if (req.method === 'POST' && (req.url || '').split('?')[0] === '/file') {
  try {
    const body = JSON.parse(await readBody(req));
    const rel = String(body.path || '');
    const root = await projectRepoPath(projectIdOf(req));
    const abs = join(root, rel);
    if (!abs.startsWith(root) || rel.includes('..')) { res.statusCode = 400; res.end(JSON.stringify({ error: 'path escapes repo' })); return; }
    if (!rel.trim()) { res.statusCode = 400; res.end(JSON.stringify({ error: 'path is required' })); return; }
    if (existsSync(abs)) { res.statusCode = 409; res.end(JSON.stringify({ error: 'file already exists' })); return; }
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, String(body.content ?? ''), 'utf-8');
    res.end(JSON.stringify({ ok: true, path: rel }));
  } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
  return;
}
```

(`dirname` from node:path — add to the existing path import if not already there.)

## 3. `DELETE /file?path=<repo-relative>` — delete a file

```ts
if (req.method === 'DELETE' && req.url?.startsWith('/file')) {
  try {
    const u = new URL(req.url, 'http://x');
    const rel = u.searchParams.get('path') || '';
    const root = await projectRepoPath(projectIdOf(req));
    const abs = join(root, rel);
    if (!abs.startsWith(root) || rel.includes('..')) { res.statusCode = 400; res.end(JSON.stringify({ error: 'path escapes repo' })); return; }
    if (!existsSync(abs)) { res.statusCode = 404; res.end(JSON.stringify({ error: 'file not found' })); return; }
    unlinkSync(abs);
    res.end(JSON.stringify({ ok: true, path: rel }));
  } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
  return;
}
```

## 4. `POST /file/ai-edit` — propose a change with the model (does NOT write)

This is the chat's engine. It reads the tagged files, sends them + any uploaded reference files + the user's instruction to `claude -p` (same CLI/auth the agents and `/intake` use — **no API key**), and returns a proposed new version of each file **plus a unified diff**. It writes nothing; the frontend shows the diff, the human approves, and the frontend then calls `PUT /file` to commit each accepted proposal.

Body:
```ts
{
  instruction: string,                          // "change the port to 4000"
  files: Array<{ path: string }>,               // tagged repo files (dragged/picked into the chat)
  uploads?: Array<{ name: string, content: string }>,  // external reference files — READ-ONLY, never a write target
  sessionId?: string,                           // per-thread continuity token (see below); absent on the first message
  model?: 'haiku' | 'sonnet' | 'opus',          // from the chat's settings panel
  effort?: 'low' | 'medium' | 'high',           // reasoning effort, from the settings panel — map to the CLI's thinking/effort flag
  project?: string
}
```

Response:
```ts
{
  answer: string,                         // the model's prose explanation (shown in the chat bubble)
  sessionId: string,                      // echo/issue the thread's continuity token — the frontend stores it and sends it back next turn
  proposals: Array<{
    path: string,
    oldContent: string,
    newContent: string,
    diff: string                          // unified diff (git-style), for <DiffView>
  }>
}
```

### Per-thread context (IMPORTANT — the UI has many independent chats)

The UI runs **multiple chat threads, each with its own isolated context**. The `sessionId` is how the backend keeps them separate and gives each thread conversational memory:

- First message of a thread: `sessionId` is absent. Start a new model session, and **return a fresh `sessionId`** the frontend will persist on that thread.
- Later messages: the frontend sends the thread's `sessionId` back. **Resume that exact session** so the model remembers the earlier turns of *this* thread and no other.
- Recommended mechanism: `claude -p`'s session flags — issue the id with `--session-id <uuid>` on the first turn and resume with `--resume <uuid>` after (verify the exact flags for the installed CLI). If session resume isn't viable, fall back to the frontend replaying prior turns — but keep the request/response shape above so the UI doesn't change.

Threads must never share context: two different `sessionId`s = two isolated conversations.

### Implementation sketch (mirror `/intake`)

1. Guard + read each tagged file's current content (`readFileSync`, same traversal guard per path). Skip files that don't exist or exceed 512KB (report them in `answer`).
2. Build a prompt: the instruction; each tagged repo file as `=== path ===\n<content>`; then any `uploads` as `=== upload: name (reference only) ===\n<content>`. State that uploads are **reference context, not edit targets**. Ask the model to return **only** minified JSON:
   `{"answer":"...","files":[{"path":"...","content":"<full new file content>"}]}` — full content per changed *repo* file, no fences, no prose outside JSON. Omit unchanged files.
3. `spawnSync(CLAUDE_BIN, ['-p', prompt, '--dangerously-skip-permissions', ...sessionFlags], { encoding:'utf8', timeout: 150000, maxBuffer: 16*1024*1024 })`. Parse the first `{`…last `}` like `/intake` does.
4. For each returned file, build the unified diff (`oldContent` = current on disk, `newContent` = model output). Use git for a real diff: `spawnSync('git', ['diff', '--no-index', '--', <tmpOld>, <tmpNew>])`, OR a small JS unified-diff (the `diff` npm package if already a dep — check `package.json`; otherwise git `--no-index`). `<DiffView>` renders standard `@@` unified hunks.
5. Return `{ answer, sessionId, proposals }`. On unparseable model output, `502` with `{ error, raw: out.slice(0,600) }` (same as `/intake`).

**Security:** every path in `files[]` goes through the traversal guard. Uploads are never written. The model never writes — only proposes. The write happens through `PUT /file` (route 1), which re-guards.

**CLAUDE_BIN:** `const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';` (as in `/intake`).

---

## Frontend contract (already built against this — don't break the shapes)

The `FileBrowser` component (`src/pages/tasks/components/FileBrowser.tsx`) calls, all with `?project=<id>` appended via `withProject(...)`:

| Action | Request | Success |
|---|---|---|
| list tree | `GET /files` | `{ files: string[], isHost }` *(exists)* |
| open file | `GET /file?path=` | `{ path, content, bytes, tokens, truncated }` *(exists)* |
| save | `PUT /file` `{path,content}` | `{ ok:true, bytes }` |
| create | `POST /file` `{path,content}` | `{ ok:true }` (409 if exists) |
| delete | `DELETE /file?path=` | `{ ok:true }` |
| AI edit | `POST /file/ai-edit` `{instruction,files:[{path}],uploads:[{name,content}],sessionId,model,effort}` | `{ answer, sessionId, proposals:[{path,oldContent,newContent,diff}] }` |

Frontend components (for the backend agent to read): `src/pages/tasks/components/FileBrowser.tsx` (tree + editor + CRUD) and `src/pages/tasks/components/FileChat.tsx` (the multi-thread AI chat — this is what calls `/file/ai-edit` and persists one `sessionId` per thread).

Errors: any non-2xx returns `{ error: string }`; the frontend surfaces `error` in a toast. Keep that shape.
