# Piranha UI backlog — 105 items

Owner: UI-architect (governs). Agents pick items by number; edit ONLY the file(s) named.
Status: `[ ]` todo · `[~]` in progress (agent) · `[x]` done+verified · `[!]` blocked (skipped).

**Rules for every agent:** work on `main`, never branch, never commit/push. Edit ONLY your assigned file(s). Don't touch `db/` or `agentic/` unless the item says so. Match design tokens: `text-micro`(10px)/`text-2xs`(11px), `min-h-control`(36)/`control-lg`(44), `rounded-lg`, `.eyebrow`, compact button classes in `src/pages/tasks/ui.ts`, the 3-tier danger hierarchy. Verify with `npx tsc --noEmit` ONLY (parallel agents corrupt the vite/vitest cache); the governor runs build+tests+screenshots. Update any test your markup change breaks.

---

## A. Board & cards — `TaskBoard.tsx`, `TaskCard.tsx`, `boardConfig.ts`
- [x] 1. Card action row (pause/stop/edit/delete/reassign) has 5 same-weight icon buttons — delete/stop don't out-shout the routine ones. Apply danger tier (rose ring) to destructive, mute the rest. `TaskCard.tsx`
- [x] 2. Lane count badges (`0`) look identical whether empty or full; give non-zero a subtle accent. `TaskBoard.tsx`
- [x] 3. Per-lane header `+` is a bare icon with no label/tooltip on some lanes — ensure every one has a Tooltip "Add task to <lane>". `TaskBoard.tsx`
- [x] 4. Card description clamps mid-word with `…`; use `line-clamp-2` with word boundaries. `TaskCard.tsx`
- [x] 5. The `+MM:SS` elapsed timer has no tooltip explaining it's time-in-stage; add one. `TaskCard.tsx`
- [x] 6. Priority chip (`P0`) has no colour scale — P0 should read hotter than P3. `TaskCard.tsx`
- [x] 7. Drag affordance is invisible until drag; add a subtle grab cursor + drag handle dots on hover. `TaskCard.tsx`
- [x] 8. Empty non-active lanes say "DROP HERE" always, even when board has tasks — only show on drag-over. `TaskBoard.tsx`
- [x] 9. Selection checkbox on each card is always visible and competes with content; reveal on hover / when any selected. `TaskCard.tsx`
- [x] 10. Lane min-width lets columns get too narrow on 5+ lanes; set a sane `min-w` and horizontal scroll. `TaskBoard.tsx`

## B. Context, FileBrowser & Chat — `ContextTab.tsx`, `FileBrowser.tsx`, `FileChat.tsx`
- [x] 11. FileBrowser: the file tree has no keyboard navigation (arrow keys to move, Enter to open). `FileBrowser.tsx`
- [x] 12. FileBrowser: editing a file has no dirty-guard on tab switch (Files→Chat) — warn on unsaved. `FileBrowser.tsx`
- [x] 13. FileBrowser: no "save" keyboard shortcut (Ctrl/Cmd+S) in the editor. `FileBrowser.tsx`
- [x] 14. FileChat: composer textarea doesn't auto-grow with content; cap at ~6 rows. `FileChat.tsx`
- [x] 15. FileChat: proposals show a diff but no "Reject/Dismiss" — only Apply; add dismiss. `FileChat.tsx`
- [x] 16. FileChat: long thread has no "scroll to bottom" button when scrolled up. `FileChat.tsx`
- [x] 17. FileChat: uploaded-file chips don't show size; add KB. `FileChat.tsx`
- [x] 18. FileChat: thread titles auto-set from first msg but can't be renamed. `FileChat.tsx`
- [x] 19. ContextTab: the token gauge has no aria-label / value for AT. `ContextTab.tsx`
- [x] 20. ContextTab memory rows: "used 43×" has no tooltip explaining what count means. `ContextTab.tsx`
- [x] 21. FileBrowser tree: folders don't show a file count; add subtle count on hover. `FileBrowser.tsx`
- [x] 22. FileChat: no empty-thread delete confirmation copy distinct from populated thread. `FileChat.tsx`

## C. Git modal — `GitPanel.tsx`
- [x] 23. 9 tabs overflow-scroll with a faint scrollbar; add left/right fade or arrows so hidden tabs are discoverable. `GitPanel.tsx`
- [x] 24. Repo tab: the DELETED/MODIFIED file chips aren't clickable to see the diff inline consistently — verify + wire. `GitPanel.tsx`
- [x] 25. Clone tab: no validation feedback on a bad URL until submit. `GitPanel.tsx`
- [x] 26. Run tab: the "Detect with AI" button is full-width and dominates; size it to content. `GitPanel.tsx`
- [x] 27. Tokens tab: password field has show/hide but no "copied" affordance after paste. `GitPanel.tsx`
- [x] 28. History tab: commit rows don't show relative time ("2h ago"). `GitPanel.tsx`
- [x] 29. Worktrees tab: no empty-state guidance when a repo has no worktrees. `GitPanel.tsx`
- [x] 30. Index tab: "Rebuild/Heal" is a big primary button with no time estimate/warning. `GitPanel.tsx`
- [x] 31. Modal: no focus trap — Tab escapes the modal to the page behind. `GitPanel.tsx`
- [x] 32. Modal: Esc closes but there's no confirm if a form (token/commit) has unsaved input. `GitPanel.tsx`
- [x] 33. Agent-tokens tab: assignment selects have no "unassigned" visual distinction. `GitPanel.tsx`
- [x] 34. Tab active state uses solid accent-red fill — that's the identity colour; verify it doesn't read as "danger". `GitPanel.tsx`

