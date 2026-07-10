import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { unlinkSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

import { openSqliteStore } from '../sqliteStore';
import type { Store } from '../store';

const dbPath = join(tmpdir(), `mc-tx-${randomBytes(6).toString('hex')}.db`);
const store = openSqliteStore(dbPath);

/** Yield to the microtask queue, the way any real `await` inside a transaction does. */
const tick = () => new Promise<void>(r => setImmediate(r));

beforeEach(async () => {
  await store.exec(`CREATE TABLE IF NOT EXISTS t (k TEXT PRIMARY KEY)`);
  await store.run(`DELETE FROM t`);
});

afterAll(() => {
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    try { unlinkSync(dbPath + suffix); } catch { /* ignore */ }
  }
});

const keys = async (): Promise<string[]> =>
  (await store.all<{ k: string }>(`SELECT k FROM t ORDER BY k`)).map(r => r.k);

// `tx` used to run BEGIN on the shared handle and then `await fn(this)`. The await yields, so a
// SECOND tx could open while the first was still running: its BEGIN landed inside the first
// transaction, and when it threw, its ROLLBACK discarded the FIRST transaction's work as well.
//
// "SQLite has one writer" is true of separate processes. It says nothing about two interleaved
// async calls inside one process. Postgres never had this bug, because pgStore takes a
// dedicated client per transaction.
describe('SqliteStore.tx serialises overlapping transactions', () => {
  it('a failing transaction cannot roll back a concurrent one', async () => {
    const committer = store.tx(async (t: Store) => {
      await t.run(`INSERT INTO t (k) VALUES ('a1')`);
      await tick();                                   // the yield that used to let B in
      await t.run(`INSERT INTO t (k) VALUES ('a2')`);
      return 'committed';
    });

    const failer = store.tx(async (t: Store) => {
      await t.run(`INSERT INTO t (k) VALUES ('b1')`);
      await tick();
      throw new Error('boom');
    });

    const [a, b] = await Promise.allSettled([committer, failer]);

    expect(a.status).toBe('fulfilled');               // A must survive B's rollback
    expect(b.status).toBe('rejected');
    expect(await keys()).toEqual(['a1', 'a2']);       // A's rows kept, B's discarded
  });

  it('two writers both commit, and neither sees the other mid-flight', async () => {
    const one = store.tx(async t => { await t.run(`INSERT INTO t (k) VALUES ('x')`); await tick(); await t.run(`INSERT INTO t (k) VALUES ('y')`); });
    const two = store.tx(async t => { await t.run(`INSERT INTO t (k) VALUES ('p')`); await tick(); await t.run(`INSERT INTO t (k) VALUES ('q')`); });
    await Promise.all([one, two]);
    expect(await keys()).toEqual(['p', 'q', 'x', 'y']);
  });

  it('a read-modify-write inside tx is atomic against a concurrent one', async () => {
    // The pattern saveWorkflow uses: read the current rev, decide, write. Without
    // serialisation both transactions read the same value and both write.
    await store.run(`INSERT INTO t (k) VALUES ('rev:0')`);

    const bump = () => store.tx(async t => {
      const row = await t.get<{ k: string }>(`SELECT k FROM t WHERE k LIKE 'rev:%'`);
      const n = Number(row!.k.split(':')[1]);
      await tick();                                   // somebody else could read here
      await t.run(`UPDATE t SET k = ? WHERE k = ?`, [`rev:${n + 1}`, row!.k]);
      return n + 1;
    });

    const [r1, r2] = await Promise.all([bump(), bump()]);
    expect([r1, r2].sort()).toEqual([1, 2]);          // 1 then 2, never 1 and 1
    expect(await keys()).toEqual(['rev:2']);
  });

  it('a nested tx joins the open one rather than opening a second', async () => {
    // A helper that opens its own transaction must stay callable from inside a larger one.
    await store.tx(async outer => {
      await outer.run(`INSERT INTO t (k) VALUES ('outer')`);
      await outer.tx(async inner => { await inner.run(`INSERT INTO t (k) VALUES ('inner')`); });
    });
    expect(await keys()).toEqual(['inner', 'outer']);
  });

  it('a nested throw rolls the whole thing back, outer included', async () => {
    await expect(store.tx(async outer => {
      await outer.run(`INSERT INTO t (k) VALUES ('outer')`);
      await outer.tx(async () => { throw new Error('inner boom'); });
    })).rejects.toThrow('inner boom');
    expect(await keys()).toEqual([]);
  });

  it('the queue survives a rejection: later transactions still run', async () => {
    await expect(store.tx(async () => { throw new Error('first'); })).rejects.toThrow('first');
    await store.tx(async t => { await t.run(`INSERT INTO t (k) VALUES ('after')`); });
    expect(await keys()).toEqual(['after']);
  });
});
