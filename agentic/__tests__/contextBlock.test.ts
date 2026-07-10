import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildConfig } from '../config';
import { setConfig } from '../runtime-context';
import { getLogsDb } from '../db/logs';
import { keepInContext, listContext } from '../db/context';
import { contextBlock } from '../engine/prompts';
import type { Task } from '../types';

const P = 'proj_ctxblock';
const task = (): Task => ({ id: 'T-ctx', title: 't', status: 'WORKING', priority: 0, projectId: P } as Task);

beforeAll(async () => {
  setConfig(buildConfig(mkdtempSync(join(tmpdir(), 'ctxblock-'))));
  await listContext(P); // first call runs the logs-group migrations
});

beforeEach(() => {
  const db = getLogsDb();
  db.exec('DELETE FROM context_files');
  db.exec('DELETE FROM context_ops');
});

/** Keep a file `n` times so its useCount ends at `n`. */
async function seed(path: string, times: number): Promise<void> {
  for (let i = 0; i < times; i++) await keepInContext({ projectId: P, path, tokens: 10, addedBy: `agent-${i}` });
}

describe('contextBlock', () => {
  it('is empty when the project has no context', async () => {
    expect(await contextBlock(task())).toBe('');
  });

  it('lists the most-used files first, ranked by useCount', async () => {
    await seed('low.ts', 1);
    await seed('high.ts', 5);
    await seed('mid.ts', 3);
    const out = await contextBlock(task());
    expect(out).toContain('Files the swarm keeps using here');
    const order = ['high.ts', 'mid.ts', 'low.ts'].map(p => out.indexOf(p));
    expect(order[0]).toBeGreaterThan(-1);
    // strictly increasing indexes ⇒ high before mid before low. Inverting the sort fails this.
    expect(order[0]).toBeLessThan(order[1]);
    expect(order[1]).toBeLessThan(order[2]);
  });

  it('caps the list at 8 files, keeping the top-used ones', async () => {
    for (let i = 0; i < 12; i++) await seed(`f${i}.ts`, i + 1); // f11 most used … f0 least
    const out = await contextBlock(task());
    const listed = out.split('\n').filter(l => l.trim().startsWith('- '));
    expect(listed).toHaveLength(8);
    expect(out).toContain('f11.ts'); // most-used survives
    expect(out).not.toContain('f0.ts'); // least-used is dropped
  });

  it('hands over PATHS only — never contents, tokens, or counts', async () => {
    await seed('only/the/path.ts', 4);
    const out = await contextBlock(task());
    expect(out).toContain('only/the/path.ts');
    expect(out).not.toMatch(/useCount|tokens|\b4\b/); // no numeric metadata leaks
  });
});
