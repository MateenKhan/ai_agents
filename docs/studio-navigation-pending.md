# Unified Studio Navigation & Consolidated IDE Logs Plan

## 1. Problem Statement
- Currently, navigation buttons between `/tasks`, `/canvas`, `/designer`, and `/ide` are scattered ("one icon here, one icon there").
- Visiting a sub-studio (`/designer`, `/canvas`, `/ide`) lacks a consistent top navigation bar to switch between persona studios or return to the main board.
- The `/ide` page uses a stripped-down `LogConsole` instead of Piranha's full `AgentLogsPanel`, `EventsFeed`, and `FileChat` drawer.

## 2. Proposed Architecture & Solution
- Create a global **`StudioNavbar.tsx`** component included at the top of every route:
  - Active project badge + Git status
  - 4 Persona Studio Tabs:
    1. Swarm Board (`/tasks`)
    2. Architecture Canvas (`/canvas`)
    3. Visual React Studio (`/designer`)
    4. Code IDE & Swarm Logs (`/ide`)
- In `/ide`, replace `<LogConsole />` with full `<AgentLogsPanel />` + `<FileChat />`.
