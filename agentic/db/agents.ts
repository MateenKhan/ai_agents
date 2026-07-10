// ─────────────────────────────────────────────────────────────────────────────
// agentic-core — agents config (editable from the UI Agents tab)
// Per-role model / worktree / prompt templates, stored in tasks.db and seeded
// from DEFAULT_AGENTS. The orchestrator reads these to render prompts and tier models.
// ─────────────────────────────────────────────────────────────────────────────

import type { AgentConfig, AgentRole, WorktreeMode } from '../types';
import type { Store } from './store';
import { upsert } from './store';
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
// Bump to roll new system-role templates onto existing installs.
//   5 = business owner role (intake + accept templates)
//   6 = agents report an OUTCOME instead of naming a stage. Twelve hard-coded `"stage":"..."`
//       strings are gone, so a stage can be renamed without touching a single prompt.
const SYSTEM_TEMPLATE_VERSION = 6;

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
    await s.run(`UPDATE agents SET promptTemplate = ?, mergePromptTemplate = ?, rescuePromptTemplate = ?, acceptPromptTemplate = ? WHERE role = ? AND isSystem = 1`,
      [a.promptTemplate, a.mergePromptTemplate ?? null, a.rescuePromptTemplate ?? null, a.acceptPromptTemplate ?? null, a.role]);
  }
  await upsert(s, 'agent_meta', { k: 'templateVersion', v: String(SYSTEM_TEMPLATE_VERSION) }, ['k']);
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
    acceptPromptTemplate: r.acceptPromptTemplate ?? undefined,
  };
}

/** Upsert one agent row (keyed on `role`). Exported for the declarative seed/restore path,
 *  which must write the SAME row shape this module reads back — a second, hand-rolled INSERT
 *  in seed.ts would be the obvious place for the two to drift. */
export async function insertAgent(s: Store, a: AgentConfig): Promise<void> {
  return insert(s, a);
}

async function insert(s: Store, a: AgentConfig): Promise<void> {
  await upsert(s, 'agents', {
    role: a.role, label: a.label, enabled: a.enabled ? 1 : 0, model: a.model,
    worktreeMode: a.worktreeMode, ord: a.ord, isSystem: a.isSystem ? 1 : 0,
    promptTemplate: a.promptTemplate,
    mergePromptTemplate: a.mergePromptTemplate ?? null,
    rescuePromptTemplate: a.rescuePromptTemplate ?? null,
    acceptPromptTemplate: a.acceptPromptTemplate ?? null,
  }, ['role']);
}

/** Seed defaults on first run, backfill any system role added since the DB was created, and
 *  self-heal missing stage templates.
 *
 *  The empty-table check alone is not enough: an existing install has rows, so a NEW system
 *  role (the business owner) would silently never be inserted, and the orchestrator would
 *  look up an agent that isn't there. Backfill by role, not by table emptiness. */
async function seedIfEmpty(s: Store): Promise<void> {
  const have = new Set(((await s.all(`SELECT role FROM agents`)) as any[]).map(r => r.role));
  for (const a of DEFAULT_AGENTS) if (!have.has(a.role)) await insert(s, a);

  // Self-heal per-stage templates for system roles that predate them (architect's merge +
  // rescue, the owner's accept). A role can exist with a NULL template if it was inserted
  // before that column/stage was introduced.
  for (const def of DEFAULT_AGENTS) {
    const row = await s.get(
      `SELECT mergePromptTemplate, rescuePromptTemplate, acceptPromptTemplate FROM agents WHERE role = ? AND isSystem = 1`,
      [def.role],
    ) as any;
    if (!row) continue;
    if (!row.mergePromptTemplate && def.mergePromptTemplate) {
      await s.run(`UPDATE agents SET mergePromptTemplate = ? WHERE role = ?`, [def.mergePromptTemplate, def.role]);
    }
    if (!row.rescuePromptTemplate && def.rescuePromptTemplate) {
      await s.run(`UPDATE agents SET rescuePromptTemplate = ? WHERE role = ?`, [def.rescuePromptTemplate, def.role]);
    }
    if (!row.acceptPromptTemplate && def.acceptPromptTemplate) {
      await s.run(`UPDATE agents SET acceptPromptTemplate = ? WHERE role = ?`, [def.acceptPromptTemplate, def.role]);
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
