// ─────────────────────────────────────────────────────────────────────────────
// agentic-core — prompt rendering
// Fills an agent's template with the task context + the seam outputs (memory,
// blast radius, docs) the moment before dispatch. Async because memory recall and
// impact analysis are async.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Task, AgentRole, AgentConfig } from '../types';
import { getConfig } from '../runtime-context';
import { scenariosToGherkin, getProject } from '../db/tasks';
import { keepInContext, estimateTokens } from '../db/context';

// Project rule files agents must obey — team conventions, functionality index, agent guides.
// Checked in order; the first-found variants are surfaced. Extend freely.
const RULE_FILES = [
  'CLAUDE.md', 'AGENTS.md', 'AGENT.md', '.cursorrules', '.windsurfrules',
  '.github/copilot-instructions.md', 'RULES.md', 'CONVENTIONS.md',
  'FUNCTIONALITY.md', 'functionality-index.md', 'docs/functionality-index.md',
  'ARCHITECTURE.md', 'docs/ARCHITECTURE.md', 'CONTRIBUTING.md',
];

/** Find project rule files present in the repo, and pin them into the project's context so
 *  they persist by default. Returns a prompt block instructing the agent to read + follow them. */
function rulesBlock(task: Task): string {
  let root = process.cwd();
  try { const p = getProject((task as any).projectId || 'default'); if (p?.repoPath) root = p.repoPath; } catch { /* default */ }
  const found = RULE_FILES.filter(f => { try { return existsSync(join(root, f)) && statSync(join(root, f)).isFile(); } catch { return false; } });
  if (found.length === 0) return '';
  // Auto-keep (pinned) in the project context so the rules stay in memory across the pipeline.
  const projectId = (task as any).projectId || 'default';
  for (const f of found) {
    try { keepInContext({ projectId, path: f, tokens: estimateTokens(statSync(join(root, f)).size), addedBy: 'rules', pinned: true, taskId: task.id }); }
    catch { /* context store optional — never block a dispatch */ }
  }
  return [
    'PROJECT RULES — read these FIRST and follow them; they encode the team\'s conventions and',
    'override generic defaults. They are pinned in your context for the whole pipeline:',
    ...found.map(f => `  - ${f}`),
    'Comply with every rule in these files. If a rule conflicts with the task, flag it in your plan.',
  ].join('\n');
}

/** SEARCH PROTOCOL, scoped to the task's project. The index is ONE shared database served by
 *  the db daemon, so it works from your worktree with no local db file. `db:search` auto-scopes
 *  to this project via CODE_INDEX_PROJECT; the curl form is the portable fallback for repos whose
 *  own package.json has no db:search script (e.g. a non-default project's cloned repo). */
function searchProtocolFor(projectId: string): string {
  return [
    'SEARCH PROTOCOL — query the shared code index FIRST (cheap, indexed; served by the db daemon,',
    'so it works from your worktree with no local db file). Do this BEFORE any grep/glob or reading',
    'whole directories, and only fall back to those when the index returns nothing. Your searches',
    'are audited per task — grepping when the index would have answered is a token-burn flag.',
    '  pnpm run db:search -- "<symbol or concept>"',
    'If that script is unavailable in this repo, hit the daemon directly (same shared index).',
    'Keep the $AGENT_NAME / $TASK_ID vars in the JSON so your index use is attributed in the audit',
    '(they are pre-set in your shell — do NOT hard-code or drop them, or the search goes unlogged):',
    `  curl -s -X POST http://127.0.0.1:6952/search -H 'Content-Type: application/json' -d "{\\"query\\":\\"<symbol or concept>\\",\\"projectId\\":\\"${projectId}\\",\\"agentName\\":\\"$AGENT_NAME\\",\\"taskId\\":\\"$TASK_ID\\"}"`,
  ].join('\n');
}

function checksBlock(): string {
  const c = getConfig().checks || {};
  const cmds = [c.typecheck, c.build, c.test, c.lint].filter(Boolean) as string[];
  return cmds.length ? cmds.map(x => `  - ${x}`).join('\n') : '  - (no sanity checks configured)';
}

