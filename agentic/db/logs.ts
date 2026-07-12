// ─────────────────────────────────────────────────────────────────────────────
// agentic-core — logs.db (gitignored, disposable)
// Verbose per-task run history + per-agent index-usage audit. Kept OUT of tasks.db
// so the committable DB stays small. Safe to delete; it rebuilds as agents run.
// ─────────────────────────────────────────────────────────────────────────────

import type { DatabaseSync } from 'node:sqlite';
import { getConfig } from '../runtime-context';
import { openDb } from './connection';
import type { Store } from './store';
import { getStore, ensureMigrated } from './getStore';
import { redactSecrets } from '../redact';

export interface AgentLog {
  id?: number;
  taskId: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  timestamp: string;
  /** The project the task belonged to when the line was written. NULL for `__system__`
   *  orchestrator lines and for rows written before this column existed. */
  projectId?: string | null;
}

/** The active logs-group Store, with schema guaranteed. */
async function store(): Promise<Store> {
  await ensureMigrated('logs');
  return getStore('logs');
}

/** Raw logs.db connection (for the SQLite-only DB-browser endpoints). Schema is ensured
 *  at boot via ensureMigrated('logs'); this just hands back the shared WAL handle. */
export function getLogsDb(): DatabaseSync { return openDb(getConfig().paths.logsDbPath); }

/** Append one line of run history.
 *
 *  `projectId` is supplied by the caller rather than looked up here on purpose: this module
 *  is the logs-group leaf and must not reach into tasks.db (a lookup per log line would also
 *  put a tasks.db read on the orchestrator's hot path). Callers that own a task already know
 *  its project. Omit it only for `__system__` orchestrator lines, which belong to no project. */
export async function addAgentLog(
  taskId: string,
  message: string,
  type: AgentLog['type'] = 'info',
  projectId?: string | null,
): Promise<void> {
  const s = await store();
  // Redact at the STORAGE layer so no log line — whatever call site produced it — can
  // persist a token in plaintext (security-audit-2026-07 §6b). Centralized here, it is
  // unmissable, unlike the previous scattered per-call-site redaction.
  await s.run(`INSERT INTO agent_logs (taskId, message, type, timestamp, projectId) VALUES (?,?,?,?,?)`,
    [taskId, redactSecrets(message), type, new Date().toISOString(), projectId ?? null]);
}

export async function getAgentLogs(taskId: string, limit = 200): Promise<AgentLog[]> {
  const s = await store();
  const rows = await s.all(`SELECT * FROM agent_logs WHERE taskId = ? ORDER BY id DESC LIMIT ?`,
    [taskId, limit]) as unknown as AgentLog[];
  return rows.reverse();
}

/** The most recent log rows, newest-first — for the orchestrator/system event feed in
 *  /system-status. Shape matches the event contract: { id, ts, taskId, msg, type, projectId }.
 *
 *  Pass `projectId` to scope the feed to one project. `__system__` orchestrator lines carry
 *  no project and are always included, so a project's feed still shows the engine events that
 *  affected it. Omitting `projectId` returns every project's rows (the DB-browser view). */
export async function getRecentLogs(
  limit = 15,
  projectId?: string,
): Promise<Array<{ id: number; ts: string; taskId: string; msg: string; type: string; projectId: string | null }>> {
  const s = await store();
  const where = projectId ? `WHERE (projectId = ? OR taskId = '__system__')` : '';
  const params = projectId ? [projectId, limit] : [limit];
  const rows = await s.all(
    `SELECT id, taskId, message, type, timestamp, projectId FROM agent_logs ${where} ORDER BY id DESC LIMIT ?`,
    params) as any[];
  return rows.map(r => ({ id: r.id, ts: r.timestamp, taskId: r.taskId, msg: r.message, type: r.type, projectId: r.projectId ?? null }));
}

/** Delete one event row by id — for the status-widget "dismiss" action. Returns rows removed. */
export async function deleteAgentLog(id: number): Promise<number> {
  const s = await store();
  const before = (await s.get(`SELECT COUNT(*) c FROM agent_logs WHERE id = ?`, [id]) as any)?.c ?? 0;
  await s.run(`DELETE FROM agent_logs WHERE id = ?`, [id]);
  return Number(before);
}

/** Clear the event feed. With `projectId`, clears exactly the rows getRecentLogs(_, projectId)
 *  would show — that project's rows plus the unscoped `__system__` lines — so "Clear" removes
 *  what the user is looking at and never silently leaves rows behind. Other projects' rows
 *  survive. Without `projectId`, clears everything. Returns rows removed. */
export async function clearAgentLogs(projectId?: string): Promise<number> {
  const s = await store();
  const where = projectId ? ` WHERE (projectId = ? OR taskId = '__system__')` : '';
  const params = projectId ? [projectId] : [];
  const n = Number((await s.get(`SELECT COUNT(*) c FROM agent_logs${where}`, params) as any)?.c ?? 0);
  await s.run(`DELETE FROM agent_logs${where}`, params);
  return n;
}

/** Purge a task's log history after human approval — one compact line remains. */
export async function purgeTaskLogs(taskId: string, projectId?: string | null): Promise<number> {
  const s = await store();
  const n = Number((await s.get(`SELECT COUNT(*) c FROM agent_logs WHERE taskId = ?`, [taskId]) as any)?.c ?? 0);
  // Carry the project forward onto the summary line: purging must not orphan the task's
  // one surviving row from the project feed it belonged to.
  const pid = projectId !== undefined
    ? projectId
    : ((await s.get(`SELECT projectId FROM agent_logs WHERE taskId = ? AND projectId IS NOT NULL LIMIT 1`, [taskId]) as any)?.projectId ?? null);
  await s.run(`DELETE FROM agent_logs WHERE taskId = ?`, [taskId]);
  await s.run(`INSERT INTO agent_logs (taskId, message, type, timestamp, projectId) VALUES (?,?,?,?,?)`,
    [taskId, `Approved by human — work accepted, ${n} history rows purged`, 'success', new Date().toISOString(), pid]);
  return n;
}

export async function recordDbUsage(agentName: string, taskId: string | null, query: string): Promise<void> {
  const s = await store();
  await s.run(`INSERT INTO agent_db_usage (agentName, taskId, query, timestamp) VALUES (?,?,?,?)`,
    [agentName, taskId, query.slice(0, 200), new Date().toISOString()]);
}

export async function getDbUsageCount(agentName: string, taskId: string): Promise<number> {
  const s = await store();
  const r = await s.get(`SELECT COUNT(*) c FROM agent_db_usage WHERE agentName=? AND taskId=?`,
    [agentName, taskId]) as any;
  return r?.c ?? 0;
}

export async function getDbUsageSummary(): Promise<Array<{ agentName: string; searches: number; tasks: number }>> {
  const s = await store();
  return await s.all(`
    SELECT agentName, COUNT(*) as searches, COUNT(DISTINCT taskId) as tasks
    FROM agent_db_usage GROUP BY agentName ORDER BY searches DESC
  `) as any[];
}
