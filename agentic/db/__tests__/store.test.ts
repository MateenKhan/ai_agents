// Foundation tests for the Store abstraction:
//  1. toPg()      — pure placeholder rewrite (?→$n), quote-literal aware.
//  2. buildUpsert — dialect-correct UPSERT SQL generation (sqlite vs postgres).
//  3. sqliteStore — real round-trip against a temp SQLite file (run/get/all/tx).
//  4. runMigrations — creates every table on the real sqlite engine.
// The Postgres adapter is not exercised here (no local Postgres) — its correctness
// rides on the shared toPg()/buildUpsert() generation tested below.

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toPg, buildUpsert, upsert } from '../store';
import { openSqliteStore } from '../sqliteStore';
import { runMigrations } from '../migrations';

describe('toPg', () => {
  it('rewrites sequential ? to $1..$n', () => {
    expect(toPg('INSERT INTO t (a,b,c) VALUES (?,?,?)'))
      .toBe('INSERT INTO t (a,b,c) VALUES ($1,$2,$3)');
  });
  it('rewrites across WHERE clauses', () => {
    expect(toPg('UPDATE t SET a=? WHERE id=?'))
      .toBe('UPDATE t SET a=$1 WHERE id=$2');
  });
  it('leaves ? inside single-quoted string literals untouched', () => {
    expect(toPg("SELECT * FROM t WHERE note = 'why?' AND id = ?"))
      .toBe("SELECT * FROM t WHERE note = 'why?' AND id = $1");
  });
  it('handles the doubled-quote escape inside a literal', () => {
    expect(toPg("SELECT ? WHERE s = 'it''s ok?' AND x = ?"))
      .toBe("SELECT $1 WHERE s = 'it''s ok?' AND x = $2");
  });
  it('no placeholders → unchanged', () => {
    expect(toPg('SELECT 1')).toBe('SELECT 1');
  });
});

describe('buildUpsert', () => {
  const row = { id: 'a', name: 'A', v: 1 };

  it('sqlite → INSERT OR REPLACE', () => {
    const { sql, params } = buildUpsert('sqlite', 'projects', row, ['id']);
    expect(sql).toBe('INSERT OR REPLACE INTO projects (id, name, v) VALUES (?, ?, ?)');
    expect(params).toEqual(['a', 'A', 1]);
  });

  it('postgres → ON CONFLICT DO UPDATE of the non-key columns', () => {
    const { sql, params } = buildUpsert('postgres', 'projects', row, ['id']);
    expect(sql).toBe(
      'INSERT INTO projects (id, name, v) VALUES (?, ?, ?) ' +
      'ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, v = EXCLUDED.v',
    );
    expect(params).toEqual(['a', 'A', 1]);
  });

  it('postgres → DO NOTHING when every column is part of the key', () => {
    const { sql } = buildUpsert('postgres', 'link', { a: 1, b: 2 }, ['a', 'b']);
    expect(sql).toBe('INSERT INTO link (a, b) VALUES (?, ?) ON CONFLICT (a, b) DO NOTHING');
  });

  it('postgres composite key updates only the remaining columns', () => {
    const { sql } = buildUpsert('postgres', 't', { a: 1, b: 2, c: 3 }, ['a', 'b']);
    expect(sql).toBe(
      'INSERT INTO t (a, b, c) VALUES (?, ?, ?) ON CONFLICT (a, b) DO UPDATE SET c = EXCLUDED.c',
    );
  });

  it('throws on an empty row', () => {
    expect(() => buildUpsert('sqlite', 't', {}, ['id'])).toThrow();
  });
});

describe('sqliteStore round-trip (temp file)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'store-test-'));
  const dbPath = join(dir, 'rt.db');
  const store = openSqliteStore(dbPath);

  afterAll(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } });

  it('exec + run + get + all', async () => {
    await store.exec('CREATE TABLE kv (id TEXT PRIMARY KEY, n INTEGER)');
    await store.run('INSERT INTO kv (id, n) VALUES (?, ?)', ['a', 1]);
    await store.run('INSERT INTO kv (id, n) VALUES (?, ?)', ['b', 2]);

    const one = await store.get<{ id: string; n: number }>('SELECT * FROM kv WHERE id = ?', ['a']);
    expect(one).toEqual({ id: 'a', n: 1 });

    const missing = await store.get('SELECT * FROM kv WHERE id = ?', ['zzz']);
    expect(missing).toBeNull();

    const all = await store.all<{ id: string }>('SELECT id FROM kv ORDER BY id');
    expect(all.map(r => r.id)).toEqual(['a', 'b']);
  });

  it('upsert() replaces on conflict', async () => {
    await upsert(store, 'kv', { id: 'a', n: 99 }, ['id']);
    const row = await store.get<{ n: number }>('SELECT n FROM kv WHERE id = ?', ['a']);
    expect(row?.n).toBe(99);
  });

  it('tx commits on success', async () => {
    await store.tx(async s => { await s.run('INSERT INTO kv (id, n) VALUES (?, ?)', ['c', 3]); });
    const row = await store.get('SELECT n FROM kv WHERE id = ?', ['c']);
    expect(row).not.toBeNull();
  });

  it('tx rolls back on throw', async () => {
    await expect(store.tx(async s => {
      await s.run('INSERT INTO kv (id, n) VALUES (?, ?)', ['d', 4]);
      throw new Error('boom');
    })).rejects.toThrow('boom');
    const row = await store.get('SELECT n FROM kv WHERE id = ?', ['d']);
    expect(row).toBeNull();
  });
});

describe('runMigrations on sqlite (real engine)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'store-mig-'));
  const store = openSqliteStore(join(dir, 'schema.db'));

  afterAll(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } });

  it('creates every expected table and is re-runnable', async () => {
    await runMigrations(store);
    await runMigrations(store); // idempotent — second pass must not throw

    const tables = (await store.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    )).map(r => r.name).sort();

    for (const t of [
      'tasks', 'board_settings', 'git_tokens', 'git_token_assignments',
      'github_apps', 'projects', 'agents', 'agent_meta',
      'agent_logs', 'agent_db_usage', 'memory',
    ]) {
      expect(tables).toContain(t);
    }
  });

  it('seeds the default project', async () => {
    const p = await store.get<{ id: string }>("SELECT id FROM projects WHERE id = 'default'");
    expect(p?.id).toBe('default');
  });

  it('created the additive columns (e.g. tasks.rescueCount)', async () => {
    const cols = (await store.all<{ name: string }>('PRAGMA table_info(tasks)')).map(c => c.name);
    expect(cols).toContain('rescueCount');
    expect(cols).toContain('projectId');
  });
});
