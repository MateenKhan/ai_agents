import React from 'react';

/**
 * Landing-page content, as data.
 *
 * The original page repeated the same card markup 16 times by hand, so a change to the card
 * shape meant 16 edits and a diff nobody could read. Here the shape lives once in
 * FeaturesPage and the copy lives here — which is also what lets scripts/build-landing.tsx
 * prerender the exact same words into docs/index.html instead of a second copy drifting.
 *
 * Copy is TRUTHFUL by policy: every claim below maps to code that exists. "Shipping next"
 * is separated out precisely so the feature list can't quietly absorb it.
 */

// ── icons (inline; the page ships no icon font and no runtime dep) ───────────
const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

export const Icons = {
  gate: <svg width="22" height="22" viewBox="0 0 24 24" {...S}><circle cx="6" cy="6" r="2.5" /><circle cx="6" cy="18" r="2.5" /><circle cx="18" cy="15" r="2.5" /><path d="M6 8.5v7M8.4 6.6c3.4.2 7 1.4 7 5.8" /></svg>,
  rag: <svg width="22" height="22" viewBox="0 0 24 24" {...S}><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M9 9h6v6H9zM4 9H2M4 15H2M22 9h-2M22 15h-2M9 4V2M15 4V2M9 22v-2M15 22v-2" /></svg>,
  learn: <svg width="22" height="22" viewBox="0 0 24 24" {...S}><path d="M9 3a4 4 0 0 0-4 4v1a3 3 0 0 0 0 6v1a4 4 0 0 0 4 4M9 3a3 3 0 0 1 3 3v13a3 3 0 0 1-3 1M15 3a4 4 0 0 1 4 4v1a3 3 0 0 1 0 6v1a4 4 0 0 1-4 4M15 3a3 3 0 0 0-3 3" /></svg>,
  tree: <svg width="22" height="22" viewBox="0 0 24 24" {...S}><circle cx="6" cy="6" r="2.5" /><circle cx="18" cy="6" r="2.5" /><circle cx="12" cy="18" r="2.5" /><path d="M6 8.5V11a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8.5M12 13v2.5" /></svg>,
  board: <svg width="20" height="20" viewBox="0 0 24 24" {...S}><rect x="3" y="4" width="4" height="16" rx="1" /><rect x="10" y="4" width="4" height="11" rx="1" /><rect x="17" y="4" width="4" height="14" rx="1" /></svg>,
  pipeline: <svg width="20" height="20" viewBox="0 0 24 24" {...S}><path d="M4 6h4l2 3M4 6l-1 12h18L20 6h-4l-2 3H10" /><path d="M9 13h6" /></svg>,
  pulse: <svg width="20" height="20" viewBox="0 0 24 24" {...S}><path d="M3 12h4l2 5 4-12 2 7h6" /></svg>,
  chat: <svg width="20" height="20" viewBox="0 0 24 24" {...S}><path d="M4 5h16v11H9l-4 3v-3H4z" /><path d="M8 10h8M8 13h5" /></svg>,
  qa: <svg width="20" height="20" viewBox="0 0 24 24" {...S}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /><path d="M8 11h6M11 8v6" opacity=".5" /></svg>,
  blast: <svg width="20" height="20" viewBox="0 0 24 24" {...S}><circle cx="12" cy="12" r="2.5" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l2.5 2.5M16.5 16.5 19 19M19 5l-2.5 2.5M7.5 16.5 5 19" /></svg>,
  cluster: <svg width="20" height="20" viewBox="0 0 24 24" {...S}><rect x="2" y="3" width="8" height="7" rx="1.5" /><rect x="14" y="3" width="8" height="7" rx="1.5" /><rect x="8" y="14" width="8" height="7" rx="1.5" /><path d="M6 10v2h12v-2M12 12v2" /></svg>,
  db: <svg width="20" height="20" viewBox="0 0 24 24" {...S}><ellipse cx="12" cy="5" rx="7" ry="2.6" /><path d="M5 5v14c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6V5M5 12c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6" /></svg>,
  record: <svg width="20" height="20" viewBox="0 0 24 24" {...S}><rect x="2" y="6" width="13" height="12" rx="2" /><path d="m15 12 6-3.5v11L15 16" /><circle cx="7" cy="12" r="2" /></svg>,
  bell: <svg width="20" height="20" viewBox="0 0 24 24" {...S}><path d="M4 5h16v11H9l-4 3v-3H4z" /><path d="M8 10h8" /></svg>,
  generic: <svg width="20" height="20" viewBox="0 0 24 24" {...S}><path d="M12 3v4M12 17v4M3 12h4M17 12h4" /><circle cx="12" cy="12" r="3.2" /><path d="M6.2 6.2 9 9M15 15l2.8 2.8M17.8 6.2 15 9M9 15l-2.8 2.8" /></svg>,
  arrow: <svg className="arrow" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M5 12h14M13 6l6 6-6 6" /></svg>,
  star: <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l2.9 6.3 6.9.6-5.2 4.6 1.6 6.8L12 17.3 5.8 20.9l1.6-6.8L2.2 8.9l6.9-.6L12 2z" /></svg>,
  github: <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .5C5.7.5.5 5.7.5 12a11.5 11.5 0 0 0 7.9 10.9c.6.1.8-.2.8-.5v-2c-3.2.7-3.9-1.4-3.9-1.4-.5-1.3-1.3-1.7-1.3-1.7-1.1-.7 0-.7 0-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.6-.3-5.3-1.3-5.3-5.7 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17.3 4.9 18.3 5.2 18.3 5.2c.6 1.6.2 2.8.1 3.1.8.8 1.2 1.8 1.2 3.1 0 4.4-2.7 5.4-5.3 5.7.4.4.8 1.1.8 2.2v3.3c0 .3.2.6.8.5A11.5 11.5 0 0 0 23.5 12C23.5 5.7 18.3.5 12 .5Z" /></svg>,
  copy: <svg width="15" height="15" viewBox="0 0 24 24" {...S}><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>,
  check: <svg width="15" height="15" viewBox="0 0 24 24" {...S}><path d="M4 12.5 9 17.5 20 6.5" /></svg>,
};

