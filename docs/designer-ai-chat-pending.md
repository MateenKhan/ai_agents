# Visual React Studio (/designer) Interactive AI Chat & Code Editor Plan

## 1. Git Worktree & Subagent Assignment
- **Assigned Role:** `Designer AI Chat Engineer`
- **Git Branch:** `subagent-designer-ai-chat`
- **Worktree Directory:** `.system_generated/worktrees/subagent-designer-ai-chat`
- **Status:** PENDING EXECUTION

---

## 2. User Feedback & Documented Requirements
1. **Interactive Element Selection & Code Editing:**
   - Clicking components or preview elements in `/designer` should let the user inspect code or modify styles instantly.
2. **AI Chat & Prompt Integration (`FileChat`):**
   - The user explicitly requested: *"clicking should let me edit and see review or select that field and send details to ai - use the ai chat component we already have this"*.
   - We must integrate `FileChat.tsx` directly into the `/designer` layout so selecting a component or code block allows prompting the AI swarm immediately.

---

## 3. Detailed Architectural Plan
1. **Update `src/pages/designer/VisualDesignerPage.tsx`:**
   - Embed `StudioNavbar` at the top for unified navigation.
   - Add a collapsible **AI Assistant & Inspector Drawer** on the right side containing `<FileChat />`.
2. **Element & Code Selection Bridge:**
   - When a user views code or clicks an element in `/designer`, populate `FileChat` with the active file path (`App.tsx` or `index.css`) and component context so prompt instructions directly modify Sandpack files.
3. **Automated Verification:**
   - Add Playwright E2E test in `e2e/designer.spec.ts` verifying that clicking the AI Chat toggle opens the drawer and displays the active code context.
