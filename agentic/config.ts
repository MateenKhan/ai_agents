// ─────────────────────────────────────────────────────────────────────────────
// agentic-core — config builder
// Assembles an AgenticConfig from cwd + env, with the seams left undefined
// (the host wires in graphify / MinIO / superpowers when available).
// ─────────────────────────────────────────────────────────────────────────────

import { join } from 'node:path';
import type { AgenticConfig, AgentRole } from './types';

const envFlag = (name: string, def: boolean): boolean => {
  const v = process.env[name];
  if (v === undefined) return def;
  return v !== '0' && v.toLowerCase() !== 'false';
};

const envInt = (name: string, def: number): number => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : def;
};

/** Default model tier per role. Architect/merge think hard; dev/qa are the workhorses. */
export const DEFAULT_MODELS: Record<AgentRole, string> = {
  architect: process.env.MODEL_ARCHITECT || 'opus',
  dev: process.env.MODEL_DEV || 'sonnet',
  qa: process.env.MODEL_QA || 'sonnet',
};

/** Build a config rooted at `cwd` (defaults to process.cwd()).
 *  Seams (codeIndex/docStore/methodology/control) are attached by the host afterward. */
export function buildConfig(cwd: string = process.cwd()): AgenticConfig {
  return {
    paths: {
      tasksDbPath: join(cwd, 'db', 'tasks.db'),
      logsDbPath: join(cwd, 'db', 'logs.db'),
      worktreesDir: join(cwd, '.worktrees'),
      logsDir: join(cwd, '.agent_logs'),
    },
    models: { ...DEFAULT_MODELS },
    toggles: {
      enableArchitect: envFlag('ENABLE_ARCHITECT', true),
      enableQa: envFlag('ENABLE_QA', true),
      autoMergeOnQaPass: envFlag('AUTO_MERGE_ON_QA_PASS', true),
      maxAttempts: envInt('MAX_ATTEMPTS', 3),
      taskLeaseMs: envInt('TASK_LEASE_MS', 15 * 60 * 1000),
      agentStallMs: envInt('AGENT_STALL_MS', 8 * 60 * 1000),
    },
    qa: {
      testUrl: process.env.QA_TEST_URL || undefined,
      browserTool: (process.env.QA_BROWSER_TOOL as 'playwright' | 'browser-use' | 'chrome-mcp') || 'playwright',
    },
    checks: {
      typecheck: process.env.CHECK_TYPECHECK ?? 'npx tsc --noEmit',
      build: process.env.CHECK_BUILD ?? 'npm run build',
      test: process.env.CHECK_TEST ?? 'npm test',
      lint: process.env.CHECK_LINT || undefined,
    },
  };
}