export const REPO = 'https://github.com/MateenKhan/piranha';
export const INSTALL_CMD = 'ANTHROPIC_API_KEY=sk-... docker compose up';

export interface Card { icon: React.ReactNode; title: string; body: React.ReactNode; tag?: string; shot?: string }

export const LEAD: Card[] = [
  { icon: Icons.gate, title: 'Human-gated merge', body: <>QA passes, a <b>live preview</b> of the running app spins up, you approve. Agents never push — the orchestrator alone merges.</> },
  { icon: Icons.rag, title: 'Agents read less. Runs cost less.', body: <>On-device RAG — embeddings, retrieval, a shared context cache and a cached project brief — so agents fetch the exact code they need instead of burning tokens re-reading your repo. <b>No source ever uploaded.</b></> },
  { icon: Icons.learn, title: 'Agents that learn', body: <><b>The more they ship, the sharper they get.</b> Learnings + a pinned context cache feed the next task — the swarm stops repeating mistakes.</> },
  { icon: Icons.tree, title: 'Worktree isolation', body: <>A dedicated git worktree per agent, per task — zero collisions, clean diffs, safe parallelism.</> },
];

export const REST: Card[] = [
  { icon: Icons.board, title: 'Visual Kanban board', body: <>Watch agents work, live — every task a card moving lane to lane.</>, tag: 'screenshot', shot: 'docs/assets/board.png' },
  { icon: Icons.pipeline, title: 'Plan → Build → QA → Merge', body: <>A real dev team, automated — role-tiered models per stage (Opus plans, Sonnet builds).</> },
  { icon: Icons.pulse, title: 'Runs unattended', body: <>Survives API outages, stalls, and restarts — circuit breaker + watchdog. A stuck task gets auto re-planned, not dropped.</> },
  { icon: Icons.chat, title: 'Chat intake', body: <>Paste a message → get tasks. Decomposed into GIVEN / WHEN / THEN.</>, tag: 'screenshot', shot: 'docs/assets/context.png' },
  { icon: Icons.qa, title: 'Real-browser QA', body: <><b>A real browser, not just unit tests</b> — QA drives the running app, screenshots it, fails on any console/network error.</> },
  { icon: Icons.blast, title: 'Blast-radius planning', body: <>The architect maps callers, dependents &amp; covering tests before a line changes — edits stay scoped.</> },
  { icon: Icons.cluster, title: 'Scale across machines', body: <><b>Run the swarm on many boxes.</b> Atomic task claim, a DB merge-lock, worker heartbeats — and a dead machine’s tasks get reclaimed automatically.</> },
  { icon: Icons.db, title: 'SQLite or Postgres', body: <><b>One file, or one shared database.</b> Point the whole swarm at Postgres — tasks, logs and a pgvector code index. Connection string encrypted at rest.</> },
  { icon: Icons.record, title: 'Record the board', body: <><b>Capture the swarm working.</b> One click, browser-native screen capture, saved as a WebM — for demos, bug reports, or proving what happened.</> },
];

export const MICRO = [
  'Multi-project', 'Encrypted secrets (AES-256)', 'Per-project tokens & GitHub App',
  'Cost & model control', 'Project brief · context brain', 'One-command Docker',
];

export const USE_CASES = ['💻 Ship features', '💼 Land a job — tailor & apply', '🎨 Generate & post content', '🔍 Research & summarize', '⚙️ Data & ops chores'];

