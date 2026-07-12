# Activepieces Integration Plan

This plan outlines the architecture for transforming Piranha from a coding-only agent system into a generalized AI workflow platform by integrating Activepieces as its tool-execution subsystem.

## Goal Description
Replace the restrictive Claude CLI runner with a custom Node.js runner that supports custom tools (specifically Webhooks). Integrate Activepieces so agents can trigger workflows (e.g., sending WhatsApp messages, scraping leads). 

We will use a swarm of **4 specialized subagents** to execute this massive refactor in parallel.

## Proposed Changes (Subagent Breakdown)

### Subagent 1: The "Engine Refactorer"
**Focus:** `agentic/engine/runner.ts`
* Strip out the hardcoded `claude -p` CLI spawn command.
* Implement a native Node.js API client (e.g., `@anthropic-ai/sdk` or a model-agnostic adapter as defined in Release 3).
* Build a native "Tool Execution Loop" that allows the AI to request tools (like `call_webhook`) and receive the response without writing bash scripts.

---

### Subagent 2: The "Tooling Architect"
**Focus:** `agentic/workflow/types.ts` & `agentic/types.ts`
* Update the `Methodology` layer to inject custom tools into the agent prompts.
* Define the exact JSON schema for the `trigger_activepieces_webhook` tool.
* Ensure that "generic" agents (like a Lead Generation agent) receive this tool automatically, while coding agents (like Dev) still receive their standard file tools.

---

### Subagent 3: The "Database Engineer" (API & Storage)
**Focus:** `db/server.ts`, SQLite Database, & Migrations
* Add REST API routes (`GET/PUT /integrations/activepieces`) to securely store and retrieve Activepieces Webhook URLs per project or per agent role.
* > [!IMPORTANT]
  > **User Instruction Included:** Generate the complete DDL (Data Definition Language) and DML (Data Manipulation Language) scripts for the entire current system, including the default tables (tasks, agents, logs) AND the new tables/columns required for storing these new integrations. Save this as a clear `.sql` migration file for review.

---

### Subagent 4: The "Frontend Developer"
**Focus:** `src/` (React/Vite UI)
* Build a new "Integrations" tab inside the Settings modal where users can configure their Activepieces URLs and API keys.
* Update the "Agents" configuration tab so users can assign specific Webhook tools to specific custom agents via checkboxes.

## Verification Plan

### Automated Tests
* Run `pnpm test` to ensure the core orchestrator routing is unaffected.
* Run `pnpm run typecheck` to verify the new tool schemas and API boundaries.

### Manual Verification
* The user will manually configure a test Activepieces webhook.
* We will spawn a test task: "Trigger the webhook to send a test message".
* We will observe the Piranha UI to ensure the agent correctly uses the `trigger_activepieces_webhook` tool instead of trying to write a node script.
