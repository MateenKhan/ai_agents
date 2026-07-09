// ─────────────────────────────────────────────────────────────────────────────
// Compatibility shim — the tasks/logs/memory layer now lives in agentic-core.
// Re-exported here so db/server.ts and other callers keep importing './tasks.js'
// unchanged, while the engine and the app share ONE schema (scenarios/stage) and
// ONE logs split (logs.db). Old free-text `dod` is auto-migrated to a scenario.
// ─────────────────────────────────────────────────────────────────────────────

import { join } from 'node:path';

/** Kept for callers that referenced the path constant. */
export const TASKS_DB_PATH = join(process.cwd(), 'db', 'tasks.db');

export type { Task, Scenario } from '../agentic/types';

// Tasks (scenarios/stage/qaVerdict/docs), board settings, heartbeat.
export * from '../agentic/db/tasks';
// Agent run logs + index-usage audit (in logs.db).
export * from '../agentic/db/logs';

// Names the old module used; both now map to the single async boot init
// (portable migrations + legacy dod→scenario + at-rest secret re-encryption).
export { initTasksSchema, initTasksSchema as runMigrations } from '../agentic/db/tasks';
