import { IncomingMessage, ServerResponse } from 'http';

export type Request = IncomingMessage & { 
  body?: any; 
  params?: Record<string, string>; 
  query?: Record<string, string>;
  projectId?: string; // injected by auth/project middleware if needed
};
export type Response = ServerResponse;
export type Handler = (req: Request, res: Response) => Promise<void> | void;
export type Middleware = (req: Request, res: Response, next: () => Promise<void>) => Promise<void>;

export class Router {
  private routes: { method: string, pattern: RegExp, paramNames: string[], handler: Handler }[] = [];
  private middlewares: Middleware[] = [];

  use(middleware: Middleware) {
    this.middlewares.push(middleware);
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
  delete(path: string, handler: Handler) { this.add('DELETE', path, handler); }
  all(path: string, handler: Handler) { this.add('ALL', path, handler); }

  async handle(req: Request, res: Response) {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    req.query = Object.fromEntries(url.searchParams.entries());
    const pathname = url.pathname;

    let routeMatch: { handler: Handler, params: Record<string, string> } | null = null;
    for (const route of this.routes) {
      if (route.method === req.method || route.method === 'ALL') {
        const match = pathname.match(route.pattern);
        if (match) {
          const params: Record<string, string> = {};
          route.paramNames.forEach((name, i) => {
            params[name] = decodeURIComponent(match[i + 1]);
          });
          routeMatch = { handler: route.handler, params };
          break;
        }
      }
    }

    if (!routeMatch) {
      return false;
    }

    req.params = routeMatch.params;

    // Execute middleware chain
    let idx = 0;
    const next = async (): Promise<void> => {
      if (idx < this.middlewares.length) {
        const mw = this.middlewares[idx++];
        await mw(req, res, next);
      } else {
        await routeMatch!.handler(req, res);
      }
    };

    try {
      await next();
    } catch (e: any) {
      if (!res.headersSent) {
        res.statusCode = e.statusCode || 500;
        res.end(JSON.stringify({ error: e.message || 'Internal Server Error' }));
      }
    }
    return true;
  }
}

const MAX_BODY_BYTES = 10_000_000;
export async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((res, rej) => {
    let d = ''; let size = 0;
    req.on('data', c => {
      size += (c as Buffer).length;
      if (size > MAX_BODY_BYTES) {
        const err: any = new Error('request body too large'); err.statusCode = 413;
        req.destroy(); rej(err); return;
      }
      d += c;
    });
    req.on('end', () => res(d));
    req.on('error', rej);
  });
}
