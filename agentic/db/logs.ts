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

export interface AgentLog {
  id?: number;
  taskId: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  timestamp: string;
}

/** The active logs-group Store, with schema guaranteed. */
async function store(): Promise<Store> {
  await ensureMigrated('logs');
  return getStore('logs');
}

/** Raw logs.db connection (for the SQLite-only DB-browser endpoints). Schema is ensured
 *  at boot via ensureMigrated('logs'); this just hands back the shared WAL handle. */
export function getLogsDb(): DatabaseSync { return openDb(getConfig().paths.logsDbPath); }

export async function addAgentLog(taskId: string, message: string, type: AgentLog['type'] = 'info'): Promise<void> {
  const s = await store();
  await s.run(`INSERT INTO agent_logs (taskId, message, type, timestamp) VALUES (?,?,?,?)`,
    [taskId, message, type, new Date().toISOString()]);
}

export async function getAgentLogs(taskId: string, limit = 200): Promise<AgentLog[]> {
  const s = await store();
  const rows = await s.all(`SELECT * FROM agent_logs WHERE taskId = ? ORDER BY id DESC LIMIT ?`,
    [taskId, limit]) as unknown as AgentLog[];
  return rows.reverse();
}

/** The most recent log rows across ALL tasks, newest-first — for the orchestrator/system
 *  event feed in /system-status. Shape matches the event contract: { ts, taskId, msg, type }. */
export async function getRecentLogs(limit = 15): Promise<Array<{ id: number; ts: string; taskId: string; msg: string; type: string }>> {
  const s = await store();
  const rows = await s.all(`SELECT id, taskId, message, type, timestamp FROM agent_logs ORDER BY id DESC LIMIT ?`,
    [limit]) as any[];
  return rows.map(r => ({ id: r.id, ts: r.timestamp, taskId: r.taskId, msg: r.message, type: r.type }));
}

/** Delete one event row by id — for the status-widget "dismiss" action. Returns rows removed. */
export async function deleteAgentLog(id: number): Promise<number> {
  const s = await store();
  const before = (await s.get(`SELECT COUNT(*) c FROM agent_logs WHERE id = ?`, [id]) as any)?.c ?? 0;
  await s.run(`DELETE FROM agent_logs WHERE id = ?`, [id]);
  return Number(before);
}

/** Clear the whole event feed (all agent_logs rows). Returns rows removed. */
export async function clearAgentLogs(): Promise<number> {
  const s = await store();
  const n = (await s.get(`SELECT COUNT(*) c FROM agent_logs`) as any)?.c ?? 0;
  await s.run(`DELETE FROM agent_logs`);
  return n;
}

/** Purge a task's log history after human approval — one compact line remains. */
export async function purgeTaskLogs(taskId: string): Promise<number> {
  const s = await store();
  const n = (await s.get(`SELECT COUNT(*) c FROM agent_logs WHERE taskId = ?`, [taskId]) as any)?.c ?? 0;
  await s.run(`DELETE FROM agent_logs WHERE taskId = ?`, [taskId]);
  await s.run(`INSERT INTO agent_logs (taskId, message, type, timestamp) VALUES (?,?,?,?)`,
    [taskId, `Approved by human — work accepted, ${n} history rows purged`, 'success', new Date().toISOString()]);
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
