import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildConfig } from '../../config';
import { setConfig } from '../../runtime-context';
import { getLogsDb } from '../logs';
import {
  keepInContext, touchContext, removeFromContext, setPinned, listContext,
  contextStats, enforceCap, sweepContext, reconcileContext, getFileUsage, getContextOps,
  MAX_FILE_TOKENS,
} from '../context';

const P = 'proj_test';

beforeAll(async () => {
  setConfig(buildConfig(mkdtempSync(join(tmpdir(), 'ctx-'))));
  await listContext(P); // first context call runs migrations (creates the tables)
});

beforeEach(() => {
  const db = getLogsDb();
  db.exec('DELETE FROM context_files');
  db.exec('DELETE FROM context_ops');
});

describe('keep / list / stats', () => {
  it('keeps a file and reflects it in the context set + stats', async () => {
    await keepInContext({ projectId: P, path: 'a.ts', tokens: 100, addedBy: 'agent-1' });
    const files = await listContext(P);
    expect(files.map(f => f.path)).toEqual(['a.ts']);
    expect((await contextStats(P)).totalTokens).toBe(100);
    expect((await contextStats(P)).fileCount).toBe(1);
  });

  it('re-keeping the same path bumps useCount, does not duplicate', async () => {
    await keepInContext({ projectId: P, path: 'a.ts', tokens: 100, addedBy: 'agent-1' });
    await keepInContext({ projectId: P, path: 'a.ts', tokens: 120, addedBy: 'agent-2' });
    const files = await listContext(P);
    expect(files).toHaveLength(1);
    expect(files[0].useCount).toBe(2);
    expect(files[0].tokens).toBe(120);
  });

  it('user-added files are pinned; agent-added are not', async () => {
    await keepInContext({ projectId: P, path: 'user.ts', tokens: 10, addedBy: 'user' });
    await keepInContext({ projectId: P, path: 'agent.ts', tokens: 10, addedBy: 'agent-1' });
    const byPath = Object.fromEntries((await listContext(P)).map(f => [f.path, f.pinned]));
    expect(byPath['user.ts']).toBe(1);
    expect(byPath['agent.ts']).toBe(0);
  });
});

describe('touch (read from memory)', () => {
  it('bumps recency + logs a read op only when the file is present', async () => {
    await keepInContext({ projectId: P, path: 'a.ts', tokens: 10, addedBy: 'agent-1' });
    expect(await touchContext(P, 'a.ts', 'agent-2', 't1', 5)).toBe(true);
    expect(await touchContext(P, 'missing.ts', 'agent-2')).toBe(false);
    const reads = (await getContextOps(P)).filter(o => o.op === 'read');
    expect(reads).toHaveLength(1);
    expect(reads[0].durationMs).toBe(5);
  });
});

