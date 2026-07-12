// ─────────────────────────────────────────────────────────────────────────────
// agentic-core — declarative default DML
//
// The ONE source of truth for "what does a fresh install contain". Both the boot path
// (runMigrations → seedDefaults) and the UI's "restore defaults" button read from here,
// so the two can never drift. Before this existed, `board_settings` had no declared
// defaults at all — rows simply accreted as code wrote them, which meant "restore to
// defaults" had nothing to restore to.
//
// WHAT IS **NOT** RESTORABLE, and why. Getting this wrong destroys real work:
//
//   projects        NEVER. The migration seeds `default` with repoPath = process.cwd(),
//                   which is Piranha's OWN source tree. A user's `default` project points
//                   at their cloned repo. Resetting it would silently repoint the project
//                   at this repo and turn the agents loose on the orchestrator's own code.
//   tasks           NEVER. That is the user's work, not a default.
//   board_settings  Only the keys in DEFAULT_BOARD_SETTINGS. `heartbeat` is live runtime
//                   state, `code_index:<project>` points at a real checkout, and `default`
//                   holds the orchestrator's run/pause state. None are configuration.
//
// A `delete` (factory reset) ALSO clears ORPHANED logs.db telemetry (agent_logs,
// agent_db_usage): rows for tasks no longer on the board, plus the __system__ orchestrator
// noise. It KEEPS the run history of any task still on the board — failed, completed, or
// waiting for review — so a reset never destroys logs you might still want to read. It is
// best-effort: a busy logs.db leaves the history and the reset still succeeds. `overwrite`
// touches no logs at all.
// ─────────────────────────────────────────────────────────────────────────────

import type { Store } from './store';
import { upsert } from './store';
import { DEFAULT_AGENTS } from './defaults';
import { getStore, ensureMigrated } from './getStore';
import { insertAgent } from './agents';

/** How a restore treats rows that already exist. */
export type RestoreMode =
  /** Upsert the defaults over whatever is there. Rows the user added (custom agents) survive;
   *  built-in rows the user edited are reverted. The safe, everyday choice. */
  | 'overwrite'
  /** Delete every row in scope, then insert the defaults. Custom agents are removed. A true
   *  factory reset of the seeded tables — and only the seeded tables. */
  | 'delete';

/** Which tables a restore is allowed to touch at all. Anything absent is untouchable. */
export const RESTORABLE_TABLES = ['agents', 'board_settings'] as const;
export type RestorableTable = (typeof RESTORABLE_TABLES)[number];

/** Disposable telemetry in logs.db, wiped by a `delete` (factory reset) but NOT by `overwrite`.
 *  These are run history / usage audit — not configuration and not user work. logs.db is
 *  gitignored and rebuilds itself as agents run, so clearing it is always safe. `overwrite`
 *  leaves them so the everyday "revert my config" does not also erase the run history. */
export const TRANSIENT_LOG_TABLES = ['agent_logs', 'agent_db_usage'] as const;

/** The only `board_settings` keys that are configuration. Everything else in that table is
 *  runtime state or points at a real checkout — see the header. */
export const DEFAULT_BOARD_SETTINGS: Readonly<Record<string, unknown>> = Object.freeze({
  agent_defaults: { maxConcurrency: 0, permissionProfile: 'standard', taskCapUsd: 2, dailyCapUsd: 25 },
});

/** Keys a restore may delete/overwrite in board_settings. Derived, so adding a default above
 *  automatically makes it restorable and nothing else ever becomes restorable by accident. */
export const RESTORABLE_SETTING_KEYS: readonly string[] = Object.freeze(Object.keys(DEFAULT_BOARD_SETTINGS));

/** True when a board_settings row is configuration this module owns. */
export function isRestorableSettingKey(id: string): boolean {
  return RESTORABLE_SETTING_KEYS.includes(id);
}

export interface RestoreResult {
  mode: RestoreMode;
  agents: { deleted: number; written: number };
  boardSettings: { deleted: number; written: number };
  /** Rows removed from the disposable logs.db telemetry — only non-zero for `delete`.
   *  `error` is set (and deleted stays 0) when logs.db was busy/unreadable: the reset still
   *  succeeds, the run history is just left in place. */
  logs: { deleted: number; error?: string };
  /** Named so the caller can show the user exactly what was spared. */
  untouched: string[];
}

async function writeBoardSetting(s: Store, id: string, value: unknown): Promise<void> {
  await upsert(s, 'board_settings', { id, data: JSON.stringify(value) }, ['id']);
}

/** Idempotent "make sure the defaults exist" — the boot path. Never overwrites anything the
 *  user has changed: an existing row wins. Called from runMigrations. */
export async function seedDefaults(s: Store): Promise<void> {
  for (const [id, value] of Object.entries(DEFAULT_BOARD_SETTINGS)) {
    const existing = await s.get(`SELECT id FROM board_settings WHERE id = ?`, [id]);
    if (!existing) await writeBoardSetting(s, id, value);
  }
  // Agents seed themselves per-role in agents.ts (it also backfills roles added later),
  // so there is nothing to do for them here.
}

/**
 * Restore the seeded tables to their declared defaults.
 *
 * `overwrite` upserts the defaults and leaves everything else alone.
 * `delete` removes the in-scope rows first, so custom agents do not survive.
 *
 * In BOTH modes, `projects`, `tasks`, and the non-configuration `board_settings` rows are
 * never read and never written. The blast radius is the two tables above, and within
 * board_settings only the keys this module declares.
 */
