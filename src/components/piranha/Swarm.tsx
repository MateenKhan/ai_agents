// ─────────────────────────────────────────────────────────────────────────────
// <Swarm> — the tank. One piranha per working agent.
//
// This is a gauge, not decoration: the fish count IS the WORKING count, rendered a
// second time for the eye instead of the reading brain. Fish are sized by role, so
// an architect reads as senior before you've read its label.
//
// The bite fires only when a task merges (bump `mergeSeq`). Never on a loop.
// ─────────────────────────────────────────────────────────────────────────────

import { memo, useEffect, useRef, useState } from 'react';
import { PiranhaSprite } from './PiranhaSprite';
import './swarm.css';

export type AgentRole = 'architect' | 'bo' | 'dev' | 'qa';

/** Size carries seniority. Deliberately NOT four colours — red is the only accent in
 *  this brand and cyan only ever means "alive"; a second hue channel would be
 *  redundant and would make the palette argue with itself. */
const ROLE: Record<AgentRole, { label: string; fill: [number, number]; dur: [number, number] }> = {
  architect: { label: 'ARCH', fill: [0.80, 0.90], dur: [13, 18] },
  bo:        { label: 'BO',   fill: [0.70, 0.80], dur: [13, 18] },
  dev:       { label: 'DEV',  fill: [0.48, 0.56], dur: [8, 13] },
  qa:        { label: 'QA',   fill: [0.40, 0.48], dur: [8, 13] },
};

const SHARDS = [0, 45, 90, 135, 180, 225, 270, 315];
const FISH_H = 155;            // sprite height in view-box units

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

interface Fish {
  id: string;
  role: AgentRole;
  sc: number; dur: number; delay: number; lane: number; tail: number;
  streaks: { x1: number; x2: number; y: number; w: number; o: number; sdur: number; sd: number }[];
}

function makeFish(role: AgentRole, tankH: number, barH: number): Fish {
  const R = ROLE[role];
  // sizes are a fraction of the water, not absolute — the header height is not ours to pick
  const usable = Math.max(40, tankH - barH - 10);
  const sc = (rnd(R.fill[0], R.fill[1]) * usable) / FISH_H;
  // seed the lane below the status bar, so nothing ever swims through the type
  const top = barH + 6;
  const bottom = tankH - FISH_H * sc - 4;
  const lane = bottom > top ? rnd(top, bottom) : top;

  const streaks = Array.from({ length: 12 }, () => {
    const gap = rnd(2, 20), len = rnd(8, 34), sdur = rnd(0.34, 0.78);
    return { x1: -gap - len, x2: -gap, y: rnd(16, 144), w: rnd(0.6, 1.6), o: rnd(0.2, 0.6), sdur, sd: rnd(0, sdur) };
  });

  return {
    id: `${role}-${Math.random().toString(36).slice(2, 9)}`,
    role, sc, lane,
    dur: rnd(R.dur[0], R.dur[1]),
    delay: rnd(0, 14),
    tail: rnd(0.7, 1.2),
    streaks,
  };
}

export interface SwarmProps {
  /** how many agents of each role are working right now */
  counts: Partial<Record<AgentRole, number>>;
  /** tank height in px. Must be tall — the fish are the point. */
  height?: number;
  /** height of the status bar overlaying the top, so fish stay clear of the type */
  barHeight?: number;
  /** bump this number to make one fish bite. Every merge, exactly once. */
  mergeSeq?: number;
  /** freeze the swim when the user (or their OS) has asked for stillness. */
  paused?: boolean;
  className?: string;
}