describe('cap enforcement — least-FREQUENTLY-used', () => {
  it('with equal use counts, the least recently used goes first', async () => {
    // cap 250: three 100-token files → one must be evicted. Nothing has been used twice, so
    // recency is the only signal and this behaves exactly like the old LRU.
    await keepInContext({ projectId: P, path: 'old.ts', tokens: 100, addedBy: 'agent-1', cap: 1_000_000 });
    await keepInContext({ projectId: P, path: 'mid.ts', tokens: 100, addedBy: 'agent-1', cap: 1_000_000 });
    await keepInContext({ projectId: P, path: 'new.ts', tokens: 100, addedBy: 'agent-1', cap: 250 });
    const paths = (await listContext(P)).map(f => f.path).sort();
    expect(paths).toEqual(['mid.ts', 'new.ts']);
    expect((await contextStats(P)).totalTokens).toBe(200);
    expect((await getContextOps(P)).some(o => o.op === 'evict' && o.path === 'old.ts')).toBe(true);
  });

  // The reason `useCount` exists as a column. Pure LRU threw away the file every agent keeps
  // returning to, simply because one unrelated search touched something else more recently.
  it('a heavily-used OLD file survives, and a rarely-used RECENT one is evicted', async () => {
    await keepInContext({ projectId: P, path: 'hot.ts', tokens: 100, addedBy: 'agent-1', cap: 1_000_000 });
    await touchContext(P, 'hot.ts', 'agent-2');     // useCount 2
    await touchContext(P, 'hot.ts', 'agent-3');     // useCount 3

    await keepInContext({ projectId: P, path: 'cool.ts', tokens: 100, addedBy: 'agent-1', cap: 1_000_000 });   // useCount 1
    await keepInContext({ projectId: P, path: 'newest.ts', tokens: 100, addedBy: 'agent-1', cap: 250 });       // useCount 1

    const paths = (await listContext(P)).map(f => f.path).sort();
    // Under the old LRU, `hot.ts` had the oldest lastUsedAt and would have been the victim.
    expect(paths).toEqual(['hot.ts', 'newest.ts']);
    expect((await getContextOps(P)).some(o => o.op === 'evict' && o.path === 'cool.ts')).toBe(true);
  });

  it('frequency beats recency even when the frequent file is by far the oldest', async () => {
    await keepInContext({ projectId: P, path: 'core.ts', tokens: 100, addedBy: 'agent-1', cap: 1_000_000 });
    for (const a of ['agent-1', 'agent-2', 'agent-3', 'agent-4']) await touchContext(P, 'core.ts', a);

    await keepInContext({ projectId: P, path: 'a.ts', tokens: 100, addedBy: 'agent-1', cap: 1_000_000 });
    await keepInContext({ projectId: P, path: 'b.ts', tokens: 100, addedBy: 'agent-1', cap: 1_000_000 });
    await keepInContext({ projectId: P, path: 'c.ts', tokens: 100, addedBy: 'agent-1', cap: 250 });

    const paths = (await listContext(P)).map(f => f.path);
    expect(paths).toContain('core.ts');
    expect(paths).toHaveLength(2);
  });

  it('a user pin still outranks everything, however cold', async () => {
    await keepInContext({ projectId: P, path: 'pinned.ts', tokens: 100, addedBy: 'user', pinned: true, cap: 1_000_000 });
    await keepInContext({ projectId: P, path: 'busy.ts', tokens: 100, addedBy: 'agent-1', cap: 1_000_000 });
    for (const a of ['agent-1', 'agent-2']) await touchContext(P, 'busy.ts', a);
    await keepInContext({ projectId: P, path: 'spill.ts', tokens: 100, addedBy: 'agent-1', cap: 150 });

    const paths = (await listContext(P)).map(f => f.path);
    expect(paths).toContain('pinned.ts');   // never evicted, whatever its use count
  });

  it('never evicts pinned files even when over cap', async () => {
    await keepInContext({ projectId: P, path: 'pin.ts', tokens: 400, addedBy: 'user', cap: 1_000_000 });
    await keepInContext({ projectId: P, path: 'cache.ts', tokens: 100, addedBy: 'agent-1', cap: 200 });
    const paths = (await listContext(P)).map(f => f.path);
    expect(paths).toContain('pin.ts');       // pinned survives despite being over cap
    expect(paths).not.toContain('cache.ts'); // unpinned evicted
  });
});

describe('sweep (health-check GC)', () => {
  it('ages out stale unpinned files, keeps pins and fresh files', async () => {
    await keepInContext({ projectId: P, path: 'fresh.ts', tokens: 10, addedBy: 'agent-1' });
    await keepInContext({ projectId: P, path: 'pinned.ts', tokens: 10, addedBy: 'user' });
    await keepInContext({ projectId: P, path: 'stale.ts', tokens: 10, addedBy: 'agent-1' });
    // Backdate stale.ts well past the TTL.
    getLogsDb().exec(`UPDATE context_files SET lastUsedAt='2000-01-01T00:00:00.000Z' WHERE path='stale.ts'`);
    const r = await sweepContext(P, { maxAgeMs: 60_000 });
    expect(r.agedOut).toBe(1);
    const paths = (await listContext(P)).map(f => f.path).sort();
    expect(paths).toEqual(['fresh.ts', 'pinned.ts']);
  });
});

