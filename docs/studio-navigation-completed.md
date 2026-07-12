# Unified Studio Navigation & Consolidated IDE Logs — COMPLETED (with open follow-ups)

## 1. Git Worktree & Subagent Assignment
- **Assigned Role:** `Studio Navigation Engineer`
- **Git Worktree Directory:** `.system_generated/worktrees/subagent-Studio-Navigation-Engineer-self-23cf024d`
- **Subagent Conversation ID:** `028b756e-9a61-4348-bc8d-54d6584eb57f`
- **Status:** COMPLETED (2026-07-12, shipped in commit `452b6a5`) — the unified navigation half is done; the IDE logs consolidation half remains open, see section 7.

---

## 2. User Feedback & Documented Requirements (as originally recorded)
1. **Scattered Navigation ("One icon here, one icon there"):**
   - Right now, buttons to `/designer` ("Studio") and `/canvas` ("Architecture Canvas") are scattered in different parts of the `/tasks` board.
   - When a user navigates to `/designer`, `/canvas`, or `/ide`, there is no consistent top navbar to switch between studios or return to the main board.
2. **IDE Logs Consolidation:**
   - The `/ide` page currently uses a basic `<LogConsole />` text box.
   - It should expose Piranha's rich `AgentLogsPanel`, `EventsFeed`, and interactive `FileChat` drawer so developers have full visibility into swarm activity directly from the IDE.

---

## 3. What Shipped

### 3.1 New: `src/components/navigation/StudioNavbar.tsx`
The universal top app bar (`data-feature-id="studio-navbar"`, `aria-label="Studios"`), rendered as the first element of all four studio pages:

| Page | Route | Where it is embedded |
| --- | --- | --- |
| Swarm Board | `/tasks` (and nested `/tasks/:tab`) | `src/pages/TasksPage.tsx` (~line 519) |
| Architecture Canvas | `/canvas` | `src/pages/canvas/CanvasPage.tsx` (~line 227) |
| Visual React Studio | `/designer` | `src/pages/designer/VisualDesignerPage.tsx` (~line 256) |
| Code IDE | `/ide` | `src/pages/ide/index.tsx` (~line 69, replacing the old static "IDE" label bar) |

- **Left:** the Piranha teeth-mark brand SVG plus the **active project badge** (`data-feature-id="studio-project-badge"`), which shows the active project's emoji and name from `useProjects()` — so it reads `remote_manufacturing` when that project is active, but follows whichever project is selected rather than being hardcoded.
- **Center:** one tab per persona studio — Swarm Board `/tasks`, Architecture Canvas `/canvas`, Visual React Studio `/designer`, Code IDE `/ide` (each `data-feature-id="studio-tab-<route>"`). Tabs are react-router `<NavLink>`s, so the active tab carries `aria-current="page"` automatically and every tab is a real anchor: keyboard-reachable, middle-clickable, bookmarkable. `/tasks` deliberately has no `end` matching, so nested routes like `/tasks/analytics` keep the board tab lit.
- **Right:** the **live backend health dot** (`data-feature-id="studio-health"`, `role="status"`). It polls `GET {API_BASE}/system-status` through `withProject()` on a 4-second interval — the same source and cadence the existing status widgets use, no new fetch layer — and renders `127.0.0.1:6952 API: UP` (green), `API: DOWN` (red), or `checking…` before the first poll answers. The displayed host is derived from `API_BASE` in `src/apiBase.ts`, so the label can never disagree with where the poll actually goes.

### 3.2 Modified: `src/pages/ide/index.tsx`
`StudioNavbar` is embedded at the top of the IDE, replacing the page's old static label bar. The rest of the planned IDE upgrade did **not** ship — see section 7.

### 3.3 Shipped alongside (same commit): derived role colors in `src/pages/tasks/components/AnalyticsTab.tsx`
As part of unifying the Swarm Board studio, the Analytics tab's role colors became deterministic and open-ended: the exported `roleColor(role)` keeps fixed colors for the four classic roles (`architect`, `dev`, `qa`, `merge`) and hashes any other role name into a distinct mid-tone Tailwind palette (`EXTRA_ROLE_PALETTE`), so custom roles render the same hue on every visit and machine with no registry to maintain. The exported `orderRoles()` gives a canonical display order. This was not in the original plan text; it shipped in the same commit (`452b6a5`) because the studio unification surfaced arbitrary role names in Analytics.

