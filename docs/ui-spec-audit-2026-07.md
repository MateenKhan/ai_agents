# Piranha UI/UX Spec Audit — 2026-07

Read-only element-level audit of every route, prepared for commercial sale. No product code was
modified. Every `file:line` below was verified against the code at audit time.

## Scope & method

Audited by reading the router (`src/main.tsx`) and each page component to the JSX/element level.
Routes registered in `src/main.tsx:35-49`:

| Route | Component | In primary scope |
| --- | --- | --- |
| `/` → `/tasks` | redirect | n/a |
| `/tasks`, `/tasks/:tab` | `TasksPage` (Board/Context/Analytics/Events/Logs/Database/Agents tabs) | yes |
| `/canvas` | `CanvasPage` | yes |
| `/designer` | `VisualDesignerPage` | yes |
| `/ide` | `IDEPage` | yes |
| `/setup` (gated, not a URL) | `StartScreen` | yes |
| `/workflow` | `WorkflowPage` | secondary (orphan preview) |
| `/features` | `FeaturesPage` (lazy landing) | secondary |
| `*` → `/tasks` | redirect | n/a |

**Routes audited: 5 primary (`/tasks` incl. 7 tabs, `/canvas`, `/designer`, `/ide`, StartScreen)
+ 2 secondary (`/workflow`, `/features`).**

Severity legend: **crit** = blocks/embarrasses a sale demo; **high** = clearly wrong, user hits it;
**med** = inconsistency/dead control; **low** = polish.

---

## BUG 1 (CONFIRMED) — Duplicate navigation

`StudioNavbar` (`src/components/navigation/StudioNavbar.tsx`) was added as the universal top bar
(brand + active-project badge + four studio tabs Swarm Board `/tasks`, Architecture Canvas
`/canvas`, Visual React Studio `/designer`, Code IDE `/ide` + health dot). The old scattered nav
was never removed, so several legacy entry points now duplicate StudioNavbar tabs, and the brand
mark renders twice on two routes.

### Every legacy nav entry point that StudioNavbar now duplicates