describe('setPinned / remove', () => {
  it('pinning protects a cache file from future eviction', async () => {
    await keepInContext({ projectId: P, path: 'a.ts', tokens: 10, addedBy: 'agent-1' });
    expect(await setPinned(P, 'a.ts', true)).toBe(true);
    expect((await listContext(P))[0].pinned).toBe(1);
  });

  it('remove deletes and logs unpin (was pinned) vs evict', async () => {
    await keepInContext({ projectId: P, path: 'p.ts', tokens: 10, addedBy: 'user' });
    await removeFromContext(P, 'p.ts');
    expect(await listContext(P)).toHaveLength(0);
    expect((await getContextOps(P)).some(o => o.op === 'unpin' && o.path === 'p.ts')).toBe(true);
  });
});

describe('file usage analytics', () => {
  it('counts uses and DISTINCT agents per file (excludes user/gc)', async () => {
    await keepInContext({ projectId: P, path: 'hot.ts', tokens: 10, addedBy: 'agent-1' });
    await touchContext(P, 'hot.ts', 'agent-2');
    await touchContext(P, 'hot.ts', 'agent-3');
    await keepInContext({ projectId: P, path: 'cold.ts', tokens: 10, addedBy: 'agent-1' });
    const usage = await getFileUsage(P);
    const hot = usage.find(u => u.path === 'hot.ts')!;
    expect(Number(hot.uses)).toBe(3);       // 1 keep + 2 reads
    expect(Number(hot.agents)).toBe(3);     // agent-1/2/3
    expect(hot.inContext).toBe(1);
    // hot ranks above cold
    expect(usage[0].path).toBe('hot.ts');
  });
});

describe('reconcileContext (disk truth)', () => {
  it('drops entries whose file is no longer on disk, keeps the rest', async () => {
    await keepInContext({ projectId: P, path: 'keep.ts', tokens: 10, addedBy: 'agent-1' });
    await keepInContext({ projectId: P, path: 'gone.ts', tokens: 20, addedBy: 'agent-1' });
    const removed = await reconcileContext(P, ['keep.ts', 'other.ts']);
    expect(removed.map(f => f.path)).toEqual(['gone.ts']);
    expect((await listContext(P)).map(f => f.path)).toEqual(['keep.ts']);
  });

  it('removes PINNED entries too — a pin on a deleted file is dead', async () => {
    await keepInContext({ projectId: P, path: 'pinned.md', tokens: 10, addedBy: 'user' }); // user = pinned
    expect((await listContext(P))[0].pinned).toBe(1);
    const removed = await reconcileContext(P, ['something-else.ts']);
    expect(removed.map(f => f.path)).toEqual(['pinned.md']);
    expect(await listContext(P)).toHaveLength(0);
  });

  it('logs an evict op with reason "deleted on disk"', async () => {
    await keepInContext({ projectId: P, path: 'ghost.ts', tokens: 10, addedBy: 'agent-1' });
    await reconcileContext(P, []);
    expect((await getContextOps(P)).some(o => o.op === 'evict' && o.path === 'ghost.ts' && o.reason === 'deleted on disk')).toBe(true);
  });

  it('is a no-op when every entry still exists (returns [])', async () => {
    await keepInContext({ projectId: P, path: 'a.ts', tokens: 10, addedBy: 'agent-1' });
    await keepInContext({ projectId: P, path: 'b.ts', tokens: 10, addedBy: 'agent-1' });
    expect(await reconcileContext(P, ['a.ts', 'b.ts'])).toEqual([]);
    expect(await listContext(P)).toHaveLength(2);
  });

  it('accepts a Set as well as an array', async () => {
    await keepInContext({ projectId: P, path: 'x.ts', tokens: 10, addedBy: 'agent-1' });
    await keepInContext({ projectId: P, path: 'y.ts', tokens: 10, addedBy: 'agent-1' });
    await reconcileContext(P, new Set(['x.ts']));
    expect((await listContext(P)).map(f => f.path)).toEqual(['x.ts']);
  });
});

