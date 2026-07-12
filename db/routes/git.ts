/**
 * /git/* endpoints — moved VERBATIM from db/server.ts (SPEC.md Release 1 · P0.5 wave 1).
 * Every handler body is byte-identical to the original; only the surrounding
 * `if (req.method === ... && req.url ...) { ... return; }` wiring became router
 * registrations. Do NOT refactor these bodies while route moves are in flight.
 */
import { spawnSync, spawn } from 'child_process';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join, dirname, resolve, isAbsolute } from 'path';
import { Router, type Request, type Response } from '../router.js';
import {
  projectIdOf,
  projectRepoPath,
  setActivity,
  clearActivity,
  cloneProgress,
  pushCloneOutput,
  purgeProjectData,
  PORT,
} from '../server.js';
import {
  getGitConfig, setGitConfig,
  listGitTokensRaw, getGitTokenRaw, addGitToken, updateGitToken, deleteGitToken,
  getTokenAssignments, setTokenAssignment,
  listProjects, getProject, createProject, updateProject,
  createPendingGithubApp, getGithubApp, listGithubApps, listGithubAppsRaw,
  updateGithubApp, deleteGithubApp, mintInstallationToken, listAppInstallations,
  listInstallationRepos, getAllTasks,
} from '../tasks.js';
import { authenticateGitUrl } from '../gitAuth.js';
import { redactSecrets } from '../../agentic/redact.js';

// The router spine already consumed the request stream (body-size limit + JSON
// parse); this shim hands the buffered raw body to the verbatim-moved handlers so
// their `await readBody(req)` calls keep working unchanged.
function readBody(req: Request): Promise<string> {
  return Promise.resolve(req.rawBody ?? '');
}