## 4. Shipped vs Originally Planned (deviations)
- **Requirement 2.1 (unified navigation): met.** All four studios render the same top bar, and each is one click from every other; there is no longer a scattered set of one-off buttons as the only path between them.
- Tab icons shipped as **lucide icons** (ClipboardList, Network, Palette, Code2) rather than the emoji (📋 🏛️ 🎨 💻) sketched in the plan — a deliberate match with the rest of the app's iconography.
- The project badge is **dynamic** (active project from context) rather than the hardcoded `remote_manufacturing` string the plan sketched.
- The plan's "Quick Action shortcuts" on the right side of the bar were **not built**; the right side holds only the health indicator. Nothing currently missing has been requested since, so this is treated as dropped scope unless the user asks again.
- The plan's automated verification (section "Playwright E2E assertions verifying navigation between studios") shipped as **unit tests instead of E2E** — see sections 5 and 7.
- **Requirement 2.2 (IDE logs consolidation): NOT met.** See section 7.

## 5. Test Coverage
- **`src/components/navigation/__tests__/StudioNavbar.test.tsx`** (Vitest + Testing Library, fetch stubbed):
  - all four studio tabs render as links pointing at `/tasks`, `/canvas`, `/designer`, `/ide`;
  - the tab for the current route carries `aria-current="page"` and the others do not;
  - Swarm Board stays active on nested `/tasks/analytics` (no `end` matching);
  - health dot shows `API: UP` when `/system-status` answers, and the poll goes through the project-scoped URL (`/system-status?project=`);
  - health dot shows `API: DOWN` when the poll rejects;
  - the active project badge renders the project name from context.
- **`src/pages/tasks/components/__tests__/AnalyticsTab.test.tsx`**: `roleColor` keeps the classic four fixed colors, gives stable, distinct, non-rose colors to arbitrary new roles, and `orderRoles` puts classics first; plus rendered-swatch assertions.
- **`src/pages/designer/__tests__/VisualDesignerPage.test.tsx`** mocks `StudioNavbar` (Router/context isolation), confirming the designer page composes it.
- There is **no Playwright E2E spec** driving cross-studio navigation through the navbar yet (see section 7).

## 6. How to Verify by Hand
1. Start the stack: `pnpm agents` (Vite on `http://127.0.0.1:6951`, db-server on `:6952`).
2. Open `http://127.0.0.1:6951/tasks`. The top bar shows the Piranha mark, the active project badge, four studio tabs, and on the right a green dot with `127.0.0.1:6952 API: UP`.
3. Click **Architecture Canvas**, then **Visual React Studio**, then **Code IDE**: each page loads with the same bar at the top and the clicked tab highlighted (red-accent pill). Click **Swarm Board** to return; open the Analytics tab under `/tasks` and confirm the board tab stays highlighted.
4. Stop the db-server (`pnpm db:stop`) and watch the dot turn red with `API: DOWN` within a few seconds; restart it and the dot recovers.
5. In the Analytics tab, roles beyond architect/dev/qa/merge (e.g. `tech-writer`) render with their own stable swatch colors in the time-per-role bars and legends.

## 7. Remaining Follow-ups (OPEN)
These were planned in section 2.2 / the original architectural plan but have **not** shipped; `/ide` today embeds the `StudioNavbar` and nothing else changed:
1. **Replace the IDE's `LogConsole` with the rich logs experience.** `src/pages/ide/index.tsx` still renders `<LogConsole lines={logs} bare fill tailControl />` (from `src/pages/tasks/components/LogConsole.tsx`) for its Terminal Output pane. Note the plan's named target, `AgentLogsPanel`, does not exist anywhere in `src/` — the follow-up should first decide whether that means extracting the board's logs surface into such a component or reusing an existing one.
2. **Surface `EventsFeed` in the IDE.** `src/pages/tasks/components/EventsFeed.tsx` exists and is used on the board, but is not rendered on `/ide`.
3. **Add a collapsible `FileChat` panel to the IDE.** The composition pattern to copy is the designer's `src/pages/designer/components/AiAssistantDrawer.tsx` (see `docs/designer-ai-chat-completed.md`), which wraps `FileChat` in its own `ChatStoreProvider` — the IDE could reuse the drawer nearly as-is, tagging the file open in the editor.
4. **Playwright E2E for cross-studio navigation.** Add assertions that clicking each navbar tab lands on `/tasks`, `/canvas`, `/designer`, `/ide`; today this is covered only by unit tests of the `NavLink` hrefs and `aria-current`.
