# Activepieces Embedded Workflow Builder UI Plan

## 1. Git Worktree & Subagent Assignment
- **Assigned Role:** TBD
- **Git Worktree Directory:** TBD
- **Status:** PENDING EXECUTION

---

## 2. Problem Statement
- Activepieces integration today is **backend-only** — just a webhook URL storage table and an agent tool.
- There is **NO embedded UI** for users to visually build automations, connect OAuth accounts (Gmail, Slack, GitHub), or configure multi-step workflows.
- Without the visual builder, a user CANNOT:
  - Connect their Gmail, Slack, Notion, or any service via OAuth
  - Drag-and-drop automation steps (trigger → filter → action)
  - Configure credentials, API keys, or piece connections
  - Test or debug workflow runs
- This makes the current Activepieces integration a dead feature.

---

## 3. Proposed Solution
Activepieces is fully open-source (MIT) and can be embedded. Two approaches:

### Option A: Embed Activepieces as an iframe / SDK (Recommended)
- Bundle Activepieces as a Docker container that starts alongside Piranha (`pnpm run agents` also boots Activepieces on `:8080`).
- Add a `/automations` route in Piranha that renders Activepieces inside an iframe or via their embed SDK.
- Connect Piranha's project context so workflows are scoped per-project.

### Option B: Build a Custom Visual Workflow Builder
- Use `@xyflow/react` (already in our deps for `/canvas`) to build a custom automation flow editor.
- Integrate with Activepieces pieces (npm packages) for OAuth connectors (Gmail, Slack, GitHub, etc.).
- More control but significantly more engineering effort.

---

## 4. User Story
> "I want to click a trigger like 'New Gmail Email', connect my Google account via OAuth, add a filter step, then send a Slack message — all from inside Piranha without leaving the app."

---

## 5. Required Deliverables
1. Activepieces local instance bundled with Piranha startup.
2. `/automations` route with embedded workflow builder UI.
3. OAuth connection flow for popular services (Gmail, Slack, GitHub, Notion, Discord).
4. Project-scoped automation workflows stored in Piranha's DB.
