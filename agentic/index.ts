// ─────────────────────────────────────────────────────────────────────────────
// agentic-core — public API barrel
//
// The host imports everything from here (and only here). Keeping one entry point
// is what makes this folder liftable into a standalone npm package later:
// swap the relative import for `from 'agentic-core'` and nothing else changes.
// ─────────────────────────────────────────────────────────────────────────────

export * from './types';
export { buildConfig, DEFAULT_MODELS } from './config';
export { setConfig, getConfig } from './runtime-context';

// DB layer
export * from './db/tasks';
export * from './db/logs';
export { createOwnedMemory } from './db/memory';
export {
  keepInContext, touchContext, removeFromContext, setPinned, listContext,
  contextStats, enforceCap, sweepContext, sweepAllContext, getFileUsage,
  getContextOps, estimateTokens, DEFAULT_CONTEXT_CAP,
} from './db/context';
export type { ContextFile, ContextOpRow, ContextStats, FileUsage, SweepResult, ContextOp } from './db/context';
export { getAgents, getAgent, upsertAgent, updateAgent, deleteAgent, resetAgents } from './db/agents';
export { DEFAULT_AGENTS } from './db/defaults';

// Engine
export {
  spawnHeadlessAgent, isAgentBusy, isTaskRunning, agentIdleMs, killAgent,
  removeWorktree, removePlanWorktree, pruneOrphans,
} from './engine/runner';
export type { SpawnOptions } from './engine/runner';
export { startOrchestrator } from './engine/orchestrator';
export { renderPrompt } from './engine/prompts';

// Methodology seam — superpowers skill library (obra/superpowers)
export {
  superpowersMethodology, superpowersPreamble, skillsForRole,
  ROLE_SKILLS, DEFAULT_SKILLS, SKILL_DESCRIPTIONS,
} from './methodology/superpowers';
