/**
 * db/router.ts — the internal router + middleware spine.
 * Covers: pattern matching & path params, wildcard, fall-through, body-size 413,
 * bad JSON 400, the ONE {error} envelope, middleware order (request-id → CORS →
 * auth hooks → body → handler), and the auth-hook seam.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { Router, authHooks, type Request, type Response } from '../router.js';

function serve(router: Router): Promise<{ srv: Server; base: string }> {
  return new Promise(resolve => {
    const srv = createServer(async (req, res) => {
      const handled = await router.handle(req as Request, res as Response);
      if (!handled) { res.statusCode = 404; res.end(JSON.stringify({ error: 'unmatched' })); }
    });
    srv.listen(0, '127.0.0.1', () => {
      resolve({ srv, base: `http://127.0.0.1:${(srv.address() as any).port}` });
    });
  });
}

describe('Router', () => {
  const router = new Router();
  const order: string[] = [];
  let srv: Server; let base: string;

  beforeAll(async () => {
    router.get('/tasks/:id', (req, res, params) => {
      res.end(JSON.stringify({ id: params.id, query: req.query }));
    });
    router.get('/a/:x/b/:y', (_req, res, params) => { res.end(JSON.stringify(params)); });
    router.post('/echo', (_req, res, _params, body) => { res.end(JSON.stringify({ got: body })); });
    router.post('/order', (_req, res) => { order.push('handler'); res.end('{}'); });
    router.get('/boom', () => { throw new Error('kaboom'); });
    router.get('/teapot', () => { throw Object.assign(new Error('short and stout'), { statusCode: 418 }); });
    router.get('/wild*', (req, res) => { res.end(JSON.stringify({ url: req.url })); });
    ({ srv, base } = await serve(router));
  });
  afterAll(() => new Promise<void>(r => srv.close(() => r())));
  afterEach(() => { authHooks.length = 0; order.length = 0; });

  // ── pattern matching & params ──────────────────────────────────────────────
  it('matches method + pattern and decodes path params', async () => {
    const r = await fetch(`${base}/tasks/abc%20123?project=p1`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ id: 'abc 123', query: { project: 'p1' } });
  });

  it('extracts multiple params in order', async () => {
    const r = await fetch(`${base}/a/one/b/two`);
    expect(await r.json()).toEqual({ x: 'one', y: 'two' });
  });

  it('trailing * matches any suffix', async () => {
    const r = await fetch(`${base}/wild/deep/path?q=1`);
    expect(r.status).toBe(200);
    expect(((await r.json()) as any).url).toBe('/wild/deep/path?q=1');
  });

  it('falls through (handle → false) on unknown path AND on wrong method', async () => {
    expect((await fetch(`${base}/nope`)).status).toBe(404);
    expect((await fetch(`${base}/tasks/1`, { method: 'DELETE' })).status).toBe(404);
  });

  it('passes the parsed JSON body as the 4th handler argument', async () => {
    const r = await fetch(`${base}/echo`, { method: 'POST', body: JSON.stringify({ a: 1 }) });
    expect(await r.json()).toEqual({ got: { a: 1 } });
  });

  // ── spine: request-id, CORS, Content-Type ──────────────────────────────────
  it('stamps X-Request-Id and Content-Type: application/json on routed responses', async () => {
    const r = await fetch(`${base}/tasks/1`);
    expect(r.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{8}$/);
    expect(r.headers.get('content-type')).toBe('application/json');
  });

  it('CORS: allows localhost origins (echo + Vary) and always sets methods/headers', async () => {
    const r = await fetch(`${base}/tasks/1`, { headers: { Origin: 'http://localhost:6951' } });
    expect(r.headers.get('access-control-allow-origin')).toBe('http://localhost:6951');
    expect(r.headers.get('vary')).toBe('Origin');
    expect(r.headers.get('access-control-allow-methods')).toBe('GET, POST, PUT, DELETE, OPTIONS');
    expect(r.headers.get('access-control-allow-headers')).toBe('Content-Type');
  });

  it('CORS: a foreign origin gets NO Access-Control-Allow-Origin', async () => {
    const r = await fetch(`${base}/tasks/1`, { headers: { Origin: 'http://evil.example' } });
    expect(r.headers.get('access-control-allow-origin')).toBeNull();
    // the rest of the spine still ran
    expect(r.status).toBe(200);
  });

  it('logs one request-id + timing line per response', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const r = await fetch(`${base}/tasks/log-line`);
      const id = r.headers.get('x-request-id');
      await vi.waitFor(() => {
        const line = spy.mock.calls.map(c => String(c[0])).find(l => l.includes(`#${id}`));
        expect(line).toMatch(new RegExp(`\\[db-server\\] #${id} GET /tasks/log-line → 200 \\d+ms`));
      });
    } finally { spy.mockRestore(); }
  });

  // ── body limits & JSON parse ───────────────────────────────────────────────
  it('rejects an oversized body with 413 { error }', async () => {
    const small = new Router({ maxBodyBytes: 64 });
    small.post('/echo', (_req, res) => { res.end('{}'); });
    const { srv: s2, base: b2 } = await serve(small);
    try {
      const r = await fetch(`${b2}/echo`, { method: 'POST', body: JSON.stringify({ pad: 'x'.repeat(200) }) });
      expect(r.status).toBe(413);
      expect(await r.json()).toEqual({ error: 'request body too large' });
    } finally { await new Promise<void>(r => s2.close(() => r())); }
  });

  it('rejects malformed JSON with 400 before the handler runs', async () => {
    const r = await fetch(`${base}/order`, { method: 'POST', body: '{not json' });
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: 'invalid JSON body' });
    expect(order).toEqual([]); // handler never ran
  });

  it('accepts an empty body (body stays undefined)', async () => {
    const r = await fetch(`${base}/echo`, { method: 'POST' });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({}); // { got: undefined } serialises to {}
  });

  // ── error envelope ─────────────────────────────────────────────────────────
  it('wraps thrown handler errors in the ONE { error } envelope (500 default)', async () => {
    const r = await fetch(`${base}/boom`);
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ error: 'kaboom' });
  });

  it('honours err.statusCode in the envelope', async () => {
    const r = await fetch(`${base}/teapot`);
    expect(r.status).toBe(418);
    expect(await r.json()).toEqual({ error: 'short and stout' });
  });

  // ── auth-hook seam + middleware order ──────────────────────────────────────
  it('runs auth hooks BEFORE the body is parsed and the handler runs', async () => {
    authHooks.push(async () => { order.push('auth'); });
    const r = await fetch(`${base}/order`, { method: 'POST', body: '{}' });
    expect(r.status).toBe(200);
    expect(order).toEqual(['auth', 'handler']);
    // and before body parsing: a bad body still reaches the hook first
    order.length = 0;
    const bad = await fetch(`${base}/order`, { method: 'POST', body: '{nope' });
    expect(bad.status).toBe(400);
    expect(order).toEqual(['auth']);
  });

  it('a hook that ends the response (401) stops the chain — the future bearer check', async () => {
    authHooks.push(async (req, res) => {
      if (req.headers.authorization !== 'Bearer sesame') {
        res.statusCode = 401;
        res.end(JSON.stringify({ error: 'unauthorized' }));
      }
    });
    const denied = await fetch(`${base}/order`, { method: 'POST', body: '{}' });
    expect(denied.status).toBe(401);
    expect(await denied.json()).toEqual({ error: 'unauthorized' });
    expect(order).toEqual([]);
    const allowed = await fetch(`${base}/order`, { method: 'POST', body: '{}', headers: { Authorization: 'Bearer sesame' } });
    expect(allowed.status).toBe(200);
    expect(order).toEqual(['handler']);
  });
});