export async function restoreDefaults(mode: RestoreMode): Promise<RestoreResult> {
  await ensureMigrated('tasks');
  const s = getStore('tasks');

  const result: RestoreResult = {
    mode,
    agents: { deleted: 0, written: 0 },
    boardSettings: { deleted: 0, written: 0 },
    logs: { deleted: 0 },
    untouched: ['projects', 'tasks', 'memory', 'git_tokens', 'github_apps', 'workers', 'locks'],
  };

  // ── agents + board_settings ─────────────────────────────────────────────────
  // Both live in tasks.db, so do them as ONE transaction: a failure can't leave a
  // half-reseeded roster with the old settings, or vice versa. (logs.db is a separate
  // file, handled best-effort below — it can never join this transaction.)
  await s.tx(async t => {
    if (mode === 'delete') {
      const before = Number((await t.get(`SELECT COUNT(*) c FROM agents`) as any)?.c ?? 0);
      await t.exec(`DELETE FROM agents`);
      result.agents.deleted = before;
    }
    for (const a of DEFAULT_AGENTS) {
      await insertAgent(t, a); // upsert on role — safe in both modes
      result.agents.written++;
    }

    // board_settings — declared config keys ONLY.
    if (mode === 'delete') {
      for (const id of RESTORABLE_SETTING_KEYS) {
        const row = await t.get(`SELECT id FROM board_settings WHERE id = ?`, [id]);
        if (row) {
          await t.run(`DELETE FROM board_settings WHERE id = ?`, [id]);
          result.boardSettings.deleted++;
        }
      }
    }
    for (const [id, value] of Object.entries(DEFAULT_BOARD_SETTINGS)) {
      await writeBoardSetting(t, id, value);
      result.boardSettings.written++;
    }
  });

  // ── logs.db telemetry (delete-mode only) ────────────────────────────────────
  // Best-effort: logs.db is a SEPARATE file AND the orchestrator's hot path, so a busy or
  // unreadable logs.db must NOT fail the reset — the config above already succeeded and is
  // what matters. We KEEP any row tied to a task still on the board (a failed, completed, or
  // in-review task keeps its run history) and delete only orphans: rows for tasks that no
  // longer exist, plus the taskId='__system__' orchestrator noise.
  if (mode === 'delete') {
    try {
      const live = (await s.all(`SELECT id FROM tasks`) as Array<{ id: string }>).map(r => r.id);
      await ensureMigrated('logs');
      const logs = getStore('logs');
      for (const table of TRANSIENT_LOG_TABLES) {
        // `NOT IN ()` is a syntax error; an empty board means every row is an orphan.
        const where = live.length ? `WHERE taskId NOT IN (${live.map(() => '?').join(',')})` : '';
        const before = Number((await logs.get(`SELECT COUNT(*) c FROM ${table} ${where}`, live) as any)?.c ?? 0);
        await logs.run(`DELETE FROM ${table} ${where}`, live);
        result.logs.deleted += before;
      }
    } catch (e: any) {
      result.logs.error = String(e?.message || e);
    }
  }

  return result;
}

/**
 * What a restore WOULD do, without doing it. The UI shows this before asking the user to
 * confirm, because `delete` silently removes custom agents and a count is the only honest
 * way to say so.
 */
export async function previewRestore(mode: RestoreMode): Promise<{
  mode: RestoreMode;
  customAgentsRemoved: string[];
  builtInAgentsReverted: string[];
  settingsReverted: string[];
  /** logs.db tables cleared, with their current row counts — only for `delete`. */
  logsCleared: string[];
  untouched: string[];
}> {
  await ensureMigrated('tasks');
  const s = getStore('tasks');

  const rows = (await s.all(`SELECT role, isSystem FROM agents`)) as Array<{ role: string; isSystem: number | boolean }>;
  const builtIn = new Set(DEFAULT_AGENTS.map(a => a.role));
  const custom = rows.map(r => r.role).filter(r => !builtIn.has(r as any));

  // logs.db lives in its own database — read the ORPHAN counts (rows a delete would actually
  // remove: not tied to any live task), so the preview matches what runs. Delete-mode only.
  let logsCleared: string[] = [];
  if (mode === 'delete') {
    const live = (await s.all(`SELECT id FROM tasks`) as Array<{ id: string }>).map(r => r.id);
    await ensureMigrated('logs');
    const logs = getStore('logs');
    logsCleared = await Promise.all(TRANSIENT_LOG_TABLES.map(async table => {
      const where = live.length ? `WHERE taskId NOT IN (${live.map(() => '?').join(',')})` : '';
      const c = Number((await logs.get(`SELECT COUNT(*) c FROM ${table} ${where}`, live) as any)?.c ?? 0);
      return `${table} (${c} ${c === 1 ? 'row' : 'rows'})`;
    }));
  }

  return {
    mode,
    // `overwrite` keeps custom agents; `delete` wipes the table first, so they go.
    customAgentsRemoved: mode === 'delete' ? custom : [],
    builtInAgentsReverted: DEFAULT_AGENTS.map(a => a.role),
    settingsReverted: [...RESTORABLE_SETTING_KEYS],
    logsCleared,
    untouched: ['projects', 'tasks', 'memory', 'git_tokens', 'github_apps', 'workers', 'locks',
                'board_settings: heartbeat, code_index:*, default'],
  };
}
