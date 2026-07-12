/**
 * Tiny internal router for the db-server — zero dependencies, node:* only.
 *
 * Method + pattern matching (path params like /tasks/:id, trailing * wildcard),
 * then a fixed middleware spine run for every matched route, in order:
 *   1. request-id + timing log line (one line per response, on finish)
 *   2. CORS — header logic ported verbatim from db/server.ts
 *   3. auth hooks — empty seam today; P1.7 registers the bearer-token check here
 *   4. body-size limit (413) + JSON parse (400), body handed to the handler
 *   5. ONE error envelope: any thrown handler error becomes { error } JSON
 *
 * Handlers get (req, res, params, body?). handle() returns false when no route
 * matches so the caller (db/server.ts) can fall through to its legacy routes.
 */
import { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';

export type Request = IncomingMessage & {
  body?: any;                       // parsed JSON body (undefined when none was sent)
  rawBody?: string;                 // exact body text, for handlers that re-parse it
  params?: Record<string, string>;
  query?: Record<string, string>;
  requestId?: string;
  projectId?: string;               // injected by auth/project middleware if needed
};
export type Response = ServerResponse;
export type Handler = (req: Request, res: Response, params: Record<string, string>, body?: any) => Promise<void> | void;

// ── auth hook seam ────────────────────────────────────────────────────────────
// P1.7 (bearer token) registers its check here: `authHooks.push(hook)`. Empty = no-op.
// A hook REJECTS a request by ending the response itself (e.g. 401 + {error}); the
// chain stops as soon as a hook has written the response. Hooks run before the body
// is read, so a rejected request never buffers an attacker-sized payload.
export type AuthHook = (req: Request, res: Response) => void | Promise<void>;
export const authHooks: AuthHook[] = [];

// Hard cap on request bodies — reject once accumulated bytes exceed this instead of
// buffering unbounded memory (DoS guard). Same cap as db/server.ts readBody.
const MAX_BODY_BYTES = 10_000_000; // 10 MB
export function readBody(req: IncomingMessage, maxBytes: number = MAX_BODY_BYTES): Promise<string> {
  return new Promise((res, rej) => {
    let d = ''; let size = 0;
    req.on('data', c => {
      size += (c as Buffer).length;
      if (size > maxBytes) {
        const err: any = new Error('request body too large'); err.statusCode = 413;
        // pause (don't destroy) so the 413 envelope still reaches the client; the
        // error path answers with Connection: close, which drops the socket after.
        req.pause(); rej(err); return;
      }
      d += c;
    });
    req.on('end', () => res(d));
    req.on('error', rej);
  });
}

// CORS — ported VERBATIM from db/server.ts: this server holds credentials and has no
// auth, so we do NOT open it to any origin. Allowed: same-host and localhost. Override
// with CORS_ALLOW_ORIGIN. Non-browser callers send no Origin and are unaffected.
function applyCors(req: Request, res: Response): void {
  {
    const origin = req.headers.origin;
    if (origin) {
      const oHost = origin.replace(/^https?:\/\//, '').split(':')[0].toLowerCase();
      const reqHost = String(req.headers.host || '').split(':')[0].toLowerCase();
      const isLocal = oHost === 'localhost' || oHost === '127.0.0.1' || oHost === '[::1]';
      const sameHost = !!oHost && oHost === reqHost;
      const override = process.env.CORS_ALLOW_ORIGIN;
      if (override === '*' || isLocal || sameHost) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
      else if (override) { res.setHeader('Access-Control-Allow-Origin', override); }
      // else: no ACAO header → the browser blocks the cross-origin read.
    }
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export class Router {
  private routes: { method: string; pattern: RegExp; paramNames: string[]; handler: Handler }[] = [];
  private maxBodyBytes: number;

  constructor(opts?: { maxBodyBytes?: number }) {
    this.maxBodyBytes = opts?.maxBodyBytes ?? MAX_BODY_BYTES;
  }

  add(method: string, path: string, handler: Handler) {
    const paramNames: string[] = [];
    const regexPath = path.replace(/:([^/]+)/g, (_, paramName) => {
      paramNames.push(paramName);
      return '([^/]+)';
    }).replace(/\*/g, '(.*)');
    this.routes.push({ method, pattern: new RegExp(`^${regexPath}$`), paramNames, handler });
  }

  get(path: string, handler: Handler) { this.add('GET', path, handler); }
  post(path: string, handler: Handler) { this.add('POST', path, handler); }
  put(path: string, handler: Handler) { this.add('PUT', path, handler); }
  patch(path: string, handler: Handler) { this.add('PATCH', path, handler); }
  delete(path: string, handler: Handler) { this.add('DELETE', path, handler); }
  all(path: string, handler: Handler) { this.add('ALL', path, handler); }

  /** Returns true when a route matched (response handled), false to fall through. */
  async handle(req: Request, res: Response): Promise<boolean> {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    let match: { handler: Handler; params: Record<string, string> } | null = null;
    for (const route of this.routes) {
      if (route.method !== req.method && route.method !== 'ALL') continue;
      const m = pathname.match(route.pattern);
      if (!m) continue;
      const params: Record<string, string> = {};
      route.paramNames.forEach((name, i) => { params[name] = decodeURIComponent(m[i + 1]); });
      match = { handler: route.handler, params };
      break;
    }
    if (!match) return false;

    // 1. request-id + timing — one log line per response, emitted when it finishes.
    const started = Date.now();
    const id = randomUUID().slice(0, 8);
    req.requestId = id;
    res.setHeader('X-Request-Id', id);
    res.on('finish', () => {
      console.log(`[db-server] #${id} ${req.method} ${req.url} → ${res.statusCode} ${Date.now() - started}ms`);
    });

    req.query = Object.fromEntries(url.searchParams.entries());
    req.params = match.params;

    try {
      // 2. CORS (server.ts also applies this for legacy routes; setting twice is idempotent).
      applyCors(req, res);
      res.setHeader('Content-Type', 'application/json');

      // 3. auth hooks — a hook that ends the response stops the chain.
      for (const hook of authHooks) {
        await hook(req, res);
        if (res.writableEnded || res.headersSent) return true;
      }

      // 4. body: size-capped read (413 via throw), then JSON parse → 400.
      req.rawBody = await readBody(req, this.maxBodyBytes);
      if (req.rawBody) {
        try { req.body = JSON.parse(req.rawBody); }
        catch {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: 'invalid JSON body' }));
          return true;
        }
      }

      await match.handler(req, res, match.params, req.body);
    } catch (e: any) {
      // 5. ONE error envelope for anything a handler (or the body read) threw.
      if (!res.headersSent) {
        res.statusCode = e?.statusCode || 500;
        // an oversized body was never drained — close the connection after replying
        if (e?.statusCode === 413) res.setHeader('Connection', 'close');
        res.end(JSON.stringify({ error: e?.message || 'Internal Server Error' }));
      } else if (!res.writableEnded) {
        res.end();
      }
    }
    return true;
  }
}