export function registerGitRoutes(router: Router) {
  // ─── Git / GitHub-token endpoints ───────────────────────────────────────────
  // SECURITY: the GitHub token is stored in PLAINTEXT in the local sqlite
  // board_settings table (id='git_config'). It is NEVER returned raw over HTTP —
  // GET masks it, and clone output has the token stripped before it is returned.

  const maskToken = (t?: string): string => {
    if (!t) return '';
    if (t.length <= 8) return '••••';
    return t.slice(0, 4) + '••••' + t.slice(-4);
  };

  router.get('/git/config', async (req: Request, res: Response) => {
    try {
      const cfg = await getGitConfig();
      res.end(JSON.stringify({
        configured: !!cfg.token,
        username: cfg.username || '',
        host: cfg.host || 'github.com',
        tokenMasked: maskToken(cfg.token),
      }));
    } catch (e: any) {
      res.statusCode = 500; res.end(JSON.stringify({ error: e.message }));
    }
    return;
  });

  router.put('/git/config', async (req: Request, res: Response) => {
    try {
      const body = await readBody(req);
      const b = body ? JSON.parse(body) : {};
      // Blank/absent token → coerce to undefined so setGitConfig PRESERVES the stored one.
      const token = (typeof b.token === 'string' && b.token.trim() !== '') ? b.token.trim() : undefined;
      await setGitConfig({ token, username: b.username, host: b.host });
      res.end(JSON.stringify({ ok: true }));
    } catch (e: any) {
      res.statusCode = 500; res.end(JSON.stringify({ error: e.message }));
    }
    return;
  });

  router.delete('/git/config', async (req: Request, res: Response) => {
    try {
      await setGitConfig({ token: '' }); // '' → explicit clear of the token
      res.end(JSON.stringify({ ok: true }));
    } catch (e: any) {
      res.statusCode = 500; res.end(JSON.stringify({ error: e.message }));
    }
    return;
  });

  router.get('/git/status', async (req: Request, res: Response) => {
    try {
      const url = new URL(req.url, 'http://x');
      const repo = url.searchParams.get('repo') || await projectRepoPath(projectIdOf(req));
      const r = spawnSync('git', ['status', '--porcelain=v1', '-b'], { cwd: repo, encoding: 'utf8' });
      if (r.error || r.status !== 0) {
        res.end(JSON.stringify({ ok: false, error: (r.stderr || r.error?.message || 'git error').trim(), repo }));
        return;
      }
      const lines = (r.stdout || '').split('\n').filter(l => l.length > 0);
      let branch = '';
      let ahead = 0;
      let behind = 0;
      const files: Array<{ path: string; x: string; y: string; staged: boolean; label: string }> = [];
      const labelFor = (x: string, y: string): string => {
        if (x === '?' && y === '?') return 'Untracked';
        if (x === 'R' || y === 'R') return 'Renamed';
        if (x === 'C' || y === 'C') return 'Copied';
        if (x === 'A' || y === 'A') return 'Added';
        if (x === 'D' || y === 'D') return 'Deleted';
        if (x === 'U' || y === 'U') return 'Conflicted';
        if (x === 'M' || y === 'M') return 'Modified';
        if (x === 'T' || y === 'T') return 'TypeChanged';
        return 'Modified';
      };
      for (const line of lines) {
        if (line.startsWith('##')) {
          // e.g. "## main...origin/main [ahead 1, behind 2]" or "## main"
          const info = line.slice(3).trim();
          branch = info.split('...')[0].split(' ')[0].trim();
          const am = info.match(/ahead (\d+)/);
          const bm = info.match(/behind (\d+)/);
          if (am) ahead = parseInt(am[1], 10);
          if (bm) behind = parseInt(bm[1], 10);
          continue;
        }
        const x = line[0];
        const y = line[1];
        let path = line.slice(3);
        // Renamed/copied entries look like "old -> new" — take the new path.
        if (path.includes(' -> ')) path = path.split(' -> ')[1];
        const staged = x !== ' ' && x !== '?';
        files.push({ path, x, y, staged, label: labelFor(x, y) });
      }
      res.end(JSON.stringify({ ok: true, repo, branch, ahead, behind, clean: files.length === 0, files }));
    } catch (e: any) {
      res.statusCode = 500; res.end(JSON.stringify({ error: e.message }));
    }
    return;
  });

  router.get('/git/diff', async (req: Request, res: Response) => {
    try {
      const url = new URL(req.url, 'http://x');
      const repo = url.searchParams.get('repo') || await projectRepoPath(projectIdOf(req));
      const file = url.searchParams.get('file') || '';
      const r = spawnSync('git', ['diff', 'HEAD', '--', file], { cwd: repo, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
      let diff = r.stdout || '';
      if (!diff.trim() && file) {
        // Untracked/new file: `git diff HEAD` shows nothing. Try no-index vs /dev/null.
        const r2 = spawnSync('git', ['diff', '--no-index', '--', '/dev/null', file], { cwd: repo, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
        diff = (r2.stdout || '').trim() ? r2.stdout : '(untracked new file)';
      }
      res.end(JSON.stringify({ ok: true, diff }));
    } catch (e: any) {
      res.statusCode = 500; res.end(JSON.stringify({ error: e.message }));
    }
    return;
  });

  router.post('/git/clone', async (req: Request, res: Response) => {
    try {
      const body = await readBody(req);
      const b = body ? JSON.parse(body) : {};
      const url: string = String(b.url || '');
      let dir: string = String(b.dir || '');
      if (!url || !dir) { res.statusCode = 400; res.end(JSON.stringify({ error: 'url and dir are required' })); return; }
      // Resolve a RELATIVE target against the projects base (sibling of the orchestrator repo,
      // or PROJECTS_DIR) — never inside the orchestrator's own repo. Absolute paths are honored.
      if (!isAbsolute(dir)) dir = join(process.env.PROJECTS_DIR || join(process.cwd(), 'projects'), dir);
      const cloneProject = projectIdOf(req, b);
      // 'app:'<recordId> → mint a short-lived GitHub App installation token; else PAT/global.
      let cfg: { token?: string; username?: string; host?: string };
      const tokenId = b.tokenId ? String(b.tokenId) : '';
      if (tokenId.startsWith('app:')) {
        const minted = await mintInstallationToken(tokenId.slice(4));
        if (!minted) { res.statusCode = 400; res.end(JSON.stringify({ error: 'could not mint GitHub App installation token — is the app installed?' })); return; }
        cfg = { token: minted.token, username: minted.username, host: minted.host };
      } else {
        const tok = tokenId ? await getGitTokenRaw(tokenId) : null;
        cfg = tok ? { token: tok.token, username: tok.username, host: tok.host } : await getGitConfig();
      }
      const authUrl = authenticateGitUrl(url, cfg.token, cfg.username);
      // Ensure the parent dir exists so `git clone` into a nested path doesn't fail with
      // "could not create leading directories". git creates the leaf dir itself.
      try { const parent = dirname(dir); if (parent && parent !== '.') mkdirSync(parent, { recursive: true }); } catch { /* clone will surface a clearer error */ }
      const branch: string = String(b.branch || '').trim();
      // Async clone so the event loop stays free — the status widget can show "cloning".
      setActivity(cloneProject, 'cloning', 'Cloning repository', url);
      cloneProgress.set(cloneProject, { lines: [`$ git clone ${branch ? `-b ${branch} ` : ''}${url}`], done: false, ok: null, dir, startedAt: Date.now() });
      const cloneArgs = ['-c', 'credential.helper=', 'clone', '--progress', ...(branch ? ['-b', branch] : []), authUrl, dir];
      const stripTok = (s: string) => cfg.token ? s.split(cfg.token).join('***').split(encodeURIComponent(cfg.token)).join('***') : s;
      const r = await new Promise<{ status: number | null; out: string }>((resolve) => {
        // `-c credential.helper=` disables any (possibly broken) global helper — we auth
        // purely via the token baked into authUrl, so git must never call an external helper.
        const proc = spawn('git', cloneArgs, { shell: false });
        let out = '';
        const onData = (d: any) => { const s = stripTok(d.toString()); out += s; pushCloneOutput(cloneProject, s); };
        proc.stdout?.on('data', onData);
        proc.stderr?.on('data', onData);
        proc.on('exit', code => resolve({ status: code, out }));
        proc.on('error', err => resolve({ status: 1, out: String(err?.message || err) }));
      });
      clearActivity(cloneProject, 'cloning');
      const prog = cloneProgress.get(cloneProject);
      if (prog) { prog.done = true; prog.ok = r.status === 0; prog.lines.push(r.status === 0 ? '✓ Clone complete' : `✗ Clone failed (exit ${r.status})`); }
      let output = r.out;
      // NEVER echo the token back — strip it (and its url-encoded form) from output.
      if (cfg.token) {
        output = output.split(cfg.token).join('***');
        output = output.split(encodeURIComponent(cfg.token)).join('***');
      }
      // Persist the clone as a PROJECT so it's remembered (repo + folder + branch) and shows
      // up in the switcher / Repo / Context — never lost. First clone reuses the Default slot.
      let project: any = null;
      if (r.status === 0) {
        // The clone URL carried the token so git could authenticate; strip it back out of the
        // stored remote so the credential never persists in .git/config. Every fetch/push
        // injects a fresh token per-call (authenticateGitUrl), so a clean origin is all we keep.
        try { if (authUrl !== url) spawnSync('git', ['-C', dir, 'remote', 'set-url', 'origin', url], { encoding: 'utf8' }); } catch { /* non-fatal */ }
        try {
          const name = (dir.replace(/[\\/]+$/, '').split(/[\\/]+/).pop() || 'repo');
          const branchName = branch || (spawnSync('git', ['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).stdout || '').trim() || undefined;
          const allProjs = await listProjects();
          const existing = allProjs.find(p => p.repoPath && resolve(p.repoPath) === resolve(dir));
          const onlyDefault = allProjs.length === 1 && allProjs[0].id === 'default';
          if (existing) { await updateProject(existing.id, { repoPath: dir, branch: branchName, cloneUrl: url }); project = await getProject(existing.id); }
          else if (onlyDefault) { await updateProject('default', { name, repoPath: dir, branch: branchName, cloneUrl: url }); project = await getProject('default'); }
          else { project = await createProject({ name, repoPath: dir, branch: branchName, cloneUrl: url }); }
        } catch (e: any) { console.warn(`[db-server] clone→project persist: ${e?.message}`); }
      }
      res.end(JSON.stringify({ ok: r.status === 0, dir, output: output.trim(), project }));
    } catch (e: any) {
      res.statusCode = 500; res.end(JSON.stringify({ error: e.message }));
    }
    return;
  });

  // Live clone progress — the Clone tab polls this while a clone runs.
  router.get('/git/clone-progress', async (req: Request, res: Response) => {
    const p = cloneProgress.get(projectIdOf(req));
    res.end(JSON.stringify(p ? { lines: p.lines, done: p.done, ok: p.ok, dir: p.dir } : { lines: [], done: true, ok: null }));
    return;
  });

  // Delete a cloned repo folder (with guards). Frees the clone target so it can be re-cloned.
  router.post('/git/delete-repo', async (req: Request, res: Response) => {
    try {
      const b = JSON.parse(await readBody(req) || '{}');
      const target = String(b.dir || '').trim();
      if (!target) { res.statusCode = 400; res.end(JSON.stringify({ error: 'dir is required' })); return; }
      // Resolve a RELATIVE dir against the SAME base clone uses (projects base = parent of the
      // orchestrator repo, or PROJECTS_DIR) — otherwise delete targets the wrong folder.
      const base = process.env.PROJECTS_DIR || join(process.cwd(), 'projects');
      const abs = isAbsolute(target) ? resolve(target) : resolve(base, target);
      const key = (p: string) => resolve(p).replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase();
      // HARD GUARD on the FOLDER: this app may delete a folder ONLY when it is strictly inside the
      // managed projects/ directory. The app repo, its parent, a drive root, the base itself, and
      // ANY path outside projects/ (a pre-existing repo elsewhere on disk) are NEVER removed from
      // disk. Project DATA (tasks/embeddings/record) is still purged either way.
      const inside = key(abs).startsWith(key(base) + '/') && key(abs) !== key(base);
      let folderDeleted = false;
      if (inside && existsSync(abs)) { rmSync(abs, { recursive: true, force: true }); folderDeleted = true; }
      cloneProgress.delete(projectIdOf(req, b));
      // Completely remove the PROJECT that pointed at this folder — its tasks, embeddings DB, and
      // record — except the un-deletable 'default' (its repo is reset to the host).
      let removedProject: string | null = null;
      try {
        const owner = (await listProjects()).find(p => p.repoPath && key(p.repoPath) === key(abs));
        if (owner) {
          if (owner.id === 'default') await updateProject('default', { name: 'Default', repoPath: process.cwd(), branch: '', cloneUrl: '' });
          else { await purgeProjectData(owner.id); removedProject = owner.id; }
        }
      } catch (e: any) { console.warn(`[db-server] delete-repo project purge: ${e?.message}`); }
      res.end(JSON.stringify({ ok: true, folderDeleted, deleted: folderDeleted ? abs : null, folderKept: !inside, removedProject }));
    } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    return;
  });

  // Clone a git URL into a folder named exactly after the repo, then create (or, for the
  // first import, rename the Default slot to) the project pointing at it. Folder name ==
  // repository name == project label, so nothing can drift.
  router.post('/git/clone-import', async (req: Request, res: Response) => {
    try {
      const b = JSON.parse(await readBody(req) || '{}');
      const url: string = String(b.url || '').trim();
      if (!url) { res.statusCode = 400; res.end(JSON.stringify({ error: 'url is required' })); return; }
      const name = (url.replace(/[\\/]+$/, '').split(/[\\/:]+/).filter(Boolean).pop() || '').replace(/\.git$/i, '');
      if (!name) { res.statusCode = 400; res.end(JSON.stringify({ error: 'could not derive a repo name from the url' })); return; }
      // Clone as a sibling of this repo (override with PROJECTS_DIR) → e.g. C:\code\<name>.
      const base = process.env.PROJECTS_DIR || join(process.cwd(), 'projects');
      const dir = join(base, name);

      let cloned = false, output = '';
      if (existsSync(dir)) {
        // Adopt an existing checkout; refuse a non-git folder to avoid clobbering user data.
        if (!existsSync(join(dir, '.git'))) { res.statusCode = 409; res.end(JSON.stringify({ error: `folder already exists and is not a git repo: ${dir}` })); return; }
        output = `adopted existing repo at ${dir}`;
      } else {
        let cfg: { token?: string; username?: string; host?: string };
        const tokenId = b.tokenId ? String(b.tokenId) : '';
        if (tokenId.startsWith('app:')) {
          const minted = await mintInstallationToken(tokenId.slice(4));
          if (!minted) { res.statusCode = 400; res.end(JSON.stringify({ error: 'could not mint GitHub App installation token' })); return; }
          cfg = { token: minted.token, username: minted.username, host: minted.host };
        } else {
          const tok = tokenId ? await getGitTokenRaw(tokenId) : null;
          cfg = tok ? { token: tok.token, username: tok.username, host: tok.host } : await getGitConfig();
        }
        const authUrl = authenticateGitUrl(url, cfg.token, cfg.username);
        try { mkdirSync(base, { recursive: true }); } catch { /* clone surfaces a clearer error */ }
        const r = await new Promise<{ status: number | null; out: string }>((resolve) => {
          const proc = spawn('git', ['-c', 'credential.helper=', 'clone', authUrl, dir], { shell: false });
          let out = ''; proc.stdout?.on('data', d => out += d); proc.stderr?.on('data', d => out += d);
          proc.on('exit', code => resolve({ status: code, out })); proc.on('error', err => resolve({ status: 1, out: String(err?.message || err) }));
        });
        output = r.out;
        if (cfg.token) { output = output.split(cfg.token).join('***').split(encodeURIComponent(cfg.token)).join('***'); }
        if (r.status !== 0) { res.statusCode = 500; res.end(JSON.stringify({ error: `git clone failed: ${output.trim().slice(-500)}` })); return; }
        // Strip the token back out of the stored remote so it never persists in .git/config.
        try { if (authUrl !== url) spawnSync('git', ['-C', dir, 'remote', 'set-url', 'origin', url], { encoding: 'utf8' }); } catch { /* non-fatal */ }
        cloned = true;
      }

      // First import reuses the seeded Default slot; else a new project.
      const projects = await listProjects();
      const onlyDefault = projects.length === 1 && projects[0].id === 'default';
      let project;
      if (onlyDefault) { await updateProject('default', { name, repoPath: dir, emoji: b.emoji }); project = await getProject('default'); }
      else { project = await createProject({ name, repoPath: dir, emoji: b.emoji }); }
      res.end(JSON.stringify({ ok: true, project, cloned, dir, output: output.trim() }));
    } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    return;
  });

  router.post('/git/create-repo', async (req: Request, res: Response) => {
    try {
      const body = await readBody(req);
      const b = body ? JSON.parse(body) : {};
      // Repo creation via GitHub App is not wired up yet — require a PAT for this op.
      if (b.tokenId && String(b.tokenId).startsWith('app:')) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'repo creation via GitHub App not supported yet — use a PAT' }));
        return;
      }
      const tokC = b.tokenId ? await getGitTokenRaw(String(b.tokenId)) : null;
      const cfg = tokC ? { token: tokC.token } : await getGitConfig();
      if (!cfg.token) { res.statusCode = 400; res.end(JSON.stringify({ error: 'No GitHub token configured' })); return; }
      const name = String(b.name || '');
      if (!name) { res.statusCode = 400; res.end(JSON.stringify({ error: 'name is required' })); return; }
      const gh = await fetch('https://api.github.com/user/repos', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + cfg.token,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'ai-agents',
        },
        body: JSON.stringify({ name, private: !!b.private }),
      });
      const data: any = await gh.json().catch(() => ({}));
      if (!gh.ok) {
        res.end(JSON.stringify({ ok: false, error: data?.message || `GitHub API error ${gh.status}` }));
        return;
      }
      res.end(JSON.stringify({
        ok: true,
        repo: { full_name: data.full_name, clone_url: data.clone_url, html_url: data.html_url },
      }));
    } catch (e: any) {
      res.statusCode = 500; res.end(JSON.stringify({ error: e.message }));
    }
    return;
  });

  // ── git init-repo ── first-run "start in a new folder": create the folder, git-init it,
  // and register it as a project. Local-only counterpart to /git/clone (which needs a URL).
  router.post('/git/init-repo', async (req: Request, res: Response) => {
    try {
      const b = JSON.parse((await readBody(req)) || '{}');
      const name = String(b.name || '').trim();
      const rawDir = String(b.dir || '').trim();
      if (!name) { res.statusCode = 400; res.end(JSON.stringify({ error: 'name is required' })); return; }
      if (!rawDir) { res.statusCode = 400; res.end(JSON.stringify({ error: 'dir is required' })); return; }
      const dir = isAbsolute(rawDir) ? rawDir : resolve(process.cwd(), rawDir);
      mkdirSync(dir, { recursive: true });
      const inside = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: dir, encoding: 'utf-8', timeout: 5000 });
      if (inside.status !== 0) {
        const init = spawnSync('git', ['init'], { cwd: dir, encoding: 'utf-8', timeout: 10000 });
        if (init.status !== 0) { res.statusCode = 500; res.end(JSON.stringify({ error: `git init failed: ${(init.stderr || '').trim()}` })); return; }
      }
      // Worktree isolation needs a HEAD to branch from; give an empty repo one. Best-effort —
      // a repo with commits skips this, and a missing git identity falls back to an inline one.
      const hasHead = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf-8', timeout: 5000 }).status === 0;
      if (!hasHead) {
        spawnSync('git', ['-c', 'user.name=Piranha', '-c', 'user.email=piranha@localhost', 'commit', '--allow-empty', '-m', 'init'], { cwd: dir, encoding: 'utf-8', timeout: 10000 });
      }
      const project = await createProject({ name, repoPath: dir, emoji: b.emoji ? String(b.emoji) : undefined });
      res.end(JSON.stringify({ ok: true, dir, project }));
    } catch (e: any) {
      res.statusCode = 500; res.end(JSON.stringify({ error: e.message }));
    }
    return;
  });

  // ── git commit ── stage + commit in a repo/worktree. Author = repo git config.
  router.post('/git/commit', async (req: Request, res: Response) => {
    try {
      const b = JSON.parse((await readBody(req)) || '{}');
      const repo = String(b.repo || await projectRepoPath(projectIdOf(req, b)));
      const message = String(b.message || '').trim();
      if (!message) { res.statusCode = 400; res.end(JSON.stringify({ error: 'commit message is required' })); return; }
      if (b.addAll !== false) spawnSync('git', ['add', '-A'], { cwd: repo, encoding: 'utf8' });
      const r = spawnSync('git', ['commit', '-m', message], { cwd: repo, encoding: 'utf8' });
      const output = ((r.stdout || '') + (r.stderr || '')).trim();
      let hash = '';
      if (r.status === 0) { const h = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repo, encoding: 'utf8' }); hash = (h.stdout || '').trim(); }
      res.end(JSON.stringify({ ok: r.status === 0, hash, output }));
    } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    return;
  });

  // ── git push ── push a branch to origin using the stored token for https auth.
  router.post('/git/push', async (req: Request, res: Response) => {
    try {
      const b = JSON.parse((await readBody(req)) || '{}');
      const repo = String(b.repo || await projectRepoPath(projectIdOf(req, b)));
      // 'app:'<recordId> → mint a GitHub App installation token; else PAT/global config.
      let cfg: { token?: string; username?: string; host?: string };
      const pushTokenId = b.tokenId ? String(b.tokenId) : '';
      if (pushTokenId.startsWith('app:')) {
        const minted = await mintInstallationToken(pushTokenId.slice(4));
        if (!minted) { res.statusCode = 400; res.end(JSON.stringify({ error: 'could not mint GitHub App installation token — is the app installed?' })); return; }
        cfg = { token: minted.token, username: minted.username, host: minted.host };
      } else {
        const tokP = pushTokenId ? await getGitTokenRaw(pushTokenId) : null;
        cfg = tokP ? { token: tokP.token, username: tokP.username, host: tokP.host } : await getGitConfig();
      }
      const cur = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repo, encoding: 'utf8' });
      const branch = String(b.branch || (cur.stdout || '').trim() || 'HEAD');
      const originR = spawnSync('git', ['remote', 'get-url', String(b.remote || 'origin')], { cwd: repo, encoding: 'utf8' });
      const origin = (originR.stdout || '').trim();
      if (!origin) { res.statusCode = 400; res.end(JSON.stringify({ error: 'no origin remote — set one or clone first' })); return; }
      const authUrl = authenticateGitUrl(origin, cfg.token, cfg.username);
      // Push HEAD to the named branch and set upstream so future pushes are simple.
      const r = spawnSync('git', ['push', '-u', authUrl, `HEAD:${branch}`], { cwd: repo, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
      let output = ((r.stdout || '') + (r.stderr || '')).trim();
      if (cfg.token) { output = output.split(cfg.token).join('***').split(encodeURIComponent(cfg.token)).join('***'); }
      output = redactSecrets(output);
      res.end(JSON.stringify({ ok: r.status === 0, branch, output }));
    } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    return;
  });

  // ── git pull ── fetch + merge origin into the current branch (token auth for private https).
  router.post('/git/pull', async (req: Request, res: Response) => {
    try {
      const b = JSON.parse((await readBody(req)) || '{}');
      const repo = String(b.repo || await projectRepoPath(projectIdOf(req, b)));
      let cfg: { token?: string; username?: string; host?: string };
      const tid = b.tokenId ? String(b.tokenId) : '';
      if (tid.startsWith('app:')) { const m = await mintInstallationToken(tid.slice(4)); if (!m) { res.statusCode = 400; res.end(JSON.stringify({ error: 'could not mint GitHub App token' })); return; } cfg = { token: m.token, username: m.username, host: m.host }; }
      else { const t = tid ? await getGitTokenRaw(tid) : null; cfg = t ? { token: t.token, username: t.username, host: t.host } : await getGitConfig(); }
      const cur = (spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repo, encoding: 'utf8' }).stdout || '').trim();
      const origin = (spawnSync('git', ['remote', 'get-url', 'origin'], { cwd: repo, encoding: 'utf8' }).stdout || '').trim();
      if (!origin) { res.statusCode = 400; res.end(JSON.stringify({ error: 'no origin remote' })); return; }
      let authUrl = origin;
      authUrl = authenticateGitUrl(origin, cfg.token, cfg.username);
      const r = spawnSync('git', ['-c', 'credential.helper=', 'pull', '--no-edit', authUrl, cur], { cwd: repo, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
      let output = ((r.stdout || '') + (r.stderr || '')).trim();
      if (cfg.token) { output = output.split(cfg.token).join('***').split(encodeURIComponent(cfg.token)).join('***'); }
      output = redactSecrets(output);
      res.end(JSON.stringify({ ok: r.status === 0, branch: cur, output }));
    } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    return;
  });

  // ── remote branches ── list a REMOTE's branches without cloning (for the Clone picker).
  router.post('/git/remote-branches', async (req: Request, res: Response) => {
    try {
      const b = JSON.parse((await readBody(req)) || '{}');
      const url = String(b.url || '').trim();
      if (!url) { res.statusCode = 400; res.end(JSON.stringify({ error: 'url is required' })); return; }
      let cfg: { token?: string; username?: string };
      const tid = b.tokenId ? String(b.tokenId) : '';
      if (tid.startsWith('app:')) { const m = await mintInstallationToken(tid.slice(4)); cfg = m ? { token: m.token, username: m.username } : {}; }
      else { const t = tid ? await getGitTokenRaw(tid) : null; cfg = t ? { token: t.token, username: t.username } : await getGitConfig(); }
      let authUrl = url;
      authUrl = authenticateGitUrl(url, cfg.token, cfg.username);
      const r = spawnSync('git', ['-c', 'credential.helper=', 'ls-remote', '--heads', '--symref', authUrl], { encoding: 'utf8', timeout: 20000, maxBuffer: 8 * 1024 * 1024 });
      if (r.status !== 0) { let out = ((r.stdout || '') + (r.stderr || '')).trim(); if (cfg.token) out = out.split(cfg.token).join('***'); out = redactSecrets(out); res.statusCode = 400; res.end(JSON.stringify({ error: 'could not list branches', output: out.slice(-400) })); return; }
      const lines = (r.stdout || '').split('\n');
      let def = ''; const branches: string[] = [];
      for (const ln of lines) {
        const sym = ln.match(/^ref:\s+refs\/heads\/(\S+)\s+HEAD/); if (sym) { def = sym[1]; continue; }
        const m = ln.match(/refs\/heads\/(\S+)$/); if (m) branches.push(m[1]);
      }
      res.end(JSON.stringify({ ok: true, default: def, branches: Array.from(new Set(branches)).sort() }));
    } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    return;
  });

  // ── git branches ── list local + remote branches and the current one.
  router.get('/git/branches', async (req: Request, res: Response) => {
    try {
      const u = new URL(req.url!, 'http://x');
      const repo = u.searchParams.get('repo') || await projectRepoPath(projectIdOf(req));
      const cur = (spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repo, encoding: 'utf8' }).stdout || '').trim();
      const local = (spawnSync('git', ['branch', '--format=%(refname:short)'], { cwd: repo, encoding: 'utf8' }).stdout || '').split('\n').map(s => s.trim()).filter(Boolean);
      const remote = (spawnSync('git', ['branch', '-r', '--format=%(refname:short)'], { cwd: repo, encoding: 'utf8' }).stdout || '').split('\n').map(s => s.trim()).filter(b => b && !b.includes('HEAD ->')).map(b => b.replace(/^origin\//, ''));
      const all = Array.from(new Set([...local, ...remote])).sort();
      res.end(JSON.stringify({ ok: true, current: cur, branches: all, local }));
    } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    return;
  });

  // ── git checkout ── switch to an existing branch (creates a local tracking branch if remote-only).
  router.post('/git/checkout', async (req: Request, res: Response) => {
    try {
      const b = JSON.parse((await readBody(req)) || '{}');
      const repo = String(b.repo || await projectRepoPath(projectIdOf(req, b)));
      const branch = String(b.branch || '').trim();
      if (!branch) { res.statusCode = 400; res.end(JSON.stringify({ error: 'branch is required' })); return; }
      const r = spawnSync('git', ['checkout', branch], { cwd: repo, encoding: 'utf8' });
      const output = ((r.stdout || '') + (r.stderr || '')).trim();
      res.end(JSON.stringify({ ok: r.status === 0, branch, output }));
    } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    return;
  });

  // ── agent worktrees ── list OUR .worktrees/* and join the task board so the
  // user sees which agent (claimedBy) did which task, its branch, and whether merged.
  router.get('/git/worktrees', async (req: Request, res: Response) => {
    try {
      const wtProject = projectIdOf(req);
      const repoRoot = await projectRepoPath(wtProject);
      const list = spawnSync('git', ['worktree', 'list', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' });
      // git prints worktree paths with FORWARD slashes (C:/code/...) even on Windows, while
      // path.join produces BACKslashes (C:\code\...). Comparing them with startsWith silently
      // matched nothing, so the UI showed "no worktrees" while they sat right there on disk.
      // Normalise both to forward slashes before comparing.
      const norm = (p: string) => p.replace(/\\/g, '/');
      const wtDir = norm(join(repoRoot, '.worktrees'));
      const tasks = await getAllTasks(wtProject);
      const byId = new Map(tasks.map((t: any) => [t.id, t]));
      const out: any[] = [];
      for (const block of (list.stdout || '').split('\n\n')) {
        const pm = block.match(/^worktree (.+)$/m);
        const bm = block.match(/^branch (.+)$/m);
        const hm = block.match(/^HEAD (.+)$/m);
        if (!pm) continue;
        const path = pm[1].trim();
        if (!norm(path).startsWith(wtDir)) continue; // only agent worktrees
        const ref = (bm ? bm[1].trim() : '').replace('refs/heads/', '');
        const name = path.split(/[\\/]/).pop() || '';
        const isPlan = name.startsWith('plan-');
        const taskId = name.replace(/^plan-/, '');
        const task: any = byId.get(taskId) || byId.get(name);
        // last commit subject/author/sha on this worktree's HEAD
        const lc = spawnSync('git', ['log', '-1', '--pretty=format:%h%x1f%an%x1f%ad%x1f%s', '--date=iso', 'HEAD'], { cwd: path, encoding: 'utf8' });
        const [sha = '', author = '', date = '', subject = ''] = (lc.stdout || '').split('\x1f');
        // merged into main HEAD?
        let merged = false;
        if (ref) { const anc = spawnSync('git', ['merge-base', '--is-ancestor', ref, 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }); merged = anc.status === 0; }
        out.push({
          path, name, taskId, branch: ref, isPlan,
          head: hm ? hm[1].trim().slice(0, 7) : sha,
          lastCommit: { sha, author, date, subject },
          merged,
          agent: task?.claimedBy || null,
          title: task?.title || null,
          status: task?.status || null,
          stage: task?.stage || null,
        });
      }
      res.end(JSON.stringify({ ok: true, worktrees: out }));
    } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    return;
  });

  // ── git log ── commit history for a repo/worktree/branch (who committed what).
  router.get('/git/log', async (req: Request, res: Response) => {
    try {
      const url = new URL(req.url, 'http://x');
      const repo = url.searchParams.get('repo') || await projectRepoPath(projectIdOf(req));
      const ref = url.searchParams.get('ref') || '';
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 300);
      const args = ['log', `-n${limit}`, '--pretty=format:%H%x1f%h%x1f%an%x1f%ae%x1f%ad%x1f%P%x1f%s', '--date=iso'];
      if (ref) args.push(ref);
      const r = spawnSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
      if (r.error || r.status !== 0) { res.end(JSON.stringify({ ok: false, error: (r.stderr || r.error?.message || 'git error').trim() })); return; }
      const commits = (r.stdout || '').split('\n').filter(Boolean).map(line => {
        const [hash, shortHash, author, email, date, parents, subject] = line.split('\x1f');
        const parentList = (parents || '').trim().split(/\s+/).filter(Boolean);
        return { hash, shortHash, author, email, date, subject, merge: parentList.length > 1 };
      });
      res.end(JSON.stringify({ ok: true, repo, ref, commits }));
    } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    return;
  });

  // ── git show ── a single commit's files + diff (drill-down from the log view).
  router.get('/git/show', async (req: Request, res: Response) => {
    try {
      const url = new URL(req.url, 'http://x');
      const repo = url.searchParams.get('repo') || await projectRepoPath(projectIdOf(req));
      const hash = url.searchParams.get('hash') || '';
      if (!hash) { res.statusCode = 400; res.end(JSON.stringify({ error: 'hash is required' })); return; }
      const ns = spawnSync('git', ['show', '--no-color', '--name-status', '--pretty=format:%an%x1f%ae%x1f%ad%x1f%s', '--date=iso', hash], { cwd: repo, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
      const lines = (ns.stdout || '').split('\n');
      const [author = '', email = '', date = '', subject = ''] = (lines[0] || '').split('\x1f');
      const files = lines.slice(1).filter(Boolean).filter(l => /^[A-Z]\d*\t/.test(l)).map(l => {
        const parts = l.split('\t');
        return { status: parts[0][0], path: parts[parts.length - 1] };
      });
      const diffR = spawnSync('git', ['show', '--no-color', hash], { cwd: repo, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
      res.end(JSON.stringify({ ok: true, hash, author, email, date, subject, files, diff: diffR.stdout || '' }));
    } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    return;
  });

  // ── multi-token management ── list/add/update/delete labeled PATs (tokens masked on read).
  router.get('/git/tokens', async (req: Request, res: Response) => {
    try {
      const pid = projectIdOf(req);
      const toks: any[] = (await listGitTokensRaw(pid)).map(t => ({
        id: t.id, label: t.label, scope: t.scope, username: t.username || '', host: t.host,
        createdAt: t.createdAt, tokenMasked: maskToken(t.token), source: 'pat',
      }));
      // Append INSTALLED GitHub Apps as pseudo-tokens so the pickers can offer them.
      // Their id is 'app:'+recordId; git ops mint an installation token on demand.
      for (const a of await listGithubAppsRaw(pid)) {
        if (!a.installationId) continue;
        toks.push({
          id: 'app:' + a.id, label: 'GitHub App: ' + (a.name || a.slug || a.id),
          scope: 'readwrite', username: 'x-access-token', host: 'github.com',
          source: 'github-app', tokenMasked: 'auto (installation token)', createdAt: a.createdAt,
        });
      }
      res.end(JSON.stringify({ ok: true, tokens: toks }));
    } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    return;
  });
  router.post('/git/tokens', async (req: Request, res: Response) => {
    try {
      const b = JSON.parse((await readBody(req)) || '{}');
      if (!b.token || !String(b.token).trim()) { res.statusCode = 400; res.end(JSON.stringify({ error: 'token is required' })); return; }
      const row = await addGitToken({ label: b.label, token: String(b.token).trim(), scope: b.scope, username: b.username, host: b.host }, projectIdOf(req, b));
      res.end(JSON.stringify({ ok: true, id: row.id }));
    } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    return;
  });
  router.put('/git/tokens/:id', async (req: Request, res: Response) => {
    const m = req.url?.match(/^\/git\/tokens\/([^/?]+)(?:\?.*)?$/);
    if (m && req.method === 'PUT') {
      try {
        const b = JSON.parse((await readBody(req)) || '{}');
        await updateGitToken(decodeURIComponent(m[1]), { label: b.label, token: b.token, scope: b.scope, username: b.username, host: b.host });
        res.end(JSON.stringify({ ok: true }));
      } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
      return;
    }
  });
  router.delete('/git/tokens/:id', async (req: Request, res: Response) => {
    const m = req.url?.match(/^\/git\/tokens\/([^/?]+)(?:\?.*)?$/);
    if (m && req.method === 'DELETE') {
      try { await deleteGitToken(decodeURIComponent(m[1])); res.end(JSON.stringify({ ok: true })); }
      catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
      return;
    }
  });

  // ── per-agent token assignment ── which PAT each agent authenticates git with.
  router.get('/git/assignments', async (req: Request, res: Response) => {
    try {
      const assignments = await getTokenAssignments(projectIdOf(req));
      let agents: any[] = [];
      try { const { getAgents } = await import('../../agentic/index.ts'); agents = (await getAgents()).map((a: any) => ({ role: a.role, label: a.label })); }
      catch { /* agents optional */ }
      res.end(JSON.stringify({ ok: true, assignments, agents }));
    } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    return;
  });
  router.put('/git/assignments', async (req: Request, res: Response) => {
    try {
      const b = JSON.parse((await readBody(req)) || '{}');
      if (!b.agent) { res.statusCode = 400; res.end(JSON.stringify({ error: 'agent is required' })); return; }
      await setTokenAssignment(String(b.agent), b.tokenId ? String(b.tokenId) : null, projectIdOf(req, b));
      res.end(JSON.stringify({ ok: true }));
    } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    return;
  });

  // ── create branch ── git checkout -b <name> [from] in a repo/worktree.
  router.post('/git/branch', async (req: Request, res: Response) => {
    try {
      const b = JSON.parse((await readBody(req)) || '{}');
      const repo = String(b.repo || await projectRepoPath(projectIdOf(req, b)));
      const name = String(b.name || '').trim();
      if (!name) { res.statusCode = 400; res.end(JSON.stringify({ error: 'branch name is required' })); return; }
      const args = ['checkout', '-b', name];
      if (b.from && String(b.from).trim()) args.push(String(b.from).trim());
      const r = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
      const output = ((r.stdout || '') + (r.stderr || '')).trim();
      res.end(JSON.stringify({ ok: r.status === 0, branch: name, output }));
    } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    return;
  });

  // ─── GitHub App integration (Coolify-style manifest flow) ───────────────────
  // ADDED ALONGSIDE the PATs above (PATs untouched). The browser POSTs a manifest to
  // GitHub, GitHub auto-generates the App + private key and redirects to our callback,
  // we convert it, the user installs it, and thereafter we auto-mint short-lived
  // installation tokens for clone/push — no hand-crafted PAT.
  // SECURITY: the App's private key / secrets are stored plaintext locally (same model
  // as PATs) and NEVER sent raw over HTTP; minted tokens are stripped from git output.
  const DB_PUBLIC_URL = process.env.DB_PUBLIC_URL || `http://127.0.0.1:${PORT}`;
  const APP_UI_URL = process.env.APP_UI_URL || 'http://localhost:6951';

  // POST /git/github-app/manifest → create a pending record + return the manifest the
  // browser submits to GitHub. `state` (the record id) is echoed back to our callback.
  router.post('/git/github-app/manifest', async (req: Request, res: Response) => {
    try {
      const b = JSON.parse((await readBody(req)) || '{}');
      const pid = projectIdOf(req, b);
      const short = Math.random().toString(36).slice(2, 8);
      const name = (b.name && String(b.name).trim()) || `ai-agents-${short}`;
      const { id } = await createPendingGithubApp(pid, name);
      const org = b.org ? String(b.org).trim() : '';
      const postUrl = org
        ? `https://github.com/organizations/${encodeURIComponent(org)}/settings/apps/new?state=${encodeURIComponent(id)}`
        : `https://github.com/settings/apps/new?state=${encodeURIComponent(id)}`;
      const default_permissions = b.permissions && typeof b.permissions === 'object'
        ? b.permissions
        : { contents: 'write', administration: 'write', metadata: 'read', pull_requests: 'write', workflows: 'write' };
      // Prefer the host the browser is actually on (sent by the frontend) so the OAuth
      // callback resolves over LAN/remote, not just 127.0.0.1. Fall back to env/defaults.
      const dbBase = (b.dbPublicUrl && /^https?:\/\//.test(b.dbPublicUrl)) ? String(b.dbPublicUrl).replace(/\/$/, '') : DB_PUBLIC_URL;
      const uiUrl = (b.appUiUrl && /^https?:\/\//.test(b.appUiUrl)) ? String(b.appUiUrl).replace(/\/$/, '') : APP_UI_URL;
      const manifest = {
        name,
        url: uiUrl,
        redirect_url: `${dbBase}/git/github-app/callback`,
        // setup_url: where GitHub sends the browser AFTER the user installs the app. It
        // appends ?installation_id=&setup_action=; we encode our record id in the path so
        // the handler can mark the right app installed and bounce back to the UI.
        setup_url: `${dbBase}/git/github-app/setup/${encodeURIComponent(id)}`,
        setup_on_update: true,
        public: false,
        default_permissions,
        default_events: [],
      };
      res.end(JSON.stringify({ ok: true, state: id, postUrl, manifest }));
    } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    return;
  });

  // POST /git/github-app/manual → connect an ALREADY-EXISTING GitHub App by App ID + a
  // freshly-generated private key (.pem). Used when the manifest flow was interrupted, or
  // the user already made an app. We store it like a manifest-created app, then try to
  // auto-detect its installation so it's immediately usable. The user supplies exactly one
  // app — we never enumerate their other apps.
  router.post('/git/github-app/manual', async (req: Request, res: Response) => {
    try {
      const b = JSON.parse((await readBody(req)) || '{}');
      const pid = projectIdOf(req, b);
      const appId = String(b.appId || '').trim();
      const privateKey = String(b.privateKey || '').trim();
      const name = (b.name && String(b.name).trim()) || `github-app-${appId || 'manual'}`;
      const slug = b.slug ? String(b.slug).trim() : undefined;
      if (!/^\d+$/.test(appId)) { res.statusCode = 400; res.end(JSON.stringify({ error: 'App ID must be numeric (find it on the app\'s settings page).' })); return; }
      if (!/BEGIN[\s\S]*PRIVATE KEY[\s\S]*END/.test(privateKey)) { res.statusCode = 400; res.end(JSON.stringify({ error: 'Private key must be a full PEM (-----BEGIN ... PRIVATE KEY-----).' })); return; }
      const { id } = await createPendingGithubApp(pid, name);
      await updateGithubApp(id, { appId, privateKey, name, slug, state: 'created' });
      // Best-effort auto-detect: sign a JWT with the key and look up installations.
      let installed = false; let account: string | null = null; let detectError: string | null = null;
      try {
        const installs = await listAppInstallations(appId, privateKey);
        if (installs.length) {
          const inst = installs.sort((a: any, c: any) => new Date(c.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())[0];
          account = inst?.account?.login || null;
          await updateGithubApp(id, { installationId: String(inst.id), account, state: 'installed' });
          installed = true;
        }
      } catch (e: any) { detectError = e?.message || 'could not reach GitHub to detect installation'; }
      res.end(JSON.stringify({ ok: true, id, installed, account, detectError }));
    } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    return;
  });

  // GET /git/github-app/callback?code=&state= → GitHub redirects the BROWSER here after
  // "Create GitHub App". We convert the manifest code into the App (id, slug, pem, …),
  // then serve an HTML page that bounces the browser to the install screen.
  router.get('/git/github-app/callback', async (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    const htmlPage = (title: string, bodyHtml: string, redirectTo?: string) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>${redirectTo ? `<meta http-equiv="refresh" content="2;url=${redirectTo}">` : ''}<style>body{font-family:system-ui,sans-serif;max-width:640px;margin:64px auto;padding:0 20px;line-height:1.5;color:#111}a{color:#0969da}.card{border:1px solid #d0d7de;border-radius:12px;padding:24px}</style></head><body><div class="card">${bodyHtml}</div>${redirectTo ? `<script>setTimeout(function(){location.href=${JSON.stringify(redirectTo)}},1500)</script>` : ''}</body></html>`;
    try {
      const u = new URL(req.url, 'http://x');
      const code = u.searchParams.get('code') || '';
      const state = u.searchParams.get('state') || '';
      const rec = state ? await getGithubApp(state) : null;
      if (!code || !rec) {
        res.statusCode = 400;
        res.end(htmlPage('GitHub App error', `<h2>Could not complete setup</h2><p>${!code ? 'Missing code from GitHub.' : 'Unknown or expired setup session.'}</p><p><a href="${APP_UI_URL}">Return to the app</a></p>`));
        return;
      }
      const gh = await fetch(`https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`, {
        method: 'POST',
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'ai-agents' },
      });
      const data: any = await gh.json().catch(() => ({}));
      if (!gh.ok || !data?.id) {
        res.statusCode = 502;
        res.end(htmlPage('GitHub App error', `<h2>GitHub App conversion failed</h2><p>${(data?.message || `GitHub API error ${gh.status}`)}</p><p><a href="${APP_UI_URL}">Return to the app</a></p>`));
        return;
      }
      await updateGithubApp(rec.id, {
        appId: String(data.id),
        slug: data.slug,
        name: data.name || rec.name,
        privateKey: data.pem,
        clientId: data.client_id,
        clientSecret: data.client_secret,
        webhookSecret: data.webhook_secret,
        htmlUrl: data.html_url,
        state: 'created',
      });
      const installUrl = `https://github.com/apps/${data.slug}/installations/new`;
      res.end(htmlPage('GitHub App created', `<h2>GitHub App created ✓ — opening install…</h2><p>Redirecting you to install <b>${data.slug}</b> on your repositories.</p><p>If it doesn't open, <a href="${installUrl}">click here to install</a>.</p><hr><p>After installing, <a href="${APP_UI_URL}">return to the app</a> and click <b>Detect installation</b>.</p>`, installUrl));
    } catch (e: any) {
      res.statusCode = 500;
      res.end(htmlPage('GitHub App error', `<h2>Setup error</h2><p>${e.message}</p><p><a href="${APP_UI_URL}">Return to the app</a></p>`));
    }
    return;
  });

  // GET /git/github-app/setup/:state?installation_id=&setup_action= → GitHub redirects the
  // BROWSER here right after the user installs the app. We record the installation on the
  // matching record (so it becomes a usable token) and bounce back to the UI — no manual
  // "Detect installation" needed.
  router.get('/git/github-app/setup/:state', async (req: Request, res: Response) => {
    const m = req.url?.match(/^\/git\/github-app\/setup\/([^/?]+)(?:\?.*)?$/);
    if (m && req.method === 'GET') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      const bounce = (title: string, msg: string) =>
        `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><meta http-equiv="refresh" content="1;url=${APP_UI_URL}"><style>body{font-family:system-ui,sans-serif;max-width:640px;margin:64px auto;padding:0 20px;line-height:1.5;color:#111}a{color:#0969da}.card{border:1px solid #d0d7de;border-radius:12px;padding:24px}</style></head><body><div class="card"><h2>${title}</h2><p>${msg}</p><p><a href="${APP_UI_URL}">Return to the app now →</a></p></div><script>setTimeout(function(){location.href=${JSON.stringify(APP_UI_URL)}},1000)</script></body></html>`;
      try {
        const u = new URL(req.url!, 'http://x');
        const state = decodeURIComponent(m[1]);
        const installationId = u.searchParams.get('installation_id') || '';
        const rec = await getGithubApp(state);
        if (!rec?.appId || !rec.privateKey) {
          res.statusCode = 400;
          res.end(bounce('Setup session expired', 'Could not match this install to a pending app. Open the app and click Detect installation.'));
          return;
        }
        // Resolve the account login for the installation (best-effort) via an App JWT.
        let account: string | null = rec.account || null;
        try {
          const installs = await listAppInstallations(rec.appId, rec.privateKey);
          const inst = installationId
            ? installs.find((i: any) => String(i.id) === String(installationId))
            : installs.sort((a: any, b: any) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())[0];
          if (inst) {
            await updateGithubApp(rec.id, { installationId: String(inst.id), account: inst.account?.login || account, state: 'installed' });
            account = inst.account?.login || account;
          } else if (installationId) {
            await updateGithubApp(rec.id, { installationId, state: 'installed' });
          }
        } catch { /* keep going — installation_id from the redirect is enough to mint tokens */
          if (installationId) await updateGithubApp(rec.id, { installationId, state: 'installed' });
        }
        res.end(bounce('Installed ✓', `<b>${rec.name}</b> is connected${account ? ` on ${account}` : ''}. It's now available as a token in Clone/Push.`));
      } catch (e: any) {
        res.statusCode = 500;
        res.end(bounce('Setup error', e.message));
      }
      return;
    }
  });

  // GET /git/github-apps?project=<id> → masked list (never secrets).
  router.get('/git/github-apps', async (req: Request, res: Response) => {
    try {
      res.end(JSON.stringify({ ok: true, apps: await listGithubApps(projectIdOf(req)) }));
    } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    return;
  });

  // POST /git/github-apps/:id/detect-installation → find the installation via an App JWT.
  router.post('/git/github-apps/:id/detect-installation', async (req: Request, res: Response) => {
    const m = req.url?.match(/^\/git\/github-apps\/([^/?]+)\/detect-installation(?:\?.*)?$/);
    if (m && req.method === 'POST') {
      try {
        const rec = await getGithubApp(decodeURIComponent(m[1]));
        if (!rec?.appId || !rec.privateKey) { res.statusCode = 400; res.end(JSON.stringify({ error: 'app not created yet' })); return; }
        const installs = await listAppInstallations(rec.appId, rec.privateKey);
        if (!installs.length) { res.end(JSON.stringify({ ok: true, installed: false, account: null })); return; }
        // Newest/first installation wins.
        const inst = installs.sort((a: any, b: any) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())[0];
        const account = inst?.account?.login || null;
        await updateGithubApp(rec.id, { installationId: String(inst.id), account, state: 'installed' });
        res.end(JSON.stringify({ ok: true, installed: true, account }));
      } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
      return;
    }
  });

  // GET /git/github-apps/:id/repos → repos this installation can access, for the clone picker.
  router.get('/git/github-apps/:id/repos', async (req: Request, res: Response) => {
    const m = req.url?.match(/^\/git\/github-apps\/([^/?]+)\/repos(?:\?.*)?$/);
    if (m && req.method === 'GET') {
      try {
        const id = decodeURIComponent(m[1]);
        const rec = await getGithubApp(id);
        if (!rec?.installationId) { res.statusCode = 400; res.end(JSON.stringify({ error: 'app not installed yet — click Detect installation first' })); return; }
        const repos = await listInstallationRepos(id);
        res.end(JSON.stringify({ ok: true, repos }));
      } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
      return;
    }
  });

  // PATCH /git/github-apps/:id → rename (label) an existing app. Only `name` is editable.
  const renameGithubApp = async (req: Request, res: Response) => {
    const m = req.url?.match(/^\/git\/github-apps\/([^/?]+)(?:\?.*)?$/);
    if (m && (req.method === 'PATCH' || req.method === 'PUT')) {
      try {
        const b = JSON.parse((await readBody(req)) || '{}');
        const id = decodeURIComponent(m[1]);
        const name = String(b.name ?? '').trim();
        if (!name) { res.statusCode = 400; res.end(JSON.stringify({ error: 'name is required' })); return; }
        if (!await getGithubApp(id)) { res.statusCode = 404; res.end(JSON.stringify({ error: 'app not found' })); return; }
        await updateGithubApp(id, { name });
        res.end(JSON.stringify({ ok: true }));
      } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
      return;
    }
  };
  router.patch('/git/github-apps/:id', renameGithubApp);
  router.put('/git/github-apps/:id', renameGithubApp);

  // DELETE /git/github-apps/:id
  router.delete('/git/github-apps/:id', async (req: Request, res: Response) => {
    const m = req.url?.match(/^\/git\/github-apps\/([^/?]+)(?:\?.*)?$/);
    if (m && req.method === 'DELETE') {
      try { await deleteGithubApp(decodeURIComponent(m[1])); res.end(JSON.stringify({ ok: true })); }
      catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
      return;
    }
  });
}
