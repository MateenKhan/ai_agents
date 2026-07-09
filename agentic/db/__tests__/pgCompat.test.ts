// ─────────────────────────────────────────────────────────────────────────────
// Postgres-compatibility tests that DO NOT need a live Postgres.
//
// The pg path cannot be executed in CI/dev here, so the claims that would otherwise
// rest on "correct by construction" are pinned down as assertions instead:
//   1. the SQL we generate for Postgres (upsert shape, placeholder rewriting)
//   2. the identifier-case reconciliation (pg folds unquoted camelCase to lower-case)
//   3. the int8 type parser (node-pg returns BIGINT/COUNT as a string by default)
//   4. a regression guard: no SQLite-only SQL creeps back into shared write paths
//
// A live-Postgres run is still required to prove the DDL/queries actually execute —
// these tests prove the *shape* of what we send, and that SQLite behaviour is unchanged.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { types } from 'pg';

import { buildUpsert, toPg } from '../store';
import { ALL_COLUMN_NAMES } from '../migrations';
import { normalizeRow } from '../pgStore';

const DB_DIR = join(process.cwd(), 'agentic', 'db');

describe('pg identifier casing', () => {
  it('ALL_COLUMN_NAMES has no lower-case collisions (a collision would silently mis-key rows)', () => {
    const byLower = new Map<string, Set<string>>();
    for (const n of ALL_COLUMN_NAMES) {
      const l = n.toLowerCase();
      byLower.set(l, (byLower.get(l) ?? new Set()).add(n));
    }
    const collisions = [...byLower.entries()].filter(([, v]) => v.size > 1);
    expect(collisions).toEqual([]);
  });

  it('normalizeRow maps folded keys back to canonical camelCase', () => {
    const pgRow = { id: 'T1', claimedby: 'w1', createdat: '2026-01-01', qaverdict: 'pass' };
    expect(normalizeRow(pgRow)).toEqual({
      id: 'T1', claimedBy: 'w1', createdAt: '2026-01-01', qaVerdict: 'pass',
    });
  });

  it('normalizeRow passes SQL aliases and snake_case code-index columns through untouched', () => {
    const row = { distance: 0.2, start_line: 5, project_id: 'p', name: 'x', path: 'a/b.ts' };
    expect(normalizeRow(row)).toEqual(row);
  });

  it('normalizeRow is a no-op on rows that need no remapping (returns same object)', () => {
    const row = { id: 'a', name: 'b' };
    expect(normalizeRow(row)).toBe(row);
  });

  it('normalizeRow tolerates null/non-objects', () => {
    expect(normalizeRow(null)).toBeNull();
    expect(normalizeRow(undefined as any)).toBeUndefined();
  });
});

describe('pg int8 handling', () => {
  it('BIGINT/COUNT(*) is parsed as a number, not a string', () => {
    // Without this, `SELECT COUNT(*) c` -> "0" and `count === 0` is false, so
    // seedIfEmpty() would never seed the agents table on Postgres.
    const parse = types.getTypeParser(20 /* int8 */);
    const parsed = (parse as (v: string) => unknown)('0');
    expect(typeof parsed).toBe('number');
    expect(parsed).toBe(0);
    expect((parse as (v: string) => unknown)('42')).toBe(42);
  });
});

describe('portable upsert SQL', () => {
  it('sqlite keeps the exact INSERT OR REPLACE behaviour the code relied on', () => {
    const { sql, params } = buildUpsert('sqlite', 'board_settings', { id: 'heartbeat', data: '{}' }, ['id']);
    expect(sql).toBe('INSERT OR REPLACE INTO board_settings (id, data) VALUES (?, ?)');
    expect(params).toEqual(['heartbeat', '{}']);
  });

  it('postgres emits ON CONFLICT DO UPDATE over the non-key columns', () => {
    const { sql, params } = buildUpsert('postgres', 'board_settings', { id: 'heartbeat', data: '{}' }, ['id']);
    expect(sql).toBe(
      'INSERT INTO board_settings (id, data) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data',
    );
    expect(params).toEqual(['heartbeat', '{}']);
  });

  it('postgres upsert for the agents table updates every non-key column', () => {
    const row = {
      role: 'dev', label: 'Developer', enabled: 1, model: 'sonnet', worktreeMode: 'create',
      ord: 1, isSystem: 1, promptTemplate: 'p', mergePromptTemplate: null, rescuePromptTemplate: null,
    };
    const { sql } = buildUpsert('postgres', 'agents', row, ['role']);
    expect(sql).toContain('ON CONFLICT (role) DO UPDATE SET');
    for (const c of Object.keys(row).filter(c => c !== 'role')) {
      expect(sql).toContain(`${c} = EXCLUDED.${c}`);
    }
    expect(sql).not.toContain('role = EXCLUDED.role'); // never update the conflict key
  });

  it('postgres upsert degrades to DO NOTHING when every column is a key', () => {
    const { sql } = buildUpsert('postgres', 'git_token_assignments', { agent: 'a' }, ['agent']);
    expect(sql).toContain('ON CONFLICT (agent) DO NOTHING');
  });

  it('placeholders are rewritten for pg, including a ::vector cast, skipping string literals', () => {
    expect(toPg('INSERT INTO t (a, b) VALUES (?, ?) ON CONFLICT (a) DO UPDATE SET b = EXCLUDED.b'))
      .toBe('INSERT INTO t (a, b) VALUES ($1, $2) ON CONFLICT (a) DO UPDATE SET b = EXCLUDED.b');
    expect(toPg('UPDATE code_nodes SET embedding = ?::vector WHERE id = ?'))
      .toBe('UPDATE code_nodes SET embedding = $1::vector WHERE id = $2');
    expect(toPg("SELECT * FROM t WHERE note = 'why?' AND id = ?"))
      .toBe("SELECT * FROM t WHERE note = 'why?' AND id = $1");
  });
});

describe('regression guard: no SQLite-only SQL in shared write paths', () => {
  // `INSERT OR REPLACE` / `INSERT OR IGNORE` are SQLite-only — Postgres raises a syntax
  // error. They are allowed ONLY inside an explicit `dialect === 'sqlite'` branch (and in
  // store.ts, which is where the sqlite half of buildUpsert lives). If a new one appears,
  // this test fails and the author must route it through upsert() or branch on dialect.
  const ALLOWED: Record<string, number> = {
    'store.ts': Infinity,      // buildUpsert's sqlite branch
    'tasks.ts': 1,             // acquireLock, inside `if (s.dialect === 'postgres') … else`
    'migrations.ts': 1,        // default-project seed, inside `if (d === 'sqlite')`
  };

  it('every occurrence is either in store.ts or a known dialect-guarded site', () => {
    const offenders: string[] = [];
    for (const f of readdirSync(DB_DIR).filter(f => f.endsWith('.ts'))) {
      const src = readFileSync(join(DB_DIR, f), 'utf8');
      const hits = src
        .split('\n')
        .map((line, i) => ({ line, n: i + 1 }))
        .filter(({ line }) => /INSERT\s+OR\s+(REPLACE|IGNORE)/i.test(line))
        // ignore prose in comments
        .filter(({ line }) => !/^\s*(\/\/|\*|\/\*)/.test(line));
      const budget = ALLOWED[f] ?? 0;
      if (hits.length > budget) {
        offenders.push(`${f}: ${hits.length} occurrence(s), allowed ${budget} -> ${hits.map(h => h.n).join(',')}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
