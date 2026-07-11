// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { saveWorkflow } from '../workflowApi';
import { defaultWorkflow } from '../../../../../agentic/workflow/defaultWorkflow';

/**
 * The workflow client turns the server's HTTP results into typed decisions the editor can act on.
 * The sibling `workflowApi.test.ts` already pins the happy 409-conflict / 422-docErrors / thrown-
 * fetch cases; these add the results it does NOT cover: a 422 that surfaces per-stage problems, a
 * generic non-ok status folding into an error result (with the body message, then a status
 * fallback), and a body that fails to parse. The client is tested as-is — no source changes.
 */

const res = (body: unknown, status = 200): Response =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body } as Response);

afterEach(() => vi.unstubAllGlobals());

describe('saveWorkflow — error/edge results not covered by workflowApi.test.ts', () => {
  it('a 409 with a currentRev is a conflict carrying that rev (never thrown)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res({ error: 'stale', currentRev: 12 }, 409)));
    const r = await saveWorkflow(defaultWorkflow(), 3, 'default');
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.kind).toBe('conflict');
    expect(r.ok === false && r.kind === 'conflict' && r.currentRev).toBe(12);
  });

  it('a 422 surfaces the per-stage issues, not just the doc-level errors', async () => {
    const stageIssues = [
      { stageId: 'qa', reasons: ['no outgoing edge'] },
      { stageId: 'build', reasons: ['unknown behaviour'] },
    ];
    vi.stubGlobal('fetch', vi.fn(async () => res({ error: 'invalid', docErrors: ['no terminal stage'], stageIssues }, 422)));
    const r = await saveWorkflow(defaultWorkflow(), 0, 'default');
    expect(r.ok === false && r.kind).toBe('invalid');
    expect(r.ok === false && r.kind === 'invalid' && r.docErrors).toEqual(['no terminal stage']);
    expect(r.ok === false && r.kind === 'invalid' && r.stageIssues).toEqual(stageIssues);
  });

  it('a 422 with no problem lists still resolves to invalid with empty lists (no throw)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res({}, 422)));
    const r = await saveWorkflow(defaultWorkflow(), 0, 'default');
    expect(r.ok === false && r.kind).toBe('invalid');
    expect(r.ok === false && r.kind === 'invalid' && r.docErrors).toEqual([]);
    expect(r.ok === false && r.kind === 'invalid' && r.stageIssues).toEqual([]);
  });

  it('a generic non-ok status folds into an error result, using the body message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res({ error: 'server exploded' }, 500)));
    const r = await saveWorkflow(defaultWorkflow(), 0, 'default');
    expect(r.ok === false && r.kind).toBe('error');
    expect(r.ok === false && r.kind === 'error' && r.message).toBe('server exploded');
  });

  it('a non-ok status with no message falls back to the HTTP status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res({}, 503)));
    const r = await saveWorkflow(defaultWorkflow(), 0, 'default');
    expect(r.ok === false && r.kind).toBe('error');
    expect(r.ok === false && r.kind === 'error' && r.message).toBe('HTTP 503');
  });

  it('a body that fails to parse does not throw — it degrades to an error result', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      ({ ok: false, status: 500, json: async () => { throw new SyntaxError('unexpected token'); } } as unknown as Response)));
    const r = await saveWorkflow(defaultWorkflow(), 0, 'default');
    expect(r.ok === false && r.kind).toBe('error');
    expect(r.ok === false && r.kind === 'error' && r.message).toBe('HTTP 500');
  });
});
