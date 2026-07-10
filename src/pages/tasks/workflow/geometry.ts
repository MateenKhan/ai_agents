// ─────────────────────────────────────────────────────────────────────────────
// Edge geometry — pure. Anchors, bezier control points, nearest-port snapping.
// Extracted from the design mock so it can be tested without a DOM: the mock computed all
// of this inline against live element sizes, which made every path bug reproducible only by
// eye.
// ─────────────────────────────────────────────────────────────────────────────

import type { Side, Corner } from './types';

export const NODE_W = 200;

export interface Anchor {
  x: number;
  y: number;
  /** Outward normal — the bezier leaves along it, so wires exit ports perpendicular. */
  nx: number;
  ny: number;
}

export interface Box { x: number; y: number; h: number }

/** Ports are paired on each side: accept sits 12px before centre, reject 12px after. */
export function portOffset(type: 'acc' | 'rej' | 'ask'): number {
  if (type === 'acc') return -12;
  if (type === 'rej') return 12;
  return 0;
}

export function sideAnchor(box: Box, side: Side, type: 'acc' | 'rej'): Anchor {
  const off = portOffset(type);
  switch (side) {
    case 'top': return { x: box.x + NODE_W / 2 + off, y: box.y, nx: 0, ny: -1 };
    case 'bottom': return { x: box.x + NODE_W / 2 + off, y: box.y + box.h, nx: 0, ny: 1 };
    case 'left': return { x: box.x, y: box.y + box.h / 2 + off, nx: -1, ny: 0 };
    default: return { x: box.x + NODE_W, y: box.y + box.h / 2 + off, nx: 1, ny: 0 };
  }
}

const DIAG = 0.7071;

export function cornerAnchor(box: Box, corner: Corner): Anchor {
  switch (corner) {
    case 'tl': return { x: box.x, y: box.y, nx: -DIAG, ny: -DIAG };
    case 'tr': return { x: box.x + NODE_W, y: box.y, nx: DIAG, ny: -DIAG };
    case 'bl': return { x: box.x, y: box.y + box.h, nx: -DIAG, ny: DIAG };
    default: return { x: box.x + NODE_W, y: box.y + box.h, nx: DIAG, ny: DIAG };
  }
}

export function centerOf(box: Box): { x: number; y: number } {
  return { x: box.x + NODE_W / 2, y: box.y + box.h / 2 };
}

/** Pick the facing sides for a pair of boxes: whichever axis separates them most. */
export function autoSides(a: Box, b: Box): [Side, Side] {
  const ca = centerOf(a);
  const cb = centerOf(b);
  const dx = cb.x - ca.x;
  const dy = cb.y - ca.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? ['right', 'left'] : ['left', 'right'];
  return dy >= 0 ? ['bottom', 'top'] : ['top', 'bottom'];
}

export function nearestSide(box: Box, px: number, py: number): Side {
  const c = centerOf(box);
  const dx = px - c.x;
  const dy = py - c.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'bottom' : 'top';
}

export function nearestCorner(box: Box, px: number, py: number): Corner {
  const c = centerOf(box);
  return `${py >= c.y ? 'b' : 't'}${px >= c.x ? 'r' : 'l'}` as Corner;
}

/** Cubic bezier between two anchors, bowing out along each anchor's normal. */
export function bezier(p1: Anchor, p2: Anchor): string {
  const k = Math.max(46, Math.hypot(p2.x - p1.x, p2.y - p1.y) / 2.2);
  const c1x = p1.x + p1.nx * k;
  const c1y = p1.y + p1.ny * k;
  const c2x = p2.x + p2.nx * k;
  const c2y = p2.y + p2.ny * k;
  return `M ${p1.x} ${p1.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
}

/** Back the endpoint off along its normal so the arrowhead stops short of the node border. */
export function backOff(a: Anchor, gap = 12): Anchor {
  return { ...a, x: a.x + a.nx * gap, y: a.y + a.ny * gap };
}

export function midpoint(a: Anchor, b: Anchor): { x: number; y: number } {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Rank stages by longest path from the entry, stacking within a rank. Stages the entry cannot
 * reach get their own column past the end, so the validator's complaint is visible in the
 * layout too.
 *
 * `entry` matters: ranking from "every stage with no incoming edge" would treat a disconnected
 * orphan as a root and file it beside the real entry — the one place it must not appear.
 */
export function autoLayout(
  stageIds: string[],
  edges: Array<[string, string, ...unknown[]]>,
  entry?: string,
): Record<string, { x: number; y: number }> {
  const hasIncoming = new Set(edges.map(([, to]) => to));
  const roots = entry && stageIds.includes(entry)
    ? [entry]
    : stageIds.filter(id => !hasIncoming.has(id));
  const starts = roots.length ? roots : stageIds.slice(0, 1);

  const rank: Record<string, number | undefined> = {};
  for (const r of starts) rank[r] = 0;
  // Relax longest paths. Iteration cap keeps a cyclic graph from spinning.
  for (let pass = 0; pass < stageIds.length + 2; pass++) {
    for (const [a, b] of edges) {
      if (rank[a] != null) rank[b] = Math.max(rank[b] ?? 0, (rank[a] as number) + 1);
    }
  }

  let maxRank = 0;
  for (const id of stageIds) if (rank[id] != null) maxRank = Math.max(maxRank, rank[id] as number);

  const perRank: Record<number, number> = {};
  const out: Record<string, { x: number; y: number }> = {};
  for (const id of stageIds) {
    const r = rank[id] ?? maxRank + 1;
    perRank[r] = perRank[r] ?? 0;
    out[id] = { x: 40 + r * 320, y: 40 + perRank[r] * 200 };
    perRank[r]++;
  }
  return out;
}