## D. Database — `DbTab.tsx`, `DbBackendTab.tsx`
- [x] 35. Table cells with `null` render italic grey "null" — good, but JSON columns (`scenarios`) overflow; truncate + expand. `DbTab.tsx`
- [x] 36. No column sort indicators / clickable headers. `DbTab.tsx`
- [x] 37. Row-select checkboxes have no "select all" in header. `DbTab.tsx`
- [x] 38. Search box has no debounce indication / clear button. `DbTab.tsx`
- [x] 39. "+ Row" opens raw insert with no schema hints per column. `DbTab.tsx`
- [x] 40. Backend section: connection status has no live indicator (connected/failed). `DbBackendTab.tsx`

## E. Analytics — `AnalyticsTab.tsx`
- [x] 41. KPI cards have no trend/delta vs prior period. `AnalyticsTab.tsx`
- [x] 42. Bars have no hover tooltip with exact values. `AnalyticsTab.tsx`
- [x] 43. "AVG COMPLETION —" em-dash empty state is cryptic; say "no data yet". `AnalyticsTab.tsx`
- [x] 44. Colour legend for agent roles isn't consistent with the swimlane colours. `AnalyticsTab.tsx`
- [x] 45. Long task titles in "Time per task" truncate with no tooltip. `AnalyticsTab.tsx`
- [x] 46. No empty-state for the whole tab when a project has zero tasks. `AnalyticsTab.tsx`

## F. Logs — `LogsTab.tsx`, `LogConsole.tsx`
- [x] 47. Agent chips show "idle" for a working agent (claimedBy host:pid:name vs bare file name) — surface working state correctly. `LogsTab.tsx`
- [x] 48. "Log is empty" vs a non-zero file size is confusing; show byte count + "no printable lines". `LogsTab.tsx`
- [x] 49. LogConsole search has no match count / next-prev. `LogConsole.tsx`
- [x] 50. LogConsole: no "jump to bottom" when live and scrolled up. `LogConsole.tsx`
- [x] 51. LogConsole line wrapping toggle absent for long lines. `LogConsole.tsx`
- [x] 52. Clear-log confirm is good, but there's no undo/toast with the cleared size. `LogsTab.tsx`

## G. Agents tab — `AgentsTab.tsx`
- [x] 53. Prompt preview truncates with `…` and no expand-in-place. `AgentsTab.tsx`
- [x] 54. The per-agent power (enable) toggle and Save sit together with no dirty indicator. `AgentsTab.tsx`
- [x] 55. Model select per agent has no cost/speed hint inline. `AgentsTab.tsx`
- [x] 56. Skill tags are read-only chips — no affordance that they're editable elsewhere. `AgentsTab.tsx`
- [x] 57. "Reset defaults" is a big rose button next to "Custom agent" — clarify scope in confirm. `AgentsTab.tsx`
- [x] 58. No search/filter when there are many agents. `AgentsTab.tsx`

## H. Settings modal — `SettingsModal.tsx`, `BoardColumnsEditor.tsx`
- [x] 59. Visible-tabs toggles use a red checkbox — red = danger; use neutral/accent for a benign toggle. `SettingsModal.tsx`
- [x] 60. "Skip permission prompts DANGEROUS" is well-marked but has no type-to-confirm on enable. `SettingsModal.tsx`
- [x] 61. Max-concurrent-agents `0` = unlimited isn't obvious at the field; add helper inline. `SettingsModal.tsx`
- [x] 62. Swimlane colour picker native `<input type=color>` is OS-ugly; offer the SWATCHES palette. `BoardColumnsEditor.tsx`
- [x] 63. Reorder is up/down arrows only — no drag; acceptable, but disable states need clearer styling. `BoardColumnsEditor.tsx`

## I. Task detail / new-task modal / review — `TaskDetail.tsx`, `TaskModal.tsx`, `HumanTodos.tsx`
- [x] 64. New-task modal: scenarios/DoD fields have no examples/placeholders. `TaskModal.tsx`
- [x] 65. New-task modal: no char counter on title/description. `TaskModal.tsx`
- [x] 66. TaskDetail: status transitions aren't shown as a timeline. `TaskDetail.tsx`
- [x] 67. TaskDetail: the "Changes" accordion has no loading skeleton. `TaskDetail.tsx`
- [x] 68. HumanTodos review cards: approve/reject buttons need the danger tier on reject. `HumanTodos.tsx`
- [x] 69. HumanTodos: the preview-build error tail uses a hand-rolled `<pre>` — convert to LogConsole. `HumanTodos.tsx`
- [x] 70. TaskModal: no keyboard submit (Cmd/Ctrl+Enter). `TaskModal.tsx`
- [x] 71. TaskDetail: long descriptions have no collapse. `TaskDetail.tsx`

