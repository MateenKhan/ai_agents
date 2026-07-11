// LFU eviction focus — enforceCap evicts by `useCount ASC, lastUsedAt ASC`
// (least-frequently-used first, oldest-touched as the tie-break). The sibling
// context.test.ts covers keep/list/pins and a couple of frequency-vs-recency
// cases; this file isolates the ORDERING contract by seeding rows with exact
// useCount + lastUsedAt values so nothing about the eviction order is incidental.

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildConfig } from '../../config';
import { setConfig } from '../../runtime-context';
import { getLogsDb } from '../logs';
import { enforceCap, listContext, contextStats, getContextOps } from '../context';

const P = 'proj_eviction';

beforeAll(async () => {
  // Point the whole config (and therefore logs.db) at a throwaway dir so this never
  // touches the real db/logs.db. Same harness the sibling context.test.ts uses.
  setConfig(buildConfig(mkdtempSync(join(tmpdir(), 'ctx-evict-'))));
  await listContext(P); // first context call runs migrations (creates the tables)
});

beforeEach(() => {
  const db = getLogsDb();
  db.exec('DELETE FROM context_files');
  db.exec('DELETE FROM context_ops');
});

/** Insert a context row with an EXACT useCount + lastUsedAt so eviction order is
 *  fully determined by the data, not by call timing. All unpinned, 100 tokens. */
function seed(path: string, useCount: number, lastUsedAt: string, tokens = 100): void {
  getLogsDb().prepare(
    `INSERT INTO context_files (projectId, path, tokens, pinned, addedBy, useCount, addedAt, lastUsedAt)
     VALUES (?,?,?,0,'agent',?,?,?)`,
  ).run(P, path, tokens, useCount, lastUsedAt, lastUsedAt);
}

const ts = (n: number) => `2024-01-01T00:00:${String(n).padStart(2, '0')}.000Z`;

describe('enforceCap evicts least-FREQUENTLY-used first', () => {
  it('drops the lowest useCount files, keeps the most-used, whatever their recency', async () => {
    // Four 100-token files, useCounts 1..4. Give the LEAST-used files the MOST-recent
    // lastUsedAt, so a pure-LRU implementation would keep exactly the wrong ones — this
    // proves frequency, not recency, is the primary key.
    seed('u1.ts', 1, ts(40));
    seed('u2.ts', 2, ts(30));
    seed('u3.ts', 3, ts(20));
    seed('u4.ts', 4, ts(10));

    // total 400, cap 250 → must shed 150, i.e. evict two files. The two LEAST-used go.
    const evicted = await enforceCap(P, 250);

    expect(evicted.map(f => f.path).sort()).toEqual(['u1.ts', 'u2.ts']);
    const remaining = (await listContext(P)).map(f => f.path).sort();
    expect(remaining).toEqual(['u3.ts', 'u4.ts']);
    expect((await contextStats(P, 250)).totalTokens).toBe(200);
  });

  it('evicts strictly in ascending useCount order until back under cap', async () => {
    seed('a.ts', 1, ts(10));
    seed('b.ts', 2, ts(10));
    seed('c.ts', 3, ts(10));

    // total 300, cap 100 → shed 200 → evict the two lowest (useCount 1 then 2).
    await enforceCap(P, 100);

    expect((await listContext(P)).map(f => f.path)).toEqual(['c.ts']);
    // both evictions are logged as gc evicts with the over-cap reason
    const evicts = (await getContextOps(P)).filter(o => o.op === 'evict');
    expect(evicts.map(o => o.path).sort()).toEqual(['a.ts', 'b.ts']);
    expect(evicts.every(o => o.actor === 'gc')).toBe(true);
  });
});

describe('ties on useCount break by oldest lastUsedAt', () => {
  it('with equal useCount, the file touched longest ago is evicted first', async () => {
    seed('older.ts', 5, ts(10));   // same frequency, older touch → victim
    seed('newer.ts', 5, ts(50));   // same frequency, more recent touch → survives

    // total 200, cap 150 → evict exactly one; the tie-break picks the older one.
    const evicted = await enforceCap(P, 150);

    expect(evicted.map(f => f.path)).toEqual(['older.ts']);
    expect((await listContext(P)).map(f => f.path)).toEqual(['newer.ts']);
  });

  it('resolves a three-way tie oldest-first, stopping as soon as it is under cap', async () => {
    seed('t1.ts', 2, ts(10)); // oldest
    seed('t2.ts', 2, ts(20));
    seed('t3.ts', 2, ts(30)); // newest

    // total 300, cap 250 → shed 50 → exactly one eviction: the oldest of the tie.
    await enforceCap(P, 250);

    expect((await listContext(P)).map(f => f.path).sort()).toEqual(['t2.ts', 't3.ts']);
  });
});
