// ─────────────────────────────────────────────────────────────────────────────
// <AgentTank> — the swarm, bound to the board.
//
// Collapses to zero height when nothing is running, so an idle board looks exactly
// as it did before. Space appears only when there's something to show — which is
// also more honest than a permanently empty aquarium.
//
// There is no server-side "which agents are running, and as what role" — /system-status
// returns counts only. So the roles are derived from the stage of each in-flight task,
// which is the same mapping the orchestrator uses to pick an agent.
// ─────────────────────────────────────────────────────────────────────────────

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Swarm, type AgentRole } from './Swarm';
import { TankStatusBar } from './TankStatusBar';
import type { Task } from '../../pages/tasks/types';

const TANK_H = 130;   // starting guess; the ResizeObserver takes over on mount
const MUTE_KEY = 'piranha.pauseMotion';

/** Live prefers-reduced-motion. The swarm's CSS already zeroes its keyframes under this
 *  media query (swarm.css); reading it here lets the pause state — and the toggle's label —
 *  agree with what the OS is already forcing, instead of claiming motion is on. */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  );
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return;
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}

/** stage → the role the orchestrator dispatches for it. Mirrors nextRoute() in
 *  agentic/engine/orchestrator.ts: plan/rescue/merge are the architect's. */
function roleFor(stage: string | null | undefined): AgentRole {
  switch (stage) {
    case 'build': return 'dev';
    case 'qa':    return 'qa';
    default:      return 'architect';   // plan · rescue · merge
  }
}


/** Idle water. One line at a time, changing slowly — a message that rotates every couple of
 *  seconds is a slot machine: you glance away, and what you saw is gone. Half of them name
 *  the action, because the `+` is on the board, not in here.
 *
 *  `hot` is the phrase that gets the accent. One coloured phrase per line, never two. */
const IDLE_LINES: { text: string; hot?: string }[] = [
  { text: 'Still water. Feed it a task.', hot: 'Feed it a task.' },
  { text: 'Nothing in the water.' },
  { text: 'The swarm sleeps. Drop a task in to wake it.', hot: 'Drop a task in' },
  { text: 'No blood yet.' },
  { text: 'The teeth are getting impatient.', hot: 'impatient' },
  { text: 'Throw something in and watch.', hot: 'Throw something in' },
  { text: 'Waiting for something to bite.', hot: 'bite' },
];

const TYPE_MS = 38;
const HOLD_MS = 9_000;

function IdleLine() {
  const [i, setI] = useState(() => Math.floor(Math.random() * IDLE_LINES.length));
  const reduced = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const full = IDLE_LINES[i].text;
  const [shown, setShown] = useState(reduced ? full : '');

  // type it out, hold, then move on. Typing in JS means the text is real text: it wraps,
  // and no width has to be guessed from a character count.
  useEffect(() => {
    if (reduced) { setShown(full); return; }
    setShown('');
    let n = 0;
    const type = setInterval(() => {
      n += 1;
      setShown(full.slice(0, n));
      if (n >= full.length) clearInterval(type);
    }, TYPE_MS);

    const next = setTimeout(() => {
      setI(prev => {
        let k = Math.floor(Math.random() * IDLE_LINES.length);
        if (k === prev) k = (k + 1) % IDLE_LINES.length;   // never repeat back-to-back
        return k;
      });
    }, full.length * TYPE_MS + HOLD_MS);

    return () => { clearInterval(type); clearTimeout(next); };
  }, [i, full, reduced]);

  // colour the hot phrase, but only once it has actually been typed
  const hot = IDLE_LINES[i].hot;
  const at = hot ? full.indexOf(hot) : -1;
  let body: React.ReactNode = shown;
  if (at >= 0 && hot) {
    const head = shown.slice(0, at);
    const mid = shown.slice(at, at + hot.length);
    const tail = shown.slice(at + hot.length);
    body = (<>{head}<span className="text-accent-600">{mid}</span>{tail}</>);
  }

  return (
    // Decorative idle voice — flavour copy that rotates every few seconds and is retyped
    // character by character. To a screen reader that's a stream of half-words; the real
    // idle state lives in the status bar's line + counts. Hide the whole line from AT.
    <div aria-hidden className="absolute inset-x-0 top-1/2 -translate-y-1/2 px-6 flex justify-center pointer-events-none select-none">
      <p className="max-w-[26ch] text-center text-[13px] font-semibold leading-snug tracking-tight text-slate-700">
        {body}
        <span className="pz-caret" aria-hidden />
      </p>
    </div>
  );
}

function AgentTankImpl({ tasks }: { tasks: Task[] }) {
  // a task is being worked when the orchestrator has claimed it and an agent is live
  const counts = useMemo(() => {
    const c: Partial<Record<AgentRole, number>> = {};
    for (const t of tasks) {
      if (t.status !== 'WORKING' || !t.started) continue;
      const r = roleFor(t.stage);
      c[r] = (c[r] ?? 0) + 1;
    }
    return c;
  }, [tasks]);

  const working = Object.values(counts).reduce((a, b) => a + (b ?? 0), 0);

  // Ambient motion is mutable; the numbers on the status bar are not. The switch is also ON
  // whenever the OS asks for reduced motion — one honest state, not two competing ones.
  const reduced = usePrefersReducedMotion();
  const [muted, setMuted] = useState(() => localStorage.getItem(MUTE_KEY) === '1');
  const toggleMuted = () => setMuted(m => {
    const next = !m;
    localStorage.setItem(MUTE_KEY, next ? '1' : '0');
    return next;
  });

  // one bite per merge. Watch the merged count climb; don't bite on first render.
  const merged = useMemo(() => tasks.filter(t => t.stage === 'merged').length, [tasks]);
  const [mergeSeq, setMergeSeq] = useState(0);
  const lastMerged = useRef<number | null>(null);
  useEffect(() => {
    if (lastMerged.current === null) { lastMerged.current = merged; return; }
    if (merged > lastMerged.current) setMergeSeq(s => s + 1);
    lastMerged.current = merged;
  }, [merged]);

  // The tank fills whatever height the left column (brand row + tabs) settles at, rather
  // than imposing one — a fixed height here is what left that empty slab beside the brand.
  const boxRef = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(TANK_H);
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const ro = new ResizeObserver(([e]) => setH(Math.round(e.contentRect.height)));
    ro.observe(box);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={boxRef}
      className="absolute inset-0 overflow-hidden bg-gradient-to-b from-accent-50/50 to-transparent"
    >
      <Swarm counts={counts} height={h} barHeight={30} mergeSeq={mergeSeq} paused={muted || reduced} />
      {working === 0 && <IdleLine />}
      <TankStatusBar working={working} muted={muted} reduced={reduced} onToggleMuted={toggleMuted} />
    </div>
  );
}

/** The tank reads three things off a task: is it working, has it started, what stage.
 *  TasksPage polls, so `tasks` is a new array every few seconds. Re-rendering on that
 *  identity change would re-render ProjectBar — which now owns the tab strip, whose
 *  framer-motion `layoutId` underline replays its transition every time. That is the
 *  flash. Compare what we actually use, and nothing else. */
const sig = (ts: Task[]) =>
  ts.map(t => `${t.status}:${t.stage ?? ''}:${t.started ? 1 : 0}`).join('|');

export const AgentTank = memo(AgentTankImpl, (a, b) => sig(a.tasks) === sig(b.tasks));
