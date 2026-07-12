# Visual React Studio (/designer) Interactive AI Chat & Code Editor — COMPLETED

## 1. Git Worktree & Subagent Assignment
- **Assigned Role:** `Designer AI Chat Engineer`
- **Git Worktree Directory:** `.system_generated/worktrees/subagent-Designer-AI-Chat-Engineer-self-0d39dea3`
- **Subagent Conversation ID:** `7de14c76-105b-4233-9b5e-42e37f225a5d`
- **Status:** COMPLETED (2026-07-12, shipped in commit `452b6a5`)

---

## 2. User Feedback & Documented Requirements (as originally recorded)
1. **Interactive Element Selection & Code Editing:**
   - Clicking components or preview elements in `/designer` should let the user inspect code or modify styles instantly.
2. **AI Chat & Prompt Integration (`FileChat`):**
   - The user explicitly requested: *"clicking should let me edit and see review or select that field and send details to ai - use the ai chat component we already have this"*.
   - We must integrate `FileChat.tsx` directly into the `/designer` layout so selecting a component or code block allows prompting the AI swarm immediately.

---

## 3. What Shipped

### 3.1 New: AI Assistant & Inspector drawer — `src/pages/designer/components/AiAssistantDrawer.tsx`
A collapsible right-side pane (`data-testid="ai-assistant-drawer"`, 360px wide, capped at 45vw) that composes the existing `<FileChat />` from `src/pages/tasks/components/FileChat.tsx` **untouched**, inside its own `<ChatStoreProvider>` — the same store contract `FileBrowser` uses. The drawer adds three designer-owned pieces on top of the composed chat:
- **Drawer chrome:** an "AI Assistant & Inspector" header with a close button (`data-testid="ai-drawer-close"`).
- **Active selection context banner** (`data-testid="designer-ai-context"`): shows the repo-style path of the Sandpack file being viewed (leading slash stripped by the exported `toRepoPath()` helper) plus a one-line human description from the exported `describeSandpackFile()` helper (e.g. "Root React component rendered in the live preview" for `App.tsx`).
- **`SelectionContextBridge`** (exported): renders inside the `ChatStoreProvider` and calls the chat store's `tag(filePath)` whenever the active file changes — the exact mechanism `FileBrowser`'s drag-to-tag uses — so prompts sent from the drawer operate on the file the designer is looking at. It re-tags when the user switches chat threads, and `tag()` is idempotent for already-tagged paths.

The drawer also exports `AI_DRAWER_STORAGE_KEY` (`'designer.aiDrawerOpen'`), the localStorage key for its open/closed state.

### 3.2 Modified: page wiring — `src/pages/designer/VisualDesignerPage.tsx`
- **`StudioNavbar` embedded at the top** (line ~256), ahead of the `ProjectBar`, exactly as planned in section 4.1. The navbar itself is documented in `docs/studio-navigation-completed.md`.
- **"AI Chat" toolbar toggle** (`data-testid="ai-chat-toggle"`, with `aria-pressed`): opens and closes the drawer. The open state is initialised from and persisted to localStorage under `AI_DRAWER_STORAGE_KEY`, so the drawer survives reloads and future visits. Both the toggle and the drawer's own close button persist the state.
- **`ActiveFileTracker`**: a render-nothing component inside the `SandpackProvider` that reports `useSandpack().sandpack.activeFile` up to the page, because the drawer lives *outside* the provider. The page holds the active file in state (default `/App.tsx`) and passes it to the drawer.
- The Sandpack workspace column got `min-w-0` so it shrinks when the drawer opens instead of overflowing the flex row.
- The drawer receives the active project id from `useProjects()` (`activeId`, falling back to `'default-project'`), which scopes the chat store and API calls the same way `FileBrowser` scopes them.

## 4. Shipped vs Originally Planned (deviations)
- **Requirement 2.2 (FileChat integration): fully met.** `FileChat` is composed as-is in the `/designer` layout, receives the project id through its existing `activeId` prop, and the active code selection is bridged into the chat via the store's `tag()`.
- **Requirement 2.1 (interactive selection): met at file granularity, not element granularity.** What shipped: the user inspects and edits code in the `SandpackCodeEditor` (Split/Code view modes), modifies styles instantly through the existing `TweaksSidebar`, and whichever Sandpack file tab they view is automatically tagged into the AI chat as context. What did **not** ship: clicking an individual element *inside the rendered preview iframe* to select it. The selection unit is the active Sandpack file (e.g. `App.tsx`), not a DOM node in the preview. If per-element preview selection is still wanted, it is a new piece of work (it requires instrumenting the Sandpack preview iframe), not a small extension of this drawer.
- The plan named `index.css` as a possible context file; the actual Sandpack project uses `/App.tsx` plus a hidden `/styles.css` (generated from the tweaks), so in practice the context is `App.tsx` unless the user opens another file. `describeSandpackFile()` handles `.css`, `.ts`/`.tsx`, and `.html` paths generically.
- The plan's section 3.3 (Playwright E2E for the drawer) shipped as specified — see below.

## 5. Test Coverage
- **Unit/component — `src/pages/designer/__tests__/VisualDesignerPage.test.tsx`** (Vitest + Testing Library, with Sandpack, FileChat, StudioNavbar, ProjectBar, and project context all mocked):
  - drawer is closed by default and toggles open/closed from the toolbar, with `aria-pressed` tracking;
  - drawer state persists to localStorage and is restored on a fresh mount, and the drawer's close button persists the collapsed state;
  - `FileChat` receives the active project id via its existing `activeId` prop, and the selection bridge calls `tag('App.tsx')`;
  - switching the active Sandpack file updates the context banner and re-tags (`tag('styles.css')`);
  - helper tests for `toRepoPath()` and `describeSandpackFile()`.
- **E2E — `e2e/designer.spec.ts`** (Playwright, `/projects` stubbed):
  - "AI chat toggle opens the assistant drawer and shows the active code context": drawer absent from the DOM by default, opens on toggle, shows "AI Assistant & Inspector" and the `App.tsx` context banner, and collapses on a second toggle;
  - "AI drawer open state persists across a reload": drawer restored from localStorage after `page.reload()` with the context banner intact;
  - plus the pre-existing studio specs (page load, device presets, orientation, view modes) that guard the surface the drawer sits in.

## 6. How to Verify by Hand
1. Start the stack: `pnpm agents` (Vite on `http://127.0.0.1:6951`, db-server on `:6952`).
2. Open `http://127.0.0.1:6951/designer`.
3. In the top toolbar, click the **AI Chat** button (sparkles icon). The right-side "AI Assistant & Inspector" drawer opens; the indigo banner under its header reads `App.tsx — Root React component rendered in the live preview`.
4. The FileChat surface below the banner is the same chat component as the Files tab of the board; send a prompt and it operates with `App.tsx` tagged as context.
5. Reload the page. The drawer reopens by itself (localStorage persistence). Click the drawer's × or the toolbar toggle to collapse it; reload again and it stays closed.
6. Confirm the `StudioNavbar` sits above everything with the Visual React Studio tab highlighted.
