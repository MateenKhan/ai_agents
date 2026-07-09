// ─────────────────────────────────────────────────────────────────────────────
// agentic-core — logs.db (gitignored, disposable)
// Verbose per-task run history + per-agent index-usage audit. Kept OUT of tasks.db
// so the committable DB stays small. Safe to delete; it rebuilds as agents run.
// ─────────────────────────────────────────────────────────────────────────────

import type { DatabaseSync } from 'node:sqlite';
import { getConfig } from '../runtime-context';
import { openDb } from './connection';

export interface AgentLog {
  id?: number;
  taskId: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  timestamp: string;
}

let ready = false;

function db(): DatabaseSync {
  const conn = openDb(getConfig().paths.logsDbPath);
  if (!ready) {
    conn.exec(`CREATE TABLE IF NOT EXISTS agent_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      taskId TEXT NOT NULL,
      message TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'info',
      timestamp TEXT NOT NULL
    )`);
    conn.exec(`CREATE INDEX IF NOT EXISTS idx_agent_logs_task ON agent_logs(taskId)`);
    conn.exec(`CREATE TABLE IF NOT EXISTS agent_db_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agentName TEXT NOT NULL,
      taskId TEXT,
      query TEXT,
      timestamp TEXT NOT NULL
    )`);
    conn.exec(`CREATE INDEX IF NOT EXISTS idx_db_usage_agent ON agent_db_usage(agentName)`);
    conn.exec(`CREATE INDEX IF NOT EXISTS idx_db_usage_task ON agent_db_usage(taskId)`);
    ready = true;
  }
  return conn;
}

/** Raw logs.db connection (for the DB-browser endpoints). */
export function getLogsDb() { return db(); }

export function addAgentLog(taskId: string, message: string, type: AgentLog['type'] = 'info'): void {
  db().prepare(`INSERT INTO agent_logs (taskId, message, type, timestamp) VALUES (?,?,?,?)`)
    .run(taskId, message, type, new Date().toISOString());
}

export function getAgentLogs(taskId: string, limit = 200): AgentLog[] {
  const rows = db().prepare(`SELECT * FROM agent_logs WHERE taskId = ? ORDER BY id DESC LIMIT ?`)
    .all(taskId, limit) as unknown as AgentLog[];
  return rows.reverse();
}

/** The most recent log rows across ALL tasks, newest-first — for the orchestrator/system
 *  event feed in /system-status. Shape matches the event contract: { ts, taskId, msg, type }. */
export function getRecentLogs(limit = 15): Array<{ id: number; ts: string; taskId: string; msg: string; type: string }> {
  const rows = db().prepare(`SELECT id, taskId, message, type, timestamp FROM agent_logs ORDER BY id DESC LIMIT ?`)
    .all(limit) as any[];
  return rows.map(r => ({ id: r.id, ts: r.timestamp, taskId: r.taskId, msg: r.message, type: r.type }));
}

/** Delete one event row by id — for the status-widget "dismiss" action. Returns rows removed. */
export function deleteAgentLog(id: number): number {
  const info = db().prepare(`DELETE FROM agent_logs WHERE id = ?`).run(id);
  return Number(info.changes ?? 0);
}

/** Clear the whole event feed (all agent_logs rows). Returns rows removed. */
export function clearAgentLogs(): number {
  const n = (db().prepare(`SELECT COUNT(*) c FROM agent_logs`).get() as any)?.c ?? 0;
  db().prepare(`DELETE FROM agent_logs`).run();
  return n;
}

/** Purge a task's log history after human approval — one compact line remains. */
export function purgeTaskLogs(taskId: string): number {
  const conn = db();
  const n = (conn.prepare(`SELECT COUNT(*) c FROM agent_logs WHERE taskId = ?`).get(taskId) as any)?.c ?? 0;
  conn.prepare(`DELETE FROM agent_logs WHERE taskId = ?`).run(taskId);
  conn.prepare(`INSERT INTO agent_logs (taskId, message, type, timestamp) VALUES (?,?,?,?)`)
    .run(taskId, `Approved by human — work accepted, ${n} history rows purged`, 'success', new Date().toISOString());
  return n;
}

export function recordDbUsage(agentName: string, taskId: string | null, query: string): void {
  db().prepare(`INSERT INTO agent_db_usage (agentName, taskId, query, timestamp) VALUES (?,?,?,?)`)
    .run(agentName, taskId, query.slice(0, 200), new Date().toISOString());
}

export function getDbUsageCount(agentName: string, taskId: string): number {
  const r = db().prepare(`SELECT COUNT(*) c FROM agent_db_usage WHERE agentName=? AND taskId=?`)
    .get(agentName, taskId) as any;
  return r?.c ?? 0;
}

export function getDbUsageSummary(): Array<{ agentName: string; searches: number; tasks: number }> {
  return db().prepare(`
    SELECT agentName, COUNT(*) as searches, COUNT(DISTINCT taskId) as tasks
    FROM agent_db_usage GROUP BY agentName ORDER BY searches DESC
  `).all() as any[];
}