export const Swarm = memo(function Swarm({ counts, height = 260, barHeight = 38, mergeSeq = 0, paused = false, className = '' }: SwarmProps) {
  const [fish, setFish] = useState<Fish[]>([]);
  const [biting, setBiting] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  const [width, setWidth] = useState(900);
  const boxRef = useRef<HTMLDivElement>(null);
  const seenMerge = useRef(mergeSeq);

  // one viewBox unit = one CSS pixel, whatever the header is doing
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(box);
    return () => ro.disconnect();
  }, []);

  // add/remove fish to match the live agent counts, keeping the ones already swimming
  useEffect(() => {
    setFish(prev => {
      const next: Fish[] = [];
      (Object.keys(ROLE) as AgentRole[]).forEach(role => {
        const want = counts[role] ?? 0;
        const have = prev.filter(f => f.role === role);
        next.push(...have.slice(0, want));
        for (let i = have.length; i < want; i++) next.push(makeFish(role, height, barHeight));
      });
      return next;
    });
  }, [counts.architect, counts.bo, counts.dev, counts.qa, height, barHeight]);

  // a merge landed — one fish eats
  useEffect(() => {
    if (mergeSeq === seenMerge.current || fish.length === 0) { seenMerge.current = mergeSeq; return; }
    seenMerge.current = mergeSeq;
    const victim = fish[Math.floor(Math.random() * fish.length)];
    setBiting(victim.id);
    const t = setTimeout(() => setBiting(null), 1200);
    return () => clearTimeout(t);
  }, [mergeSeq, fish]);

  // don't animate an aquarium nobody is watching
  useEffect(() => {
    const onVis = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  const exit = `${width + 110}px`;

  return (
    <div ref={boxRef} className={`pz-tank ${hidden || paused ? 'pz-paused' : ''} ${className}`} style={{ height }}>
      <PiranhaSprite />
      {/* The viewBox tracks the container's real pixel size, so one user unit is one CSS
          pixel. A fixed viewBox stretched to fill a wide header multiplies every fish by
          the slice factor — at 1990px wide that was a 4.2x blow-up. */}
      <svg viewBox={`0 0 ${Math.max(1, width)} ${height}`} preserveAspectRatio="none" aria-hidden="true">
        {fish.map(f => (
          <g
            key={f.id}
            className={`pz-fish ${biting === f.id ? 'pz-bite' : ''}`}
            style={{
              '--dur': f.dur.toFixed(2),
              '--delay': f.delay.toFixed(2),
              '--lane': `${f.lane.toFixed(1)}px`,
              '--sc': f.sc.toFixed(3),
              '--tail': f.tail.toFixed(2),
              '--exit': exit,
            } as React.CSSProperties}
          >
            <text className="pz-role" x={(110 * f.sc).toFixed(1)} y={-3}>{ROLE[f.role].label}</text>

            <g className="pz-scaled">
              <g className="pz-lunge">
                <g>
                  {f.streaks.map((s, i) => (
                    <line
                      key={i} className="pz-streak"
                      x1={s.x1.toFixed(1)} x2={s.x2.toFixed(1)} y1={s.y.toFixed(1)} y2={s.y.toFixed(1)}
                      strokeWidth={s.w.toFixed(2)}
                      style={{ '--o': s.o.toFixed(2), '--sdur': s.sdur.toFixed(2), '--sd': s.sd.toFixed(2) } as React.CSSProperties}
                    />
                  ))}
                </g>

                <g className="pz-tail"><use href="#pzTail" /></g>
                <use href="#pzBodyG" />
                <g className="pz-jaw"><use href="#pzJawG" /></g>
                {/* fangs last: they hang over the jaw, they never disappear behind it */}
                <use href="#pzFangs" />

                <g strokeWidth={2}>
                  {SHARDS.map((deg, i) => (
                    <line
                      key={deg} className={`pz-shard ${i % 2 === 0 ? 'pz-hot' : ''}`}
                      x1={213} y1={84} x2={224 + (i % 3) * 3} y2={84}
                      style={{ '--r': `${deg}deg` } as React.CSSProperties}
                    />
                  ))}
                </g>
                <circle className="pz-wave" cx={206} cy={84} r={14} />
              </g>
            </g>
          </g>
        ))}
      </svg>

      {/* the idle line lives in TankStatusBar now — one voice, not two */}
    </div>
  );
});