async function memoryBlock(task: Task): Promise<string> {
  const mem = getConfig().memory;
  if (!mem) return '';
  try { return await mem.primeFor(task); } catch { return ''; }
}

async function blastRadiusBlock(task: Task): Promise<string> {
  const ci = getConfig().codeIndex;
  if (!ci?.impact) return '(code index not attached — determine impact by reading the callers yourself)';
  try {
    const target = task.files?.[0] ? { file: task.files[0] } : { symbol: task.title };
    const r = await ci.impact(target);
    return [
      `callers: ${r.callers.join(', ') || 'none'}`,
      `dependents: ${r.dependents.join(', ') || 'none'}`,
      `tests: ${r.tests.join(', ') || 'none'}`,
      `risk: ${r.risk}`,
    ].join('\n');
  } catch { return '(impact analysis failed — read callers manually)'; }
}

/** The cached project brief (the "context brain"): one index-time LLM pass that every
 *  agent reads for free. Fetched from the db daemon (best-effort, short timeout) so a
 *  slow/absent brief never blocks a dispatch. */
async function projectBriefBlock(task: Task): Promise<string> {
  const projectId = (task as any).projectId || 'default';
  try {
    const PORT = process.env.DB_SERVER_PORT ?? '6952';
    const res = await fetch(`http://127.0.0.1:${PORT}/project-context?project=${encodeURIComponent(projectId)}`, { signal: AbortSignal.timeout(1500) });
    const d = await res.json() as { brief?: string | null };
    if (!d?.brief) return '';
    return [
      'PROJECT CONTEXT BRIEF — a cached orientation to this codebase (architecture, where things',
      'live, core modules). Use it to navigate FAST; it is background, not a substitute for reading',
      'the specific files your task touches:',
      '',
      d.brief.trim(),
    ].join('\n');
  } catch { return ''; }
}

async function docsBlock(task: Task): Promise<string> {
  const ds = getConfig().docStore;
  if (!ds || !task.docs?.length) return '';
  const lines: string[] = [];
  for (const k of task.docs) {
    try { lines.push('  - ' + await ds.describeForPrompt(k)); } catch { /* skip */ }
  }
  return lines.length ? 'ATTACHED DOCUMENTS (context for this task):\n' + lines.join('\n') : '';
}

/** Render an agent's template for a task. `merge` uses the architect's merge template. */
export async function renderPrompt(agent: AgentConfig, task: Task, stage: string): Promise<string> {
  const cfg = getConfig();
  const template =
    (stage === 'merge' && agent.mergePromptTemplate) ? agent.mergePromptTemplate
    : (stage === 'rescue' && agent.rescuePromptTemplate) ? agent.rescuePromptTemplate
    : agent.promptTemplate;

  const values: Record<string, string> = {
    taskId: task.id,
    title: task.title,
    description: task.description || '',
    scenarios: scenariosToGherkin(task.scenarios) || '(no scenarios — ask for clarification)',
    plan: task.summary || '(no plan recorded yet)',
    memory: await memoryBlock(task),
    blastRadius: await blastRadiusBlock(task),
    docs: await docsBlock(task),
    checks: checksBlock(),
    searchProtocol: searchProtocolFor((task as any).projectId || 'default'),
    qaUrl: cfg.qa?.testUrl || '(no QA_TEST_URL configured — verify via tests only)',
  };

  let out = template.replace(/\{\{(\w+)\}\}/g, (_, k) => (k in values ? values[k] : ''));

  if (task.reviewNote) {
    out = `REVIEWER FEEDBACK — address this first (a previous attempt was rejected):\n${task.reviewNote}\n\n` + out;
  }
  // Cached project brief — prepended below the rules so every role gets a fast orientation
  // to the codebase for free (generated once at index-build time, not per agent).
  const brief = await projectBriefBlock(task);
  if (brief) out = brief + '\n\n' + out;
  // Project rules (CLAUDE.md / AGENTS.md / functionality index …) — prepended so every role
  // gets them without editing templates; also pinned into the project context as a side effect.
  const rules = rulesBlock(task);
  if (rules) out = rules + '\n\n' + out;
  const preamble = cfg.methodology?.preambleFor(agent.role as AgentRole);
  if (preamble) out = preamble + '\n\n' + out;
  return out;
}