| # | Legacy control | file:line | Duplicates | Exact removal |
| --- | --- | --- | --- | --- |
| 1 | **"Architecture Canvas"** button → `navigate('/canvas')` | `src/pages/TasksPage.tsx:377-382` | StudioNavbar "Architecture Canvas" tab (`StudioNavbar.tsx:27`) | Delete the `<button>` at lines 377-382. The surrounding `tabStrip` flex row (`:376`) then needs its leading `<button>` gone; the `tabStripRef` div (`:383`) becomes the first child. |
| 2 | **"Studio"** link → `/designer` | `src/pages/tasks/components/ProjectBar.tsx:405-415` | StudioNavbar "Visual React Studio" tab (`StudioNavbar.tsx:28`) | Delete the `<Tooltip>`+`<Link>` block (405-415). On `/designer` this link is worse than redundant: it points at the page you are already on. |
| 3 | **Piranha brand block** (teeth SVG + "Piranha / Watch the swarm.") | `src/pages/tasks/components/ProjectBar.tsx:358-383` | StudioNavbar brand (`StudioNavbar.tsx:90-109`) | The brand appears **twice** on `/tasks` and `/designer` (StudioNavbar row, then ProjectBar row). Intended: StudioNavbar owns the brand; ProjectBar drops its brand `<Link>` and starts at the Projects accordion (`:385`). If the "click brand → /features" affordance must survive, move it onto the StudioNavbar brand instead. |
| 4 | **"Back to Tasks Board"** link + duplicate **"Architecture Canvas"** title | `src/pages/canvas/CanvasPage.tsx:228-235` (link 229-234, title 235) | StudioNavbar "Swarm Board" tab + the already-lit "Architecture Canvas" tab | The back-link duplicates the Swarm Board tab; the centered title duplicates the active tab label. Keep the row only for the action buttons (Sync/Generate/Build); drop the link (229-234) and the title `<div>` (235), or collapse the whole bar into the actions cluster. |
| 5 | **ProjectBar rendered a second time under StudioNavbar on `/designer`** | `src/pages/designer/VisualDesignerPage.tsx:256-257` | Whole ProjectBar (brand #3, Studio button #2, onboarding banner) stacks under StudioNavbar | `/designer` shows THREE header rows: StudioNavbar (`:256`), ProjectBar (`:257`), then the page header (`:260-344`). Since fixes #2/#3 gut ProjectBar's brand and Studio button, decide whether `/designer` needs ProjectBar at all — it only uses it for project switching. If kept, it must be the slimmed version; if not, remove line 257. |

### The stacked-header problem and the intended single consolidated header

On `/tasks` today the header is, top to bottom:
1. `StudioNavbar` (`TasksPage.tsx:517`) — brand, project badge, 4 studio tabs, health dot.
2. `ProjectBar` (`TasksPage.tsx:548`) — **a second Piranha brand + "Watch the swarm."**, the
   Projects accordion, a **"Studio"** button (→/designer), a Git button, the onboarding banner,
   and the task-tab strip (which itself carries the **"Architecture Canvas"** button).

So the user sees the brand twice and two different paths each to `/canvas` and `/designer`.

**Intended single consolidated header:**
- **Row 1 — `StudioNavbar` (universal):** brand + active-project badge + the four studio tabs +
  health dot. This is the ONLY place the brand and cross-studio navigation live.
- **Row 2 — page toolbar (per studio):** on `/tasks`, ProjectBar reduced to *Projects accordion +
  Git + the task-tab strip*; no brand, no Studio button, no Architecture Canvas button. On
  `/canvas`, the action buttons only (Sync/Generate/Build). On `/designer`, the view-mode + AI +
  Reset controls only.

Net removals for "one nav": TasksPage.tsx:377-382; ProjectBar.tsx:405-415; ProjectBar.tsx:358-383
(brand); CanvasPage.tsx:229-235; reconsider VisualDesignerPage.tsx:257.

---

## BUG 2 (CONFIRMED) — Stale onboarding banner

**Banner:** `src/pages/tasks/components/ProjectBar.tsx:432-446` — the dashed
"Welcome. Import your first git repo … — Import project" hint.

**Show condition:** `onlyDefault` at `ProjectBar.tsx:307`:
```
const onlyDefault = projects.length === 1 && projects[0]?.id === DEFAULT_PROJECT;
```

### Root cause (one line)
The first *local-path* import **renames the seeded Default project in place** instead of adding a
new one — `CreateProjectModal` calls `updateProject(DEFAULT_PROJECT, { name, repoPath, emoji })`
(`ProjectBar.tsx:57-59`), which keeps `id === 'default'`. So after importing `remote_manufacturing`
this way, `projects.length` is still `1` and `projects[0].id` is still `'default'` →
`onlyDefault` stays **true** → the banner never hides, even though a real repo is now attached.

### Why it differs from the StartScreen gate
`useSetupGate` (`src/pages/setup/useSetupGate.ts:32-33`) uses the *same* id-only test
(`!projects.some(p => p.id !== 'default') && taskCount === 0`) and would be fooled identically —
**but** the gate is additionally guarded by the `piranha:setup-done` localStorage flag
(`useSetupGate.ts:29-30`, written by `StartScreen.finish()` at `StartScreen.tsx:80`), so once setup
completes it never re-opens. The banner has **no such flag and no repoPath check**, so it relies
entirely on the id-only heuristic that the rename defeats. The two surfaces use looser/different
conditions for the same "is this a fresh install?" question.

### Correct condition (hide when any non-default project exists, incl. a repurposed Default)
The seeded Default is "Piranha itself — it has no user repo" (`ProjectBar.tsx:226`). The reliable
signal that the swarm has been pointed at real code is a `repoPath` on the sole default:
```
const onlyDefault =
  projects.length === 1 && projects[0]?.id === DEFAULT_PROJECT && !projects[0]?.repoPath;
```
`Project.repoPath` exists (`src/pages/tasks/projectContext.tsx:7`). A stricter, equivalent form:
`!projects.some(p => p.repoPath)`. Apply the same repoPath guard to `useSetupGate.ts:33` for
consistency so a cleared setup flag can't re-nag a configured install.

---

## Per-route specs

### /tasks — Swarm Board (`src/pages/TasksPage.tsx`)

**Purpose:** the primary Kanban board driving the plan→build→qa→accept→review agent pipeline, plus
six analytic/operational tabs.

**UI regions (from JSX):**
- `StudioNavbar` (`:517`).
- Offline banner — `role=status`, polls `GET /health` every 8s (`:171-185`, rendered `:521-537`).
- `LimitBanner` + `BudgetBanner` lazy (`:540-543`).
- `ProjectBar` (`:548-552`) with `tabs={tabStrip}` and `right={<AgentTank/>}`.
- `tabStrip` (`:375-506`): legacy "Architecture Canvas" button (`:377-382`, **Bug 1**); the tab row
  from `TAB_META` (`tabsConfig.ts:19-27` — Board/Context/Analytics/Events/Logs/Database/Agents);
  action cluster (OrchestratorToggle, RecordButton, Review badge, BoardMenu, New-task, Shortcuts,
  collapse chevron) `:457-504`.
- Content panel switches on `activeTab` (`:568-628`): `ContextTab`, `AnalyticsTab`, `EventsFeed`,
  `LogsTab`, `DbTab`, `AgentsTab`, else `TaskBoard`.
- Modals (`:634-778`): TaskDetail, HumanTodos, heal report, shortcuts, TaskModal, PromptModal,
  GitPanel, SettingsModal, TerminalMonitor.

**Data sources:** `useTasks(activeId)` (polls `/tasks`), `useProjects()`, `GET /health`,
`GET /agent-logs/:agent` (terminal poll `:314-331`), `POST /heal`, `/tasks/:id/approve|reject`.

| Sev | file:line | Issue | Fix |
| --- | --- | --- | --- |
| crit | TasksPage.tsx:377-382 | Duplicate "Architecture Canvas" nav button (Bug 1 #1) | Remove button |
| high | ProjectBar.tsx:432-446 + :307 | Stale onboarding banner (Bug 2) | Add `!projects[0]?.repoPath` guard |
| high | ProjectBar.tsx:358-383 | Second Piranha brand under StudioNavbar (Bug 1 #3) | Remove ProjectBar brand |
| med | ProjectBar.tsx:405-415 | "Studio" button duplicates StudioNavbar designer tab (Bug 1 #2) | Remove |
| low | TasksPage.tsx:379 | Legacy button uses `indigo-600` accent; app accent is `accent-*` red. Off-palette. | Drop with the button |

**Tab sub-specs:**
- **Board** (`TaskBoard`): swimlane Kanban; columns per-project from `boardConfig` localStorage
  (`:72-81`); DnD move → `PUT /tasks/:id`. Data: `useTasks`.
- **Context** (`ContextTab`, lazy): per-project code index / memory + Search view; view lives in the
  URL (`/tasks/context` vs `/tasks/search`, `:94-95`). Data: code-index endpoints.
- **Analytics** (`AnalyticsTab`, lazy): time-per-role charts; `roleColor()`/`orderRoles()` hash
  arbitrary roles to stable colors (shipped with StudioNavbar, see studio-navigation-completed.md
  §3.3). Data: `tasks` prop.
- **Events** (`EventsFeed`, lazy): live table Task/Agent/Action/Link/Time/Attempt; `GET /events`
  polled 5s, client-side filter (`EventsFeed.tsx:6-17`). Matches SPEC P0.7. **Compliant.**
- **Logs** (`LogsTab`, lazy): tails `.agent_logs/*.log` via db-server; recomputes "working" state
  from `/tasks` because the server keys busy-state by full `claimedBy` id (`LogsTab.tsx:29-33`).
- **Database** (`DbTab`) / **Agents** (`AgentsTab`): present in `TAB_META` but not named in the audit
  brief; both lazy, closeable. No defects surfaced at the enumeration level.

---

### /canvas — Architecture Canvas (`src/pages/canvas/CanvasPage.tsx`)

**Purpose:** ReactFlow diagram of a microservice architecture with a node palette, per-node
inspectors (exhaustive framework catalogs + control-flow forms), and (mock) code-gen/sync actions.

**UI regions:** `StudioNavbar` (`:227`); second header row (`:228-257`: back-link, title, Sync,
Generate, Build/Verify); left panel that swaps between `NodePalette` / `CatalogInspector` /
`ControlFlowInspector` (`:264-287`); ReactFlow canvas with Controls/MiniMap/Background (`:295-311`);
right `InspectorPanel` (`:315-320`) and `EdgeInspector` (`:321-328`).

**Data source:** all **local component state** seeded from hardcoded `initialNodes`/`initialEdges`
(`:31-60`). "Sync from Repository" and "Generate Code" are `setTimeout` mocks (`:70-82`).

| Sev | file:line | Issue | Fix |
| --- | --- | --- | --- |
| crit | CanvasPage.tsx:229-235 | "Back to Tasks Board" link + duplicate "Architecture Canvas" title (Bug 1 #4) | Remove link + title |
| high | CanvasPage.tsx:264-287 vs 315-320 | **Dual inspector**: selecting a `springBoot`/`nestjs`/`nextjs`/`fastapi` node shows the exhaustive `CatalogInspector` on the LEFT *and* the legacy `InspectorPanel` (label + ConfigServer/Redis/Kafka checkboxes, `InspectorPanel.tsx:34-60`) on the RIGHT — two config surfaces for one node. Control-flow nodes similarly get `ControlFlowInspector` (left) + a redundant Label field (right). | Suppress `InspectorPanel` when `hasCatalogForNodeType(selectedNode.type) \|\| isControlFlowNodeType(selectedNode.type)` (guard the render at `:315`). |
| high | CanvasPage.tsx:253-255 | **Dead control**: "Build / Verify" button has no `onClick`. | Wire a handler or remove |
| med | CanvasPage.tsx:74,81 | Native `alert()` for "Code generation triggered" / "synced" — inconsistent with the app's Toast system used everywhere else. | Route through `useToast` |
| med | CanvasPage.tsx:70-82 | Sync/Generate are `setTimeout` mocks; canvas starts from hardcoded demo nodes, ignoring the active project. Reads as vaporware in a sales demo. | Gate behind a "Preview" tag or wire to real endpoints |
| low | CanvasPage.tsx:231,240,248 | `hover:` without the `sm:` prefix the rest of the app uses (`sm:hover:`) to avoid sticky hover on touch. | Normalize to `sm:hover:` |
| low | InspectorPanel.tsx:1-8 | `selectedNode: any`, inputs without associated `<label htmlFor>`; generic Inspector predates the catalog system. | Type + label, or retire once dual-inspector fixed |

Control-flow requirement from `docs/canvas-control-flow-pending.md` **did ship**: the four node
types (`controlFlowGateway`/decision, `sagaOrchestrator`, `resilienceGateway`/circuit-breaker,
`forkJoinGateway`) exist in `ControlFlowInspector.tsx:11-18`, and the framework catalogs
(springBoot/nestjs/nextjs/fastapi, lazy-loaded) exist in `CatalogInspector.tsx:10-15`. The doc is
still marked `Status: PLANNING` (`:8`) though the work landed — **stale doc status**.

---

### /designer — Visual React Studio (`src/pages/designer/VisualDesignerPage.tsx`)

**Purpose:** Sandpack-backed live React editor with device presets, visual tweaks, an agent prompt
bar, and a collapsible AI assistant drawer.

**UI regions:** `StudioNavbar` (`:256`); **`ProjectBar` (`:257`)**; page header (`:260-344`:
title "Visual React Studio", view-mode Split/Preview/Code, AI Chat toggle, Reset Project);
`TweaksSidebar` (`:349`); Sandpack editor/preview (`:358-422`); `AgentPromptBar` (`:425`);
`AiAssistantDrawer` (`:429-435`).

**Data source:** local state; `SandpackProvider` with in-memory files; AI drawer scoped to
`activeId` (`:431`).

| Sev | file:line | Issue | Fix |
| --- | --- | --- | --- |
| crit | VisualDesignerPage.tsx:256-257 | THREE stacked headers (StudioNavbar + ProjectBar + page header); ProjectBar re-renders brand #3 and the "Studio" self-link → /designer (Bug 1 #5, #2). | Remove ProjectBar (`:257`) or slim it per Bug 1 |
| high | VisualDesignerPage.tsx:257 | ProjectBar is light-themed (`bg-white`, slate borders) but the designer shell is dark (`bg-slate-950`, `:255`). The white bar clashes badly against the dark studio. | Remove/replace with a dark toolbar |
| high | VisualDesignerPage.tsx:257 → ProjectBar.tsx:432-446 | The stale onboarding banner (Bug 2) ALSO renders here on a fresh install — "Import your first git repo" inside the design studio. | Fixed by Bug 2 fix + removing ProjectBar |
| low | VisualDesignerPage.tsx:277-311 | View-mode buttons use `indigo-*` accent, not the app `accent-*`; consistent within designer but off the global palette. | Align tokens for sale polish |

Cross-check vs `docs/designer-ai-chat-completed.md`: the AI drawer wraps `FileChat` in its own
`ChatStoreProvider` and tracks Sandpack's active file (`ActiveFileTracker`, `:222-228`) — matches
the documented design.

---

### /ide — Code IDE (`src/pages/ide/index.tsx`)

**Purpose:** file-tree + read-only code viewer + a "Run" terminal.

**UI regions:** `StudioNavbar` (`:69`); `FileTreeSidebar` (`:71`); open-file tabs (`:73-85`);
content pane — a read-only `<pre>` (`:86-92`); Terminal Output panel with Run button + `LogConsole`
(`:95-105`).

**Data source:** `GET /api/fs/list` (`FileTreeSidebar.tsx:32`), `GET /file?path=` (`:17`),
`POST /api/fs/run` streamed (`:39-56`). **None are project-scoped** (`withProject` not used).

| Sev | file:line | Issue | Fix |
| --- | --- | --- | --- |
| high | index.tsx:17,39; FileTreeSidebar.tsx:32 | IDE fetches are NOT project-scoped — it browses/runs the db-server's own cwd, not the active project shown in the StudioNavbar badge. Misleading and wrong once a repo is imported. | Wrap in `withProject()` / pass project root |
| high | index.tsx:38-56, 103 | Documented follow-up did NOT ship (studio-navigation-completed.md §7): `/ide` still uses `LogConsole` (`:103`), not `AgentLogsPanel`/`EventsFeed`/`FileChat`. Editor is read-only `<pre>`, no save. | Implement §7 or descope the IDE for v1 sale |
| med | index.tsx:75-83 | File tabs are clickable `<div>`s (not buttons) with a nested `<button>` close — not keyboard-reachable; invalid interactive nesting. | Make the tab a `<button>`, sibling close button |
| low | index.tsx:98 | Run button `hover:` without `sm:` prefix; hardcoded `bg-[#1e1e1e]` (`:102`) instead of a token. | Normalize |
| low | index.tsx:90 | Empty state "Select a file to open" is fine, but there is no empty state when `/api/fs/list` fails (silent `console.error`, `FileTreeSidebar.tsx:38`). | Surface load errors |

---

### StartScreen — first-run setup (`src/pages/setup/StartScreen.tsx`, gated by `useSetupGate`)

**Purpose:** first-launch project-source picker (Clone / New folder / Skip) + workspace settings.

**UI regions:** brand header (`:174-182`); Step 1 project source with two mode cards (`:185-249`);
clone form (url/branch/folder/token + live clone log) or new-folder form; Step 2 workspace settings
(max concurrent agents, permission profile) (`:251-289`); actions row Skip / Continue (`:291-313`).

**Data source:** `GET/PUT /agent-defaults`, `GET /git/tokens`, `POST /git/clone`,
`POST /git/init-repo`; completion writes `piranha:setup-done` (`:80`).

Cross-check vs SPEC P0.1 (`docs/SPEC.md:41-52`): Clone / Start-in-new-folder / Use-this-folder
escape hatch, workspace settings on the same screen, remembered completion — **all present and
compliant.**

| Sev | file:line | Issue | Fix |
| --- | --- | --- | --- |
| med | useSetupGate.ts:32-33 | Gate uses the same id-only "no project beyond default" test that Bug 2 defeats; only the `setup-done` flag saves it. A cleared flag on a configured install would re-show setup. | Add `&& !projects.some(p => p.repoPath)` for defense in depth |
| low | StartScreen.tsx:265-288 | SPEC P0.1 says the safety toggle is "skip-permissions"; shipped as a 3-level profile select (strict/standard/dangerous) — a superset, matches P0.3. Note only. | none (doc note) |

---

### /workflow and /features (secondary)

- **`/workflow`** (`WorkflowPage.tsx`): standalone workflow-graph editor talking to the engine's
  `/workflow` schema. It does **not** render `StudioNavbar` and nothing links to it — an orphan
  route reachable only by typing the URL (`main.tsx:44` comment calls it "Preview"). *Med:* either
  surface it in nav or mark it clearly experimental before sale.
- **`/features`** (`FeaturesPage`, lazy): the prerendered landing page; reached from the brand
  `<Link to="/features">` (`ProjectBar.tsx:359`). No StudioNavbar (correct — it is marketing). If
  Bug 1 #3 removes ProjectBar's brand, preserve a path to `/features`.

---

## Cross-cutting findings

**Duplicated / dead controls**
- Two paths to `/canvas` (StudioNavbar tab + TasksPage button) and two to `/designer` (StudioNavbar
  tab + ProjectBar "Studio" button). See Bug 1.
- Brand mark rendered twice on `/tasks` and `/designer`. See Bug 1 #3/#5.
- Canvas "Build / Verify" button is dead (`CanvasPage.tsx:253`).
- Canvas dual inspector (`CanvasPage.tsx:315` unconditional `InspectorPanel`).

**Tailwind tokens / dark mode**
- The app is light-mode only; `/designer` is the sole dark surface (`bg-slate-950`) and it embeds a
  light `ProjectBar` — a theme clash (fixed by removing ProjectBar there).
- Off-palette `indigo-*` accents on legacy controls (TasksPage.tsx:379, designer view buttons)
  vs the global `accent-*` red.
- `sm:hover:` convention (touch-safe) is inconsistently applied — Canvas and IDE use bare `hover:`.
- Hardcoded hex (`bg-[#1e1e1e]` IDE:102; `#1e293b` borders in designer Sandpack styles) instead of
  tokens.

**Accessibility**
- IDE file tabs are non-button clickable `<div>`s with nested buttons (`index.tsx:75-83`).
- Canvas `InspectorPanel` inputs lack associated labels (`InspectorPanel.tsx:26-31`).
- StudioNavbar itself is exemplary: `<nav aria-label>`, NavLink `aria-current`, health `role=status`
  — use it as the a11y reference for the fixes above.
- Positive: TasksPage/ProjectBar/TaskModal have thorough aria (tablist, aria-haspopup, labelled
  icon buttons, focus management) — the new pages (Canvas/IDE) lag the board's standard.

**Empty states / responsive**
- Board, Context, Analytics, StartScreen, TaskModal have proper empty/loading states.
- Canvas has no empty state (always seeded with demo nodes) and IDE has no failure state for the
  file list.
- StudioNavbar tabs and the task-tab strip both use `overflow-x-auto` with real scrollbars —
  responsive overflow is handled.

**Doc drift**
- `docs/canvas-control-flow-pending.md:8` still says `Status: PLANNING` though the control-flow
  nodes and catalogs shipped.
- `docs/studio-navigation-completed.md:70-76` §7 correctly records the IDE logs consolidation as
  NOT shipped — matches the code.

---

## Prioritised fix list

### Must-fix before sale
1. **Remove the duplicate `/canvas` nav button** on the board — `TasksPage.tsx:377-382`. (Bug 1 #1)
2. **De-duplicate the brand + kill the "Studio" button** in ProjectBar — remove
   `ProjectBar.tsx:358-383` (brand) and `:405-415` (Studio link); keep the brand only in
   StudioNavbar. (Bug 1 #2/#3)
3. **Fix the stale onboarding banner** — add the `!projects[0]?.repoPath` guard at
   `ProjectBar.tsx:307` (and mirror at `useSetupGate.ts:33`). (Bug 2)
4. **Collapse the `/designer` triple header** — remove/slim `ProjectBar` at
   `VisualDesignerPage.tsx:257` (also removes the dark/light clash and the banner leaking into the
   studio). (Bug 1 #5)
5. **Remove `/canvas` back-link + duplicate title** — `CanvasPage.tsx:229-235`. (Bug 1 #4)
6. **Fix the canvas dual inspector** — guard `InspectorPanel` at `CanvasPage.tsx:315` so it does not
   co-render with `CatalogInspector`/`ControlFlowInspector`.
7. **Wire or remove the dead "Build / Verify" button** — `CanvasPage.tsx:253`.
8. **Project-scope the IDE** (or descope it for v1) — `ide/index.tsx:17,39` +
   `FileTreeSidebar.tsx:32` browse the server cwd, not the active project.

### Polish (post-fix or fast-follow)
9. Replace canvas `alert()`s with toasts (`CanvasPage.tsx:74,81`); tag canvas Sync/Generate as
   mock/preview until wired.
10. IDE file tabs → real `<button>`s (`index.tsx:75-83`); add a file-list error state.
11. Normalise `hover:` → `sm:hover:` and `indigo-*`/hardcoded hex → `accent-*`/tokens across Canvas,
    IDE, Designer.
12. Decide the fate of the orphan `/workflow` route (surface in nav or mark experimental).
13. Update stale doc: flip `canvas-control-flow-pending.md:8` from PLANNING to shipped.
14. Ship the IDE logs consolidation (studio-navigation-completed.md §7) or formally descope it.
15. Add labels/types to the legacy `InspectorPanel` if it survives the dual-inspector fix.
