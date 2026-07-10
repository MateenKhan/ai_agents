# Plan: "Changes" panel in the review gate (show the code diff)

## Why this exists

The review gate today assumes a task has a **visual preview** — it tells the human to "build a
preview, then approve." That is correct for a UI change. It is useless for a backend or library
task like "add a `slugify()` utility": there is nothing to look at, so the preview panel is empty
and the human has no way to verify the work.

For a non-visual task, what you verify is **the diff and the test evidence**, not a screenshot.
The backend for this is already built and live (see the contract below). This plan is the UI that
consumes it: a **Changes** section in the task's review/detail view that shows exactly what the
agent changed on its branch.

**Scope of this task: UI only.** The endpoint is done, verified live against a real task branch.
Do not touch `agentic/**` or `db/**`. Work in `src/**`.

---

## The backend contract (already built — build the UI against this)

### `GET /tasks/:id/changes?project=<projectId>`

Returns the diff of the task's branch (`task/<id>`) against the project's base branch.

Fetch it with the app's existing helpers:

```ts
import { API_BASE, getActiveProject } from '../../../apiBase'; // adjust relative path
const r = await fetch(`${API_BASE}/tasks/${encodeURIComponent(taskId)}/changes?project=${encodeURIComponent(getActiveProject())}`);
const data = await r.json();
```

### Response shape

```jsonc
{
  "ok": true,
  "exists": true,                 // false when the task has no branch yet (nothing built)
  "base": "vps-dev",              // the branch the work is diffed against (may vary per project)
  "branch": "task/WF-SLUG-1783720669",
  "commits": [
    { "sha": "823bf16", "subject": "Add slugify(text) utility with unit tests" }
  ],
  "files": [
    { "path": "src/utils/index.ts",       "status": "M", "additions": 2,  "deletions": 0 },
    { "path": "src/utils/slugify.ts",      "status": "A", "additions": 7,  "deletions": 0 },
    { "path": "src/utils/slugify.test.ts", "status": "A", "additions": 42, "deletions": 0 }
  ],
  "diff": "diff --git a/src/utils/index.ts b/src/utils/index.ts\n…",  // full unified diff, as text
  "truncated": false,             // true when the diff exceeded 200 KB and was cut
  "qaVerdict": "pass",            // "pass" | "fail" | null — QA's verdict on this work
  "summary": "Accepted. Commit 823bf16 adds pure slugify…"           // the dev's own summary, may be null
}
```

- `status` is git's letter: `A` added, `M` modified, `D` deleted, `R` renamed.
- `additions`/`deletions` are numbers, or `null` for a binary file.
- When `exists` is `false`, everything else is empty/null — render an empty state, not an error.

---

## What to build

Add a **Changes** section to the task review/detail view (`src/pages/tasks/components/TaskDetail.tsx`
is where the task detail lives; put it alongside the existing Pipeline / Summary sections, and it is
also natural in the preview area of the review gate). It renders the branch diff so a human can
approve a non-visual task on the real artifact.

### Layout

1. **Header row** — "Changes" title, the branch name (`branch`) and base (`base`) in mono, and the
   QA verdict as a small badge (green "QA passed" for `pass`, rose "QA failed" for `fail`, muted
   "not verified" for `null`). A Refresh button that re-fetches.

2. **Commit line(s)** — the `commits` list, each `sha` (mono) + `subject`. Usually one.

3. **File list** — one row per `files[]` entry:
   - a status chip (`A` green, `M` amber, `D` rose, `R` sky), the `path` (mono), and `+additions` in
     green / `-deletions` in rose.
   - clicking a file scrolls to / expands that file's hunk in the diff below (nice-to-have).

4. **Diff viewer** — render the `diff` text as a unified diff:
   - lines starting `+` green background, `-` rose background, `@@` hunk headers muted/bold, file
     headers (`diff --git`, `+++`, `---`) as section separators.
   - monospace, in a container with its **own** `overflow-x: auto` (never let it scroll the page
     body sideways — this is a hard rule in the codebase).
   - if `truncated` is true, show a muted note at the end: "diff truncated — open the branch to see
     the rest."

### States

- **Loading** — a spinner / skeleton while the fetch is in flight.
- **`exists: false`** — an empty state: "No branch yet — nothing has been built for this task."
  (Not an error.)
- **Merged/done** — still works; it shows what was merged. (Optional: if the task status is DONE,
  a subtle "merged" note.)
- **Error** (`!r.ok` / network) — a small inline error with a Retry.

### Where it should appear

- In the **task detail** view for any task that has a branch (`TaskDetail.tsx`).
- Most importantly, in the **review gate** — a task parked at the human-review stage
  (`status === 'TESTING'`) is what the human approves. The Changes panel is the primary way to
  review a non-visual task there, sitting next to (or replacing, when there's nothing to preview)
  the existing preview area.

---

## Theme / rules (match the existing app)

- Use the shared UI tokens in `src/pages/tasks/ui.ts` and the `.btn-*` / chip classes already in
  the app. Do not invent new colors — reuse emerald (added/pass), rose (deleted/fail), amber
  (modified), sky (renamed), slate (neutral), matching the danger/status hierarchy in `src/index.css`.
- The diff container owns its horizontal scroll; the page body must never scroll sideways (mobile
  safety net in `index.css`).
- Respect `prefers-reduced-motion` for any expand/collapse animation.
- Keyboard-reachable: the Refresh button and any file rows are focusable.

---

## Acceptance criteria (write these as tests)

Prefer Playwright (the repo now has `@playwright/test` + `e2e/`) or a component test with the fetch
mocked. Make them fail if the feature is absent.

1. Given a task whose `/changes` returns three files and a diff, the panel lists the three files
   with their status and +/- counts, and renders the diff text with added lines styled distinctly
   from removed lines.
2. Given `qaVerdict: "pass"`, a green "QA passed" badge shows; given `"fail"`, a rose one; given
   `null`, a muted "not verified".
3. Given `exists: false`, the empty state shows ("nothing built yet"), not an error and not an
   empty diff box.
4. Given `truncated: true`, the truncation note is shown.
5. The diff container scrolls horizontally on a long line without the page body scrolling sideways.
6. A network/`!ok` response shows an inline error with a Retry that re-fetches.

---

## Verify before finishing

- `pnpm run typecheck` — must pass (covers `src`).
- `pnpm test` — must pass.
- `pnpm exec playwright test` — if you add e2e tests, they must pass (the config reuses a running
  dev server on 6951).
- Manually: open a task that has a branch (e.g. one parked in review) and confirm the diff renders.
  The db-server must be running (`pnpm run agents`) for the endpoint to answer.

Do not commit — leave changes for review, per the repo's workflow.