/**
 * The comparison table.
 *
 * Three rules, and the third is the one that makes the other two worth reading.
 *
 *  1. COMPARE IN-CATEGORY. Aider is a solo pair-programmer, not an autonomous swarm; beating
 *     it proves nothing and reads as a chosen soft target. Devin and Cursor's background
 *     agents are what a reader in 2026 is actually weighing this against.
 *
 *  2. SHOW THE LOSSES. The last two rows are ones Piranha loses outright — no hosted option,
 *     one model provider. Both are already admitted in README's "Limitations & future scope";
 *     omitting them here would not have hidden them, only made the nine wins above look
 *     unearned. A column of unbroken checkmarks is read as marketing before it is read at all.
 *
 *  3. DON'T ASSERT WHAT YOU HAVEN'T VERIFIED. `null` means "not a core focus, or we did not
 *     verify it" — never "they can't". Where a competitor does something adjacent, name the
 *     thing rather than award a checkmark. The footnote dates the claim and invites correction.
 */
export type Cell =
  | true          // ✓  ships today
  | false         // ✗  does not
  | 'planned'     // on our roadmap — only ever used in the Piranha column
  | null          // —  not a core focus, or unverified
  | string;       // named partial, e.g. "cloud VM"

export const COMPARE: { feature: string; piranha: Cell; devin: Cell; cursor: Cell; openhands: Cell }[] = [
  { feature: 'Visual Kanban board', piranha: true, devin: null, cursor: null, openhands: null },
  { feature: 'Per-agent worktree isolation', piranha: true, devin: 'cloud VM', cursor: 'cloud VM', openhands: 'container' },
  { feature: 'Structured acceptance criteria', piranha: true, devin: null, cursor: null, openhands: null },
  { feature: 'AI acceptance gate before you review', piranha: true, devin: null, cursor: null, openhands: null },
  { feature: 'Human-gated merge', piranha: true, devin: true, cursor: true, openhands: 'optional' },
  { feature: 'Local / private embeddings', piranha: true, devin: null, cursor: 'cloud index', openhands: 'partial' },
  { feature: 'Self-learning memory', piranha: true, devin: 'knowledge', cursor: 'rules', openhands: null },
  { feature: 'Runs unattended', piranha: true, devin: true, cursor: true, openhands: null },
  { feature: 'Scales across your own machines', piranha: true, devin: null, cursor: null, openhands: null },
  { feature: 'Self-hosted', piranha: true, devin: false, cursor: false, openhands: true },
  { feature: 'Free to run', piranha: true, devin: false, cursor: false, openhands: true },
  { feature: 'Open source (MIT)', piranha: true, devin: false, cursor: false, openhands: true },
  { feature: 'Cloud / hosted, zero setup', piranha: 'planned', devin: true, cursor: true, openhands: true },
  { feature: 'Any model provider', piranha: 'planned', devin: true, cursor: true, openhands: true },
];

export const COMPARE_NOTE = 'Compared July 2026 from public documentation. A blank means “not a core focus” or unverified — never “can’t”. Think a cell is wrong?';

export const STEPS = [
  { n: '01', title: 'Task', body: 'Type it, or paste a message and let intake split it into scenarios.' },
  { n: '02', title: 'Swarm', body: 'Agents fan out into isolated worktrees — plan, build, QA in parallel.' },
  { n: '03', title: 'Review', body: 'QA passes → the task parks in review. You preview the branch.' },
  { n: '04', title: 'Merge', body: 'You click approve. The orchestrator merges — the only thing that can.' },
];

export const NEXT: Card[] = [
  { icon: Icons.record, tag: 'planned', title: 'Per-agent replay', body: <>Recording is manual today. Next: each agent’s run captured automatically and attached to its task, so review means watching what happened.</> },
  { icon: Icons.bell, tag: 'planned', title: 'Phone notifications', body: <>Get pinged when a task lands in review — approve the merge from your pocket.</> },
  { icon: Icons.generic, tag: 'planned', title: 'Beyond code, natively', body: <>The engine is task-agnostic. Next: first-class non-coding workflows — job hunting, content + social posting, research pipelines.</> },
];

export const LANES = [
  { cls: 'plan', label: 'Plan', title: 'Add rate limiter', meta: 'architect · opus', prog: '100%' },
  { cls: 'build', label: 'Build', title: 'Fix auth redirect', meta: 'dev · sonnet', prog: '72%' },
  { cls: 'qa', label: 'QA', title: 'CSV export', meta: 'qa · browser check', prog: '88%' },
  { cls: 'review', label: 'Review', title: 'Dark mode toggle', meta: 'waiting for you', gate: true },
  { cls: 'merge', label: 'Merged', title: 'Search endpoint', meta: 'merged · done' },
] as const;
