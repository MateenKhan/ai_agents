# Unified Studio Navigation & Consolidated IDE Logs Plan

## 1. Git Worktree & Subagent Assignment
- **Assigned Role:** `Studio Navigation Engineer`
- **Git Worktree Directory:** `.system_generated/worktrees/subagent-Studio-Navigation-Engineer-self-23cf024d`
- **Subagent Conversation ID:** `028b756e-9a61-4348-bc8d-54d6584eb57f`
- **Status:** IN PROGRESS

---

## 2. User Feedback & Documented Requirements
1. **Scattered Navigation ("One icon here, one icon there"):**
   - Right now, buttons to `/designer` ("Studio") and `/canvas` ("Architecture Canvas") are scattered in different parts of the `/tasks` board.
   - When a user navigates to `/designer`, `/canvas`, or `/ide`, there is no consistent top navbar to switch between studios or return to the main board.
2. **IDE Logs Consolidation:**
   - The `/ide` page currently uses a basic `<LogConsole />` text box.
   - It should expose Piranha's rich `AgentLogsPanel`, `EventsFeed`, and interactive `FileChat` drawer so developers have full visibility into swarm activity directly from the IDE.

---

## 3. Detailed Architectural Plan
1. **Create `src/components/navigation/StudioNavbar.tsx`:**
   - A universal top app bar rendered across `/tasks`, `/canvas`, `/designer`, `/ide`.
   - **Left:** Piranha Logo + Project Repository Badge (`remote_manufacturing`).
   - **Center Tabs (4 Persona Studios):**
     - 📋 **Swarm Board (`/tasks`)** — PM Kanban, Agent Swarm, Analytics
     - 🏛️ **Architecture Canvas (`/canvas`)** — Enterprise Architects
     - 🎨 **Visual React Studio (`/designer`)** — Full-Stack UI Designers
     - 💻 **Code IDE (`/ide`)** — Developers & QA Automation
   - **Right:** Live Backend Health Indicator (`127.0.0.1:6952 API: UP`) + Quick Action shortcuts.
2. **Upgrade `/ide` Page (`src/pages/ide/index.tsx`):**
   - Embed `StudioNavbar` at the top.
   - Replace basic `LogConsole` with `AgentLogsPanel` and add a collapsible `FileChat` panel.
3. **Automated Verification:**
   - Add Playwright E2E assertions verifying navigation between `/tasks`, `/canvas`, `/designer`, and `/ide` via the `StudioNavbar`.
