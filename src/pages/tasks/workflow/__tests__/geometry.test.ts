import { describe, expect, it } from 'vitest';
import {
  NODE_W, autoLayout, autoSides, backOff, bezier, cornerAnchor,
  midpoint, nearestCorner, nearestSide, portOffset, sideAnchor, clamp, type Box,
} from '../geometry';

const box = (x: number, y: number, h = 92): Box => ({ x, y, h });

describe('port offsets', () => {
  it('accept sits before centre, reject after — so the two never overlap', () => {
    expect(portOffset('acc')).toBeLessThan(0);
    expect(portOffset('rej')).toBeGreaterThan(0);
    expect(portOffset('ask')).toBe(0);
  });
});

describe('sideAnchor', () => {
  it('leaves each side along its outward normal', () => {
    const b = box(100, 100);
    expect(sideAnchor(b, 'top', 'acc')).toMatchObject({ nx: 0, ny: -1 });
    expect(sideAnchor(b, 'bottom', 'acc')).toMatchObject({ nx: 0, ny: 1 });
    expect(sideAnchor(b, 'left', 'acc')).toMatchObject({ nx: -1, ny: 0 });
    expect(sideAnchor(b, 'right', 'acc')).toMatchObject({ nx: 1, ny: 0 });
  });

  it('places the right anchor on the right border', () => {
    expect(sideAnchor(box(100, 100), 'right', 'acc').x).toBe(100 + NODE_W);
  });

  it('separates the accept and reject anchors on the same side', () => {
    const a = sideAnchor(box(0, 0), 'top', 'acc');
    const r = sideAnchor(box(0, 0), 'top', 'rej');
    expect(r.x - a.x).toBe(24);
  });
});

describe('autoSides', () => {
  it('faces the boxes across whichever axis separates them most', () => {
    expect(autoSides(box(0, 0), box(400, 10))).toEqual(['right', 'left']);
    expect(autoSides(box(400, 0), box(0, 10))).toEqual(['left', 'right']);
    expect(autoSides(box(0, 0), box(10, 400))).toEqual(['bottom', 'top']);
    expect(autoSides(box(0, 400), box(10, 0))).toEqual(['top', 'bottom']);
  });
});

describe('nearest port snapping', () => {
  it('snaps to the side the pointer is nearest', () => {
    const b = box(0, 0, 100);      // centre (100, 50)
    expect(nearestSide(b, 500, 50)).toBe('right');
    expect(nearestSide(b, -500, 50)).toBe('left');
    expect(nearestSide(b, 100, 500)).toBe('bottom');
    expect(nearestSide(b, 100, -500)).toBe('top');
  });

  it('snaps to the corner the pointer is nearest', () => {
    const b = box(0, 0, 100);
    expect(nearestCorner(b, 0, 0)).toBe('tl');
    expect(nearestCorner(b, 300, 0)).toBe('tr');
    expect(nearestCorner(b, 0, 300)).toBe('bl');
    expect(nearestCorner(b, 300, 300)).toBe('br');
  });
});

describe('bezier', () => {
  it('starts and ends exactly on its anchors', () => {
    const d = bezier({ x: 10, y: 20, nx: 1, ny: 0 }, { x: 300, y: 200, nx: -1, ny: 0 });
    expect(d.startsWith('M 10 20 ')).toBe(true);
    expect(d.endsWith(' 300 200')).toBe(true);
  });

  it('bows out along the normals rather than cutting straight through', () => {
    const d = bezier({ x: 0, y: 0, nx: 1, ny: 0 }, { x: 100, y: 0, nx: -1, ny: 0 });
    const [c1x] = d.split('C ')[1].split(',')[0].trim().split(' ').map(Number);
    expect(c1x).toBeGreaterThan(0);   // first control point pushed right, out of the port
  });

  it('keeps a minimum bow even for coincident anchors', () => {
    const d = bezier({ x: 0, y: 0, nx: 1, ny: 0 }, { x: 0, y: 0, nx: -1, ny: 0 });
    expect(d).toContain('C 46 0');    // the 46px floor, not a degenerate zero-length curve
  });
});

describe('backOff', () => {
  it('pulls the endpoint out along its normal so the arrowhead clears the border', () => {
    expect(backOff({ x: 100, y: 0, nx: -1, ny: 0 }, 12)).toMatchObject({ x: 88, y: 0 });
    expect(backOff({ x: 0, y: 100, nx: 0, ny: 1 }, 10)).toMatchObject({ x: 0, y: 110 });
  });
});

describe('midpoint and clamp', () => {
  it('midpoint is the average', () => {
    expect(midpoint({ x: 0, y: 0, nx: 0, ny: 0 }, { x: 10, y: 20, nx: 0, ny: 0 })).toEqual({ x: 5, y: 10 });
  });
  it('clamp bounds both ends', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(0.5, 0, 1)).toBe(0.5);
  });
});

describe('cornerAnchor', () => {
  it('points diagonally out of each corner', () => {
    const b = box(0, 0, 100);
    expect(cornerAnchor(b, 'tl').nx).toBeLessThan(0);
    expect(cornerAnchor(b, 'tl').ny).toBeLessThan(0);
    expect(cornerAnchor(b, 'br')).toMatchObject({ x: NODE_W, y: 100 });
  });
});

describe('autoLayout', () => {
  it('ranks a linear pipeline left to right', () => {
    const pos = autoLayout(['a', 'b', 'c'], [['a', 'b'], ['b', 'c']]);
    expect(pos.a.x).toBeLessThan(pos.b.x);
    expect(pos.b.x).toBeLessThan(pos.c.x);
    expect(pos.a.y).toBe(pos.b.y);   // one per rank, so all on the same row
  });

  it('stacks siblings within a rank', () => {
    const pos = autoLayout(['a', 'b', 'c'], [['a', 'b'], ['a', 'c']]);
    expect(pos.b.x).toBe(pos.c.x);
    expect(pos.b.y).not.toBe(pos.c.y);
  });

  it('parks a stage the entry cannot reach in its own column past the end', () => {
    // Without an explicit entry, "root" means "no incoming edge" — and a disconnected orphan
    // has none, so it would be filed beside the real entry, the one place it must not appear.
    const pos = autoLayout(['a', 'b', 'orphan'], [['a', 'b']], 'a');
    expect(pos.orphan.x).toBeGreaterThan(pos.b.x);
  });

  it('without an entry, falls back to ranking from the stages that have no incoming edge', () => {
    const pos = autoLayout(['a', 'b'], [['a', 'b']]);
    expect(pos.a.x).toBeLessThan(pos.b.x);
  });

  it('ignores an entry that is not a stage', () => {
    const pos = autoLayout(['a', 'b'], [['a', 'b']], 'ghost');
    expect(pos.a.x).toBeLessThan(pos.b.x);
  });

  it('terminates on a cycle instead of spinning', () => {
    const pos = autoLayout(['a', 'b'], [['a', 'b'], ['b', 'a']]);
    expect(Number.isFinite(pos.a.x)).toBe(true);
    expect(Number.isFinite(pos.b.x)).toBe(true);
  });
});
