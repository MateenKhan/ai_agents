// ─────────────────────────────────────────────────────────────────────────────
// agentic-core — per-task log files
//
// Every task owns ONE append-only log file at `<logsDir>/<projectId>/<taskId>.log`.
// It spans the whole pipeline (plan → build → qa → review) rather than one agent run,
// because a task is what a human follows; the agent slot that happens to be executing
// it is an implementation detail. The per-slot `<agentName>.log` still exists for the
// live "what is agent-3 doing right now" tail, but it is truncated on every run and is
// reused by unrelated tasks — it cannot be a task's history.
//
// The resulting absolute path is persisted in `tasks.logPath`, so the file is found by
// reading the row back, not by recomputing it from live state. That is what makes it
// survive a UI reload, a db-server crash, and a change to logsDir.
// ─────────────────────────────────────────────────────────────────────────────
import { join, resolve, sep } from 'node:path';
import { getConfig } from '../runtime-context';

/** Absolute, symlink-free logs root. */
export function logsRoot(): string { return resolve(getConfig().paths.logsDir); }

/** Reduce one untrusted id to a single safe path segment. `projectId`/`taskId` reach us from
 *  the DB and (for the read endpoint) from a URL, so `..`, separators and drive letters must
 *  not survive. Anything outside [A-Za-z0-9._-] becomes `_`; a leading dot is neutralised. */
export function safeSegment(id: string): string | null {
  const s = String(id ?? '').replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '_');
  return s.length > 0 && s.length <= 200 ? s : null;
}

/** The absolute per-task log path. Returns null when either id cannot be made safe. */
export function taskLogPath(projectId: string | null | undefined, taskId: string): string | null {
  const p = safeSegment(projectId || 'default');
  const t = safeSegment(taskId);
  if (!p || !t) return null;
  return join(logsRoot(), p, `${t}.log`);
}

/** True when `candidate` resolves to a path inside the logs root. Guards the read endpoint:
 *  `tasks.logPath` is data, and data written by an older/other build must not be able to
 *  point the server at `C:\Users\…\.ssh\id_rsa`. Compares with a trailing separator so
 *  `<root>-evil` does not pass a naive prefix test. */
export function isInsideLogsRoot(candidate: string): boolean {
  const root = logsRoot();
  const p = resolve(candidate);
  return p === root || p.startsWith(root.endsWith(sep) ? root : root + sep);
}
