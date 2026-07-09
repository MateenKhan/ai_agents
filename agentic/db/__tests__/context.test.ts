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

describe('LRU cap enforcement', () => {
  it('evicts least-recently-used UNPINNED files when over cap', async () => {
    // cap 250: three 100-token files → one must be evicted, the oldest-used.
    await keepInContext({ projectId: P, path: 'old.ts', tokens: 100, addedBy: 'agent-1', cap: 1_000_000 });
    await keepInContext({ projectId: P, path: 'mid.ts', tokens: 100, addedBy: 'agent-1', cap: 1_000_000 });
    await keepInContext({ projectId: P, path: 'new.ts', tokens: 100, addedBy: 'agent-1', cap: 250 });
    const paths = (await listContext(P)).map(f => f.path).sort();
    expect(paths).toEqual(['mid.ts', 'new.ts']); // old.ts evicted (LRU)
    expect((await contextStats(P)).totalTokens).toBe(200);
    expect((await getContextOps(P)).some(o => o.op === 'evict' && o.path === 'old.ts')).toBe(true);
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
