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

/** The only `board_settings` keys that are configuration. Everything else in that table is
 *  runtime state or points at a real checkout — see the header. */
export const DEFAULT_BOARD_SETTINGS: Readonly<Record<string, unknown>> = Object.freeze({
  agent_defaults: { maxConcurrency: 0, skipPermissions: true },
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
    untouched: ['projects', 'tasks', 'memory', 'git_tokens', 'github_apps', 'workers', 'locks'],
  };

  // ── agents ──────────────────────────────────────────────────────────────────
  if (mode === 'delete') {
    const before = Number((await s.get(`SELECT COUNT(*) c FROM agents`) as any)?.c ?? 0);
    await s.exec(`DELETE FROM agents`);
    result.agents.deleted = before;
  }
  for (const a of DEFAULT_AGENTS) {
    await insertAgent(s, a); // upsert on role — safe in both modes
    result.agents.written++;
  }

  // ── board_settings (declared keys ONLY) ─────────────────────────────────────
  if (mode === 'delete') {
    for (const id of RESTORABLE_SETTING_KEYS) {
      const row = await s.get(`SELECT id FROM board_settings WHERE id = ?`, [id]);
      if (row) {
        await s.run(`DELETE FROM board_settings WHERE id = ?`, [id]);
        result.boardSettings.deleted++;
      }
    }
  }
  for (const [id, value] of Object.entries(DEFAULT_BOARD_SETTINGS)) {
    await writeBoardSetting(s, id, value);
    result.boardSettings.written++;
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
  untouched: string[];
}> {
  await ensureMigrated('tasks');
  const s = getStore('tasks');

  const rows = (await s.all(`SELECT role, isSystem FROM agents`)) as Array<{ role: string; isSystem: number | boolean }>;
  const builtIn = new Set(DEFAULT_AGENTS.map(a => a.role));
  const custom = rows.map(r => r.role).filter(r => !builtIn.has(r as any));

  return {
    mode,
    // `overwrite` keeps custom agents; `delete` wipes the table first, so they go.
    customAgentsRemoved: mode === 'delete' ? custom : [],
    builtInAgentsReverted: DEFAULT_AGENTS.map(a => a.role),
    settingsReverted: [...RESTORABLE_SETTING_KEYS],
    untouched: ['projects', 'tasks', 'memory', 'git_tokens', 'github_apps', 'workers', 'locks',
                'board_settings: heartbeat, code_index:*, default'],
  };
}
