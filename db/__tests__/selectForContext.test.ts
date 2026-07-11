// selectForContext is a PURE function over a hit array, so it is tested directly with
// no store. The sibling searchContext.test.ts already covers the headline behaviours
// (relative floor, keyword-scale scores, single-hit keep, basic dedup, junk); this file
// pins down the exact BOUNDARIES the task calls out — the 0.6 floor's inclusivity, the
// cap of 5 as an identity (which files survive), and dedup interacting with both.

import { describe, expect, it } from 'vitest';
import { selectForContext, DEFAULT_SELECT, type SearchHit } from '../searchContext';

const hit = (path: string, score: number, name = 'sym'): SearchHit => ({ path, score, name });

describe('selectForContext — relative-score floor (0.6 of best)', () => {
  it('defaults to 0.6', () => {
    expect(DEFAULT_SELECT.minRelativeScore).toBe(0.6);
  });

  it('keeps a hit exactly AT the floor and drops one just below it', () => {
    // best = 1.0 → floor = 0.6. The keep test is `score < floor`, so 0.6 is inclusive.
    const picked = selectForContext([
      hit('best.ts', 1.0),
      hit('at-floor.ts', 0.6),      // exactly the floor → kept
      hit('below.ts', 0.5999),      // a hair under → dropped
    ]);
    expect(picked).toEqual(['best.ts', 'at-floor.ts']);
  });

  it('the floor tracks the BEST hit, so raising the top score can evict a mid hit', () => {
    // With best 0.8, floor 0.48 keeps 0.5. Introduce a 1.0 hit → floor 0.6 drops the 0.5.
    expect(selectForContext([hit('a.ts', 0.8), hit('b.ts', 0.5)])).toEqual(['a.ts', 'b.ts']);
    expect(selectForContext([hit('a.ts', 1.0), hit('b.ts', 0.5)])).toEqual(['a.ts']);
  });
});

describe('selectForContext — cap of 5', () => {
  it('defaults to 5', () => {
    expect(DEFAULT_SELECT.maxFiles).toBe(5);
  });

  it('returns exactly the top 5 distinct files by score when more qualify', () => {
    // Eight distinct files all above the floor; only the five highest-scoring survive,
    // in descending-score order.
    const picked = selectForContext([
      hit('f1.ts', 0.99), hit('f2.ts', 0.98), hit('f3.ts', 0.97), hit('f4.ts', 0.96),
      hit('f5.ts', 0.95), hit('f6.ts', 0.94), hit('f7.ts', 0.93), hit('f8.ts', 0.92),
    ]);
    expect(picked).toEqual(['f1.ts', 'f2.ts', 'f3.ts', 'f4.ts', 'f5.ts']);
  });

  it('the cap counts DISTINCT files, not raw hits: 12 symbols across 3 files → 3 kept', () => {
    const hits: SearchHit[] = [];
    for (const p of ['a.ts', 'b.ts', 'c.ts']) {
      for (let i = 0; i < 4; i++) hits.push(hit(p, 0.9, `sym${i}`));
    }
    expect(selectForContext(hits)).toEqual(['a.ts', 'b.ts', 'c.ts']); // well under the cap of 5
  });
});

describe('selectForContext — dedup by path', () => {
  it('collapses repeated paths and keeps each file at its BEST score for ranking', () => {
    // a.ts appears three times; its best (0.99) must place it above b.ts (0.95).
    const picked = selectForContext([
      hit('a.ts', 0.70), hit('b.ts', 0.95), hit('a.ts', 0.99), hit('a.ts', 0.80),
    ]);
    expect(picked).toEqual(['a.ts', 'b.ts']);
  });

  it('a path whose BEST occurrence is below the floor stays out, however often it repeats', () => {
    // best overall 1.0 → floor 0.6. weak.ts tops out at 0.4 across all its copies.
    const picked = selectForContext([
      hit('strong.ts', 1.0),
      hit('weak.ts', 0.4), hit('weak.ts', 0.3), hit('weak.ts', 0.35),
    ]);
    expect(picked).toEqual(['strong.ts']);
  });

  it('dedup then cap: 7 distinct qualifying files reduce past dedup, then cap to 5', () => {
    const hits: SearchHit[] = [];
    for (let i = 0; i < 7; i++) {
      hits.push(hit(`d${i}.ts`, 1 - i * 0.01));
      hits.push(hit(`d${i}.ts`, 0.5 - i * 0.01, 'dup')); // a weaker duplicate of each
    }
    const picked = selectForContext(hits);
    expect(picked).toHaveLength(5);
    expect(picked).toEqual(['d0.ts', 'd1.ts', 'd2.ts', 'd3.ts', 'd4.ts']);
  });
});
