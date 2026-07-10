// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { loadWorkflow, saveWorkflow, resetWorkflow } from '../workflowApi';
import { defaultWorkflow } from '../../../../../agentic/workflow/defaultWorkflow';

const okJson = (body: unknown, status = 200): Response =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body } as Response);

afterEach(() => vi.unstubAllGlobals());

describe('loadWorkflow', () => {
  it('returns the doc plus its validation state', async () => {
    const doc = defaultWorkflow();
    vi.stubGlobal('fetch', vi.fn(async () => okJson({ doc, source: 'stored', valid: true, occupied: ['qa'] })));
    const r = await loadWorkflow('default');
    expect(r.source).toBe('stored');
    expect(r.valid).toBe(true);
    expect(r.occupied).toEqual(['qa']);
    expect(r.doc.stages).toHaveLength(8);
  });

  it('scopes the request to the project', async () => {
    const fetchMock = vi.fn(async (..._a: unknown[]) => okJson({ doc: defaultWorkflow(), source: 'default' }));
    vi.stubGlobal('fetch', fetchMock);
    await loadWorkflow('proj_x');
    expect(String(fetchMock.mock.calls[0][0])).toContain('project=proj_x');
  });

  it('throws on a transport failure the caller must surface', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okJson({}, 500)));
    await expect(loadWorkflow('default')).rejects.toThrow(/HTTP 500/);
  });
});

// The value of the client is turning the server's status codes into decisions the editor can
// act on, rather than a bare "it failed".
describe('saveWorkflow maps every server response', () => {
  it('a clean save returns the stored doc', async () => {
    const doc = defaultWorkflow();
    vi.stubGlobal('fetch', vi.fn(async () => okJson({ ok: true, doc })));
    const r = await saveWorkflow(doc, 0, 'default');
    expect(r.ok).toBe(true);
    expect(r.ok && r.doc.stages).toHaveLength(8);
  });

  it('sends the expectedRev, so the server can reject a stale write', async () => {
    const fetchMock = vi.fn(async (..._a: unknown[]) => okJson({ ok: true, doc: defaultWorkflow() }));
    vi.stubGlobal('fetch', fetchMock);
    await saveWorkflow(defaultWorkflow(), 7, 'default');
    const sent = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(sent.expectedRev).toBe(7);
  });

  it('409 with a currentRev is a conflict, not an occupied error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okJson({ error: 'changed', currentRev: 3 }, 409)));
    const r = await saveWorkflow(defaultWorkflow(), 0, 'default');
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.kind).toBe('conflict');
    expect(r.ok === false && r.kind === 'conflict' && r.currentRev).toBe(3);
  });

  it('409 without a currentRev is a live-task conflict', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okJson({ error: 'stranded', conflicts: ['qa'] }, 409)));
    const r = await saveWorkflow(defaultWorkflow(), 0, 'default');
    expect(r.ok === false && r.kind).toBe('occupied');
    expect(r.ok === false && r.kind === 'occupied' && r.conflicts).toEqual(['qa']);
  });

  it('422 carries the reasons the graph is invalid', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okJson({ error: 'invalid', docErrors: ['no terminal'], stageIssues: [{ stageId: 'qa', reasons: ['x'] }] }, 422)));
    const r = await saveWorkflow(defaultWorkflow(), 0, 'default');
    expect(r.ok === false && r.kind).toBe('invalid');
    expect(r.ok === false && r.kind === 'invalid' && r.docErrors).toEqual(['no terminal']);
  });

  it('a thrown fetch becomes an error result, not an exception', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const r = await saveWorkflow(defaultWorkflow(), 0, 'default');
    expect(r.ok === false && r.kind).toBe('error');
    expect(r.ok === false && r.kind === 'error' && r.message).toBe('offline');
  });
});

describe('resetWorkflow', () => {
  it('returns the built-in pipeline the server falls back to', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okJson({ ok: true, doc: defaultWorkflow() })));
    const doc = await resetWorkflow('default');
    expect(doc.entry).toBe('intake');
  });
});
