// ─────────────────────────────────────────────────────────────────────────────
// Project brief — the cached "context brain" for agents.
//
// One LLM pass at index-build time distills the repo's structure (file tree, key
// exports, dependency hubs) into a compact onboarding brief, stored in the code
// index's `meta` table. Every agent (architect/dev/QA) then reads it for FREE from
// its prompt — no per-agent, per-lookup LLM cost. Regenerated on each full build.
// ─────────────────────────────────────────────────────────────────────────────

import { spawn } from 'node:child_process';
import type { DatabaseSync } from 'node:sqlite';
import { getDbFor } from './db.js';

const BRIEF_KEY = 'project_brief';
const BRIEF_AT = 'project_brief_at';
const BRIEF_MODEL = 'project_brief_model';

export interface ProjectBrief { brief: string; generatedAt: string | null; model: string | null }

export function getProjectBrief(projectId = 'default'): ProjectBrief | null {
  try {
    const db = getDbFor(projectId);
    const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(BRIEF_KEY) as { value: string } | undefined;
    if (!row?.value) return null;
    const at = db.prepare('SELECT value FROM meta WHERE key = ?').get(BRIEF_AT) as { value: string } | undefined;
    const md = db.prepare('SELECT value FROM meta WHERE key = ?').get(BRIEF_MODEL) as { value: string } | undefined;
    return { brief: row.value, generatedAt: at?.value ?? null, model: md?.value ?? null };
  } catch { return null; }
}

function setProjectBrief(projectId: string, brief: string, model: string): void {
  const db = getDbFor(projectId);
  const put = db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');
  put.run(BRIEF_KEY, brief);
  put.run(BRIEF_AT, new Date().toISOString());
  put.run(BRIEF_MODEL, model);
}

// Compact, bounded digest of repo structure for the LLM to summarize. Kept small on
// purpose — the goal is signal (where things live, what's central), not full source.
function buildDigest(db: DatabaseSync): string {
  const files = db.prepare('SELECT path FROM files ORDER BY path').all() as { path: string }[];
  if (!files.length) return '';

  // Directory histogram (top two path segments) — shows the shape of the codebase.
  const dirCounts = new Map<string, number>();
  for (const f of files) {
    const seg = f.path.split('/').slice(0, 2).join('/');
    dirCounts.set(seg, (dirCounts.get(seg) || 0) + 1);
  }
  const dirs = [...dirCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)
    .map(([d, c]) => `  ${d}  (${c} files)`).join('\n');

  // Dependency hubs — most-imported files are usually the core modules.
  const hubs = (db.prepare(`
    SELECT f.path AS path, COUNT(*) AS c
    FROM edges e JOIN files f ON e.to_file = f.id
    GROUP BY e.to_file ORDER BY c DESC LIMIT 15
  `).all() as { path: string; c: number }[]).map(h => `  ${h.path}  (imported by ${h.c})`).join('\n');

  // A sample of exported symbols, grouped by file — the public surface.
  const exports = db.prepare(`
    SELECT f.path AS path, n.name AS name, n.type AS type, n.signature AS signature
    FROM nodes n JOIN files f ON n.file_id = f.id
    WHERE n.signature LIKE 'export%'
    ORDER BY f.path LIMIT 180
  `).all() as { path: string; name: string; type: string; signature: string }[];
  const byFile = new Map<string, string[]>();
  for (const e of exports) {
    const arr = byFile.get(e.path) || [];
    if (arr.length < 6) arr.push(`${e.type} ${e.name}`);
    byFile.set(e.path, arr);
  }
  const surface = [...byFile.entries()].slice(0, 60)
    .map(([p, syms]) => `  ${p}: ${syms.join(', ')}`).join('\n');

  return [
    `FILE COUNT: ${files.length}`,
    '',
    'TOP DIRECTORIES:',
    dirs,
    '',
    'DEPENDENCY HUBS (most-imported = likely core):',
    hubs || '  (none resolved)',
    '',
    'EXPORTED SURFACE (sample):',
    surface || '  (none)',
  ].join('\n').slice(0, 12000);
}

function askClaude(prompt: string, cwd: string): Promise<string> {
  const bin = process.env.CLAUDE_BIN || 'claude';
  const model = process.env.CONTEXT_MODEL || process.env.RAG_MODEL || 'sonnet';
  const flags = (process.env.CLAUDE_FLAGS || '--dangerously-skip-permissions').split(' ').filter(Boolean);
  const args = ['-p', '--model', model, '--output-format', 'text', ...flags];
  return new Promise((resolve, reject) => {
    let out = '', err = '', settled = false;
    const done = (fn: () => void) => { if (settled) return; settled = true; clearTimeout(timer); fn(); };
    let proc: ReturnType<typeof spawn>;
    try { proc = spawn(bin, args, { cwd, shell: false }); }
    catch (e: any) { return reject(new Error(`launch ${bin}: ${e?.message || e}`)); }
    const timer = setTimeout(() => { try { proc.kill(); } catch { /* gone */ } done(() => reject(new Error('claude timed out (120s)'))); }, 120000);
    proc.stdout?.on('data', d => { out += d.toString(); });
    proc.stderr?.on('data', d => { err += d.toString(); });
    proc.on('error', e => done(() => reject(new Error(`run ${bin}: ${e?.message || e}`))));
    proc.on('close', () => done(() => out.trim() ? resolve(out.trim()) : reject(new Error(err.trim().slice(0, 400) || 'empty answer'))));
    try { proc.stdin?.write(prompt); proc.stdin?.end(); } catch { /* pipe closed */ }
  });
}

/** Generate + store the project brief. Returns the brief text, or throws on failure.
 *  Best-effort at call sites — a missing brief must never block a build or a dispatch. */
export async function generateProjectBrief(projectId = 'default', cwd = process.cwd()): Promise<string> {
  const db = getDbFor(projectId);
  const digest = buildDigest(db);
  if (!digest) throw new Error('index is empty — nothing to summarize (build the index first)');

  const model = process.env.CONTEXT_MODEL || process.env.RAG_MODEL || 'sonnet';
  const prompt = [
    'You are onboarding a new engineer to a codebase. Using ONLY the structural digest',
    'below (file tree, dependency hubs, exported surface), write a concise ORIENTATION',
    'BRIEF that a coding agent can read before starting any task. Cover:',
    '  1. What this project is / does (infer from structure).',
    '  2. Main directories and their responsibility.',
    '  3. Entry points and the core/central modules (use the dependency hubs).',
    '  4. Notable conventions or patterns you can infer.',
    'Be specific and reference real paths. Max ~400 words. Markdown. No preamble, no',
    '"here is the brief" — just the brief. Do not invent details not supported by the digest.',
    '',
    'STRUCTURAL DIGEST:',
    digest,
  ].join('\n');

  const brief = await askClaude(prompt, cwd);
  setProjectBrief(projectId, brief, model);
  return brief;
}
