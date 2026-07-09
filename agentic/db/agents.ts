// ─────────────────────────────────────────────────────────────────────────────
// agentic-core — agents config (editable from the UI Agents tab)
// Per-role model / worktree / prompt templates, stored in tasks.db and seeded
// from DEFAULT_AGENTS. The orchestrator reads these to render prompts and tier models.
// ─────────────────────────────────────────────────────────────────────────────

import type { AgentConfig, AgentRole, WorktreeMode } from '../types';
import type { Store } from './store';
import { getStore, ensureMigrated } from './getStore';
import { DEFAULT_AGENTS } from './defaults';

// Bump when the built-in SYSTEM prompt/merge templates in defaults.ts change in a way
// existing installs must pick up (their agents table was seeded once and never refreshed).
// refreshSystemTemplates() overwrites ONLY the templates of system roles, preserving each
// user's tuned enabled/model/worktreeMode/ord.
//   v2: merge = abort-on-conflict + dev rebase.
// (The SEARCH protocol text is rendered live from prompts.ts via {{searchProtocol}}, so
//  changing it needs no bump — only stored-template changes do.)
//   v3: architect gains a rescuePromptTemplate (re-plan a task whose dev/qa exhausted retries).
//   v4: dev/qa learn to CALL FOR HELP — self-report a block by handing to stage="rescue".
const SYSTEM_TEMPLATE_VERSION = 4;

// Seed DEFAULT_AGENTS + roll templates forward exactly once per process (the work the
// old lazy `db()` did on first access). Table creation itself lives in runMigrations.
let seedPromise: Promise<void> | null = null;
async function store(): Promise<Store> {
  await ensureMigrated('tasks');
  const s = getStore('tasks');
  if (!seedPromise) seedPromise = (async () => { await seedIfEmpty(s); await refreshSystemTemplates(s); })();
  await seedPromise;
  return s;
}

/** Roll forward system-role templates when SYSTEM_TEMPLATE_VERSION advances. Overwrites
 *  promptTemplate + mergePromptTemplate for isSystem roles only; leaves user-tuned model /
 *  worktreeMode / enabled / ord untouched. (Full manual reset stays available via resetAgents.) */
async function refreshSystemTemplates(s: Store): Promise<void> {
  const row = await s.get(`SELECT v FROM agent_meta WHERE k = 'templateVersion'`) as any;
  const cur = row ? (parseInt(row.v) || 0) : 0;
  if (cur >= SYSTEM_TEMPLATE_VERSION) return;
  for (const a of DEFAULT_AGENTS) {
    await s.run(`UPDATE agents SET promptTemplate = ?, mergePromptTemplate = ?, rescuePromptTemplate = ? WHERE role = ? AND isSystem = 1`,
      [a.promptTemplate, a.mergePromptTemplate ?? null, a.rescuePromptTemplate ?? null, a.role]);
  }
  await s.run(`INSERT OR REPLACE INTO agent_meta (k, v) VALUES ('templateVersion', ?)`, [String(SYSTEM_TEMPLATE_VERSION)]);
}

function rowToAgent(r: any): AgentConfig {
  return {
    role: r.role as AgentRole,
    label: r.label,
    enabled: !!r.enabled,
    model: r.model,
    worktreeMode: r.worktreeMode as WorktreeMode,
    ord: r.ord,
    isSystem: !!r.isSystem,
    promptTemplate: r.promptTemplate,
    mergePromptTemplate: r.mergePromptTemplate ?? undefined,
    rescuePromptTemplate: r.rescuePromptTemplate ?? undefined,
  };
}

async function insert(s: Store, a: AgentConfig): Promise<void> {
  await s.run(`INSERT OR REPLACE INTO agents
    (role,label,enabled,model,worktreeMode,ord,isSystem,promptTemplate,mergePromptTemplate,rescuePromptTemplate)
    VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [a.role, a.label, a.enabled ? 1 : 0, a.model, a.worktreeMode, a.ord, a.isSystem ? 1 : 0,
      a.promptTemplate, a.mergePromptTemplate ?? null, a.rescuePromptTemplate ?? null]);
}

/** Seed defaults on first run; self-heal a missing architect merge template. */
async function seedIfEmpty(s: Store): Promise<void> {
  const count = (await s.get(`SELECT COUNT(*) c FROM agents`) as any)?.c ?? 0;
  if (count === 0) {
    for (const a of DEFAULT_AGENTS) await insert(s, a);
    return;
  }
  // Self-heal: ensure the architect carries its merge + rescue templates (both are its job).
  const arch = await s.get(`SELECT mergePromptTemplate, rescuePromptTemplate FROM agents WHERE role = 'architect'`) as any;
  const def = DEFAULT_AGENTS.find(a => a.role === 'architect');
  if (arch && def) {
    if (!arch.mergePromptTemplate && def.mergePromptTemplate) {
      await s.run(`UPDATE agents SET mergePromptTemplate = ? WHERE role = 'architect'`, [def.mergePromptTemplate]);
    }
    if (!arch.rescuePromptTemplate && def.rescuePromptTemplate) {
      await s.run(`UPDATE agents SET rescuePromptTemplate = ? WHERE role = 'architect'`, [def.rescuePromptTemplate]);
    }
  }
}

export async function getAgents(): Promise<AgentConfig[]> {
  const s = await store();
  return (await s.all(`SELECT * FROM agents ORDER BY ord`) as any[]).map(rowToAgent);
}

export async function getAgent(role: AgentRole): Promise<AgentConfig | null> {
  const s = await store();
  const r = await s.get(`SELECT * FROM agents WHERE role = ?`, [role]) as any;
  return r ? rowToAgent(r) : null;
}

export async function upsertAgent(a: AgentConfig): Promise<void> {
  await insert(await store(), a);
}

export async function updateAgent(role: AgentRole, updates: Partial<AgentConfig>): Promise<void> {
  const current = await getAgent(role);
  if (!current) throw new Error(`Agent not found: ${role}`);
  await insert(await store(), { ...current, ...updates, role });
}

/** Delete a custom agent (system roles are protected). */
export async function deleteAgent(role: string): Promise<void> {
  const s = await store();
  await s.run(`DELETE FROM agents WHERE role = ? AND isSystem = 0`, [role]);
}

/** Restore the built-in defaults (used by a "reset" button in the UI). */
export async function resetAgents(): Promise<void> {
  const s = await store();
  await s.exec(`DELETE FROM agents`);
  for (const a of DEFAULT_AGENTS) await insert(s, a);
}