describe('enforceCap idempotence', () => {
  it('is a no-op under cap', async () => {
    await keepInContext({ projectId: P, path: 'a.ts', tokens: 10, addedBy: 'agent-1' });
    expect(await enforceCap(P, 1000)).toEqual([]);
  });
});

// ── the budget must actually be a bound ──────────────────────────────────────
// Before these, "cap" was decorative: enforceCap only evicted pinned=0 rows, and prompts.ts
// auto-pins every rule file — so auto-pinned files alone could sit over the cap forever. And a
// single file larger than the whole cap was admitted, then evicted everything else to fit.
describe('context budget is enforced', () => {
  it('refuses a single file larger than the per-file ceiling (never persisted)', async () => {
    const r = await keepInContext({ projectId: P, path: 'huge.ts', tokens: MAX_FILE_TOKENS + 1, addedBy: 'agent-1' });
    expect(r.file).toBeNull();
    expect(await listContext(P)).toEqual([]);
    expect((await contextStats(P)).totalTokens).toBe(0);
    // and it is recorded, not silently dropped
    const ops = await getContextOps(P);
    expect(ops.some(o => o.path === 'huge.ts' && /per-file ceiling/.test(o.reason ?? ''))).toBe(true);
  });

  it('admits a file exactly at the ceiling', async () => {
    const r = await keepInContext({ projectId: P, path: 'edge.ts', tokens: MAX_FILE_TOKENS, addedBy: 'agent-1', cap: MAX_FILE_TOKENS });
    expect(r.file).not.toBeNull();
    expect(r.file!.path).toBe('edge.ts');
  });

  it('evicts SYSTEM auto-pins (e.g. rule files) rather than blowing the cap', async () => {
    // both pinned, but added by the system — previously exempt from eviction forever
    await keepInContext({ projectId: P, path: 'old-rule.md', tokens: 60, addedBy: 'rules', pinned: true, cap: 100 });
    await keepInContext({ projectId: P, path: 'new-rule.md', tokens: 60, addedBy: 'rules', pinned: true, cap: 100 });
    const stats = await contextStats(P, 100);
    // enforceCap ran inside the second keep and evicted the LRU system pin to get under cap
    expect(stats.totalTokens).toBeLessThanOrEqual(100);
    expect((await listContext(P)).map(f => f.path)).toEqual(['new-rule.md']);
  });

  it('never evicts a USER pin, even when that leaves the context over cap', async () => {
    // Admitted under a generous budget, then the cap is lowered underneath it. The ceiling
    // guards ADMISSION; the user-pin rule guards EVICTION. Both must hold at once.
    await keepInContext({ projectId: P, path: 'mine.md', tokens: 500, addedBy: 'user', pinned: true, cap: 1_000_000 });
    const evicted = await enforceCap(P, 100);
    expect(evicted).toEqual([]);                       // user pin survives
    expect((await listContext(P)).map(f => f.path)).toEqual(['mine.md']);
    expect((await contextStats(P, 100)).totalTokens).toBe(500); // honestly over cap, not hidden
  });

  it('prefers evicting unpinned entries before touching system pins', async () => {
    await keepInContext({ projectId: P, path: 'cache.ts', tokens: 60, addedBy: 'agent-1', cap: 1_000 });
    await keepInContext({ projectId: P, path: 'rule.md', tokens: 60, addedBy: 'rules', pinned: true, cap: 1_000 });
    await enforceCap(P, 100);
    expect((await listContext(P)).map(f => f.path)).toEqual(['rule.md']); // unpinned went first
  });
});
