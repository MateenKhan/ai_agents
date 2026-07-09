// ─────────────────────────────────────────────────────────────────────────────
// agentic-core — agents config (editable from the UI Agents tab)
// Per-role model / worktree / prompt templates, stored in tasks.db and seeded
// from DEFAULT_AGENTS. The orchestrator reads these to render prompts and tier models.
// ─────────────────────────────────────────────────────────────────────────────

import type { DatabaseSync } from 'node:sqlite';
import type { AgentConfig, AgentRole, WorktreeMode } from '../types';
import { getConfig } from '../runtime-context';
import { openDb } from './connection';
import { DEFAULT_AGENTS } from './defaults';

let ready = false;

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

function db(): DatabaseSync {
  const conn = openDb(getConfig().paths.tasksDbPath);
  if (!ready) {
    conn.exec(`CREATE TABLE IF NOT EXISTS agents (
      role TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      model TEXT NOT NULL,
      worktreeMode TEXT NOT NULL,
      ord INTEGER NOT NULL DEFAULT 0,
      isSystem INTEGER NOT NULL DEFAULT 0,
      promptTemplate TEXT NOT NULL,
      mergePromptTemplate TEXT
    )`);
    // Additive migration for installs created before rescuePromptTemplate existed.
    try { conn.exec(`ALTER TABLE agents ADD COLUMN rescuePromptTemplate TEXT`); } catch { /* already present */ }
    conn.exec(`CREATE TABLE IF NOT EXISTS agent_meta (k TEXT PRIMARY KEY, v TEXT)`);
    ready = true;
    seedIfEmpty(conn);
    refreshSystemTemplates(conn);
  }
  return conn;
}

/** Roll forward system-role templates when SYSTEM_TEMPLATE_VERSION advances. Overwrites
 *  promptTemplate + mergePromptTemplate for isSystem roles only; leaves user-tuned model /
 *  worktreeMode / enabled / ord untouched. (Full manual reset stays available via resetAgents.) */
function refreshSystemTemplates(conn: DatabaseSync): void {
  const row = conn.prepare(`SELECT v FROM agent_meta WHERE k = 'templateVersion'`).get() as any;
  const cur = row ? (parseInt(row.v) || 0) : 0;
  if (cur >= SYSTEM_TEMPLATE_VERSION) return;
  const upd = conn.prepare(`UPDATE agents SET promptTemplate = ?, mergePromptTemplate = ?, rescuePromptTemplate = ? WHERE role = ? AND isSystem = 1`);
  for (const a of DEFAULT_AGENTS) upd.run(a.promptTemplate, a.mergePromptTemplate ?? null, a.rescuePromptTemplate ?? null, a.role);
  conn.prepare(`INSERT OR REPLACE INTO agent_meta (k, v) VALUES ('templateVersion', ?)`).run(String(SYSTEM_TEMPLATE_VERSION));
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

function insert(conn: DatabaseSync, a: AgentConfig): void {
  conn.prepare(`INSERT OR REPLACE INTO agents
    (role,label,enabled,model,worktreeMode,ord,isSystem,promptTemplate,mergePromptTemplate,rescuePromptTemplate)
    VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(a.role, a.label, a.enabled ? 1 : 0, a.model, a.worktreeMode, a.ord, a.isSystem ? 1 : 0,
      a.promptTemplate, a.mergePromptTemplate ?? null, a.rescuePromptTemplate ?? null);
}

/** Seed defaults on first run; self-heal a missing architect merge template. */
function seedIfEmpty(conn: DatabaseSync): void {
  const count = (conn.prepare(`SELECT COUNT(*) c FROM agents`).get() as any)?.c ?? 0;
  if (count === 0) {
    for (const a of DEFAULT_AGENTS) insert(conn, a);
    return;
  }
  // Self-heal: ensure the architect carries its merge + rescue templates (both are its job).
  const arch = conn.prepare(`SELECT mergePromptTemplate, rescuePromptTemplate FROM agents WHERE role = 'architect'`).get() as any;
  const def = DEFAULT_AGENTS.find(a => a.role === 'architect');
  if (arch && def) {
    if (!arch.mergePromptTemplate && def.mergePromptTemplate) {
      conn.prepare(`UPDATE agents SET mergePromptTemplate = ? WHERE role = 'architect'`).run(def.mergePromptTemplate);
    }
    if (!arch.rescuePromptTemplate && def.rescuePromptTemplate) {
      conn.prepare(`UPDATE agents SET rescuePromptTemplate = ? WHERE role = 'architect'`).run(def.rescuePromptTemplate);
    }
  }
}

export function getAgents(): AgentConfig[] {
  return (db().prepare(`SELECT * FROM agents ORDER BY ord`).all() as any[]).map(rowToAgent);
}

export function getAgent(role: AgentRole): AgentConfig | null {
  const r = db().prepare(`SELECT * FROM agents WHERE role = ?`).get(role) as any;
  return r ? rowToAgent(r) : null;
}

export function upsertAgent(a: AgentConfig): void {
  insert(db(), a);
}

export function updateAgent(role: AgentRole, updates: Partial<AgentConfig>): void {
  const current = getAgent(role);
  if (!current) throw new Error(`Agent not found: ${role}`);
  insert(db(), { ...current, ...updates, role });
}

/** Delete a custom agent (system roles are protected). */
export function deleteAgent(role: string): void {
  db().prepare(`DELETE FROM agents WHERE role = ? AND isSystem = 0`).run(role);
}

/** Restore the built-in defaults (used by a "reset" button in the UI). */
export function resetAgents(): void {
  const conn = db();
  conn.exec(`DELETE FROM agents`);
  for (const a of DEFAULT_AGENTS) insert(conn, a);
}
