// ─────────────────────────────────────────────────────────────────────────────
// The one place a semantic search happens.
//
// Before this, `/search` ran the embedding query and returned. It never touched the shared
// context, so a file an agent searched for was never remembered, and `touchContext` — the
// function that bumps `useCount` and `lastUsedAt` — was called by nothing but its own tests.
// The `useCount` column existed and only ever incremented when a file was re-added.
//
// Everything now goes through `searchWithContext`, so the bookkeeping cannot be skipped:
//
//   run the embedding query
//   record who searched for what          (the audit that answers "do agents use the index?")
//   remember the files that actually matched, in the project's shared context
//   bump their use counts
//   evict, by LEAST-FREQUENTLY-USED
//
// The CLI (`pnpm run db:search`) calls the HTTP daemon first, so it inherits all of this. Its
// offline fallback cannot record anything — there is no db-server to record into — and that is
// honest rather than silent: without the daemon there is no shared context to speak of.
// ─────────────────────────────────────────────────────────────────────────────

import { statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { semanticSearch } from './query.js';

export interface SearchHit {
  score: number;
  name?: string;
  type?: string;
  path: string;
  line?: number;
  signature?: string | null;
}

export interface SelectOptions {
  /** At most this many distinct files enter the context from one search. */
  maxFiles?: number;
  /**
   * Keep a hit only if its score is at least this fraction of the best hit's score.
   *
   * RELATIVE, not absolute, because the two search paths use different scales: the embedding
   * path scores cosine similarity in [0,1], and the keyword fallback scores "how many of your
   * words appear", which is an unbounded integer. One fixed threshold cannot serve both.
   */
  minRelativeScore?: number;
}

export const DEFAULT_SELECT: Required<SelectOptions> = { maxFiles: 5, minRelativeScore: 0.6 };

/**
 * Which of a search's hits are worth remembering. Pure.
 *
 * Deduplicated by file: a query matching six symbols in one file is one file, not six. Ordered
 * by the best score seen for that file, so the ranking survives the dedupe.
 */
export function selectForContext(hits: readonly SearchHit[], opts: SelectOptions = {}): string[] {
  const { maxFiles, minRelativeScore } = { ...DEFAULT_SELECT, ...opts };
  const usable = hits.filter(h => h && typeof h.path === 'string' && h.path && Number.isFinite(h.score) && h.score > 0);
  if (!usable.length) return [];

  const best = Math.max(...usable.map(h => h.score));
  if (best <= 0) return [];
  const floor = best * minRelativeScore;

  const bestByPath = new Map<string, number>();
  for (const h of usable) {
    if (h.score < floor) continue;
    const prev = bestByPath.get(h.path);
    if (prev === undefined || h.score > prev) bestByPath.set(h.path, h.score);
  }

  return [...bestByPath.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, Math.max(0, maxFiles))
    .map(([path]) => path);
}

/** Token estimate for a repo-relative path, or null when the file is gone. */
async function tokensFor(root: string, path: string): Promise<number | null> {
  try {
    const { estimateTokens } = await import('../agentic/db/context.js');
    const abs = isAbsolute(path) ? path : join(root, path);
    return estimateTokens(statSync(abs).size);
  } catch {
    return null;   // deleted, or outside the repo — do not put it in the context
  }
}

export interface SearchWithContextArgs {
  query: string;
  projectId: string;
  topK?: number;
  agentName?: string | null;
  taskId?: string | null;
  select?: SelectOptions;
}

export interface SearchWithContextResult {
  results: SearchHit[];
  /** Files this search added to (or refreshed in) the shared context. */
  remembered: string[];
  /** Files evicted to stay under the token cap. */
  evicted: string[];
}

/**
 * Search the code index and remember what was found.
 *
 * Bookkeeping is best-effort in the strict sense: an audit or context failure must never break
 * a search, because an agent that cannot search cannot work. But it is never skipped, because
 * there is only one door.
 */
export async function searchWithContext(args: SearchWithContextArgs): Promise<SearchWithContextResult> {
  const { query, projectId, topK = 10, agentName = null, taskId = null } = args;

  const results = (await semanticSearch(query, topK, projectId)) as SearchHit[];

  // Who searched for what. Answers "are the agents using the index, or grepping?"
  if (agentName) {
    try {
      const { recordDbUsage } = await import('./tasks.js');
      await recordDbUsage(agentName, taskId, query ?? '');
    } catch { /* the audit must never break a search */ }
  }

  const remembered: string[] = [];
  const evicted: string[] = [];

  try {
    const ctx = await import('../agentic/db/context.js');
    const { getProject } = await import('./tasks.js');
    const root = (await getProject(projectId).catch(() => null))?.repoPath || process.cwd();

    for (const path of selectForContext(results, args.select)) {
      const tokens = await tokensFor(root, path);
      if (tokens == null) continue;

      // `addedBy: 'search'` marks these as the engine's own, not the user's pins. enforceCap
      // evicts them freely; it will never evict a file a person pinned.
      const kept = await ctx.keepInContext({
        projectId, path, tokens, addedBy: 'search', pinned: false, taskId,
      });
      if (kept.file) remembered.push(path);
      for (const e of kept.evicted) evicted.push(e.path);

      // The counter this whole change exists for. A file searched for repeatedly survives
      // eviction; one fetched once and never used again is the first to go.
      await ctx.touchContext(projectId, path, agentName ?? 'search', taskId);
    }

    for (const e of await ctx.enforceCap(projectId)) evicted.push(e.path);
  } catch { /* the context is an optimisation; a search must still return its results */ }

  return { results, remembered, evicted };
}