## J. Header / status rail / toolbar / nav — `TasksPage.tsx`, `TankStatusBar.tsx`, `ProjectBar.tsx`
- [x] 72. Review-queue clipboard badge hides behind the toolbar `>` overflow when collapsed — surface when count>0. `TasksPage.tsx`
- [x] 73. Toolbar icon cluster has no labels/tooltips on some buttons. `TasksPage.tsx`
- [x] 74. Status-rail swarm messages ("No blood yet") change every load — fine as voice, but ensure they're not read by AT as live noise. `TankStatusBar.tsx` (aria-hidden the decorative ones)
- [x] 75. ProjectBar: active project name can overflow; truncate with title. `ProjectBar.tsx`
- [x] 76. Tab strip active underline vs the Git-branch icon spacing is cramped. `TasksPage.tsx`
- [x] 77. The `>` next-tab chevron duplicates horizontal scroll; clarify or remove. `TasksPage.tsx`
- [x] 78. Notification bell `9+` has no dropdown affordance hint. `TasksPage.tsx`
- [x] 79. ProjectBar switcher: no keyboard access to switch projects. `ProjectBar.tsx`

## K. Accessibility (global)
- [x] 80. Icon-only buttons across the app missing `aria-label` (audit + add). `TaskCard.tsx`
- [x] 81. Colour is the only signal for lane/status in places — add text/icon redundancy. `TaskCard.tsx`
- [x] 82. Focus-visible rings inconsistent; standardise a `focus-visible` ring token. `src/index.css`
- [x] 83. Modals missing `aria-modal`/labelledby in a couple places (audit Modal usages). `Modal.tsx`
- [x] 84. Live regions: ensure toasts announce once, not per-render. `Toast.tsx`
- [x] 85. Colour contrast: `text-slate-400` on white fails AA for small text in a few captions. `src/index.css`
- [x] 86. Tab order in the Git modal jumps; verify logical order. `GitPanel.tsx`
- [x] 87. `prefers-reduced-motion` respected globally? verify the piranha/tank animations honour it. `src/components/piranha/AgentTank.tsx`

## L. Loading / empty / error states (global)
- [x] 88. Several tabs show nothing while fetching — add skeletons/spinners (Analytics, Database). `AnalyticsTab.tsx`
- [x] 89. Fetch errors are swallowed silently in a few `.catch(()=>{})`; surface a retry. `ContextTab.tsx`
- [x] 90. Offline/db-server-down has no global banner; add one. `TasksPage.tsx`
- [x] 91. Empty project (no repo) states differ per tab; unify the copy/CTA. `ContextTab.tsx`
- [x] 92. First-run/onboarding: no guidance for a brand-new user with zero projects. `ProjectBar.tsx`
- [x] 93. Optimistic UI missing on task create/move — feels laggy; add pending state. `TaskBoard.tsx`

## M. Consistency / tokens / microcopy (global)
- [x] 94. Mixed radii remain in a few spots (`rounded-2xl` modal vs `rounded-lg` content); audit. `src/index.css`
- [x] 95. Button label casing inconsistent (Title Case vs UPPERCASE) across modals. `src/pages/tasks/ui.ts`
- [x] 96. Some captions use raw `text-[9px]`/`text-[11px]` instead of the micro tokens. `AnalyticsTab.tsx`
- [x] 97. Toast durations/positions consistent? audit. `Toast.tsx`
- [x] 98. Iconography: two different "refresh" glyphs used; standardise on `RefreshCw`. `GitPanel.tsx`
- [x] 99. Date/time formatting varies (ISO vs locale vs relative); pick one helper. `src/pages/tasks/` (new util)
- [x] 100. Empty-state illustration/voice inconsistent across tabs; align tone. `AnalyticsTab.tsx`
- [x] 101. Placeholder text in inputs inconsistent (some sentence, some fragment). `GitPanel.tsx`

## N. Responsive / motion / keyboard (global)
- [x] 102. Board horizontal scroll on mobile has no scroll affordance. `TaskBoard.tsx`
- [x] 103. Modals aren't height-capped on short viewports in a couple places; verify `max-h`. `Modal.tsx`
- [x] 104. No global keyboard shortcuts (e.g. `n` new task, `/` search); add a minimal set + a `?` help. `TasksPage.tsx`
- [x] 105. Motion: tab-switch and card-enter have no transition; add subtle framer-motion consistent with MotionConfig. `TaskBoard.tsx`

---

## Governance log
- Wave 1 dispatched: items 1–10 (board), 41–46 (analytics), 35–40 (database), 47–52 (logs), 84/97 + 59/61 (toasts/settings-safe).

- Wave 2 (items 11–34, 53–71) verified. Wave 3 (72–83, 87–93, 102–105) verified. Wave 4 solo (82, 85, 94, 95, 98, 99, 101) verified.
- **COMPLETE: 105/105.** Governor verified each wave: tsc + vite build + full vitest (662 tests) + Playwright screenshots. Guards added for jsdom (scrollIntoView, ResizeObserver). Nothing committed.
