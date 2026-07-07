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
    ready = true;
    seedIfEmpty(conn);
  }
  return conn;
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
  };
}

function insert(conn: DatabaseSync, a: AgentConfig): void {
  conn.prepare(`INSERT OR REPLACE INTO agents
    (role,label,enabled,model,worktreeMode,ord,isSystem,promptTemplate,mergePromptTemplate)
    VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(a.role, a.label, a.enabled ? 1 : 0, a.model, a.worktreeMode, a.ord, a.isSystem ? 1 : 0,
      a.promptTemplate, a.mergePromptTemplate ?? null);
}

/** Seed defaults on first run; self-heal a missing architect merge template. */
function seedIfEmpty(conn: DatabaseSync): void {
  const count = (conn.prepare(`SELECT COUNT(*) c FROM agents`).get() as any)?.c ?? 0;
  if (count === 0) {
    for (const a of DEFAULT_AGENTS) insert(conn, a);
    return;
  }
  // Self-heal: ensure the architect carries a merge template (merge is its job).
  const arch = conn.prepare(`SELECT mergePromptTemplate FROM agents WHERE role = 'architect'`).get() as any;
  if (arch && !arch.mergePromptTemplate) {
    const def = DEFAULT_AGENTS.find(a => a.role === 'architect');
    if (def?.mergePromptTemplate) {
      conn.prepare(`UPDATE agents SET mergePromptTemplate = ? WHERE role = 'architect'`).run(def.mergePromptTemplate);
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
