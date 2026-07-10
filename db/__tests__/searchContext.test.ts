import { describe, expect, it } from 'vitest';
import { selectForContext, DEFAULT_SELECT, type SearchHit } from '../searchContext';

const hit = (path: string, score: number, name = 'sym'): SearchHit => ({ path, score, name });

describe('selectForContext', () => {
  it('keeps the strong hits and drops the weak ones', () => {
    const picked = selectForContext([
      hit('a.ts', 0.90), hit('b.ts', 0.80), hit('c.ts', 0.30), hit('d.ts', 0.10),
    ]);
    expect(picked).toEqual(['a.ts', 'b.ts']);   // floor is 0.6 * 0.90 = 0.54
  });

  // The two search paths score on different scales: the embedding path is cosine similarity in
  // [0,1]; the keyword fallback counts how many of your words appear, an unbounded integer.
  // A fixed threshold cannot serve both, so the floor is relative to the best hit.
  it('works on the keyword fallback\'s integer scores too', () => {
    const picked = selectForContext([hit('a.ts', 4), hit('b.ts', 3), hit('c.ts', 1)]);
    expect(picked).toEqual(['a.ts', 'b.ts']);   // floor is 0.6 * 4 = 2.4
  });

  it('a single hit is always kept, whatever its absolute score', () => {
    expect(selectForContext([hit('only.ts', 0.02)])).toEqual(['only.ts']);
  });

  it('deduplicates by file: six symbols in one file is one file', () => {
    const picked = selectForContext([
      hit('a.ts', 0.9, 'one'), hit('a.ts', 0.85, 'two'), hit('a.ts', 0.8, 'three'), hit('b.ts', 0.7),
    ]);
    expect(picked).toEqual(['a.ts', 'b.ts']);
  });

  it('ranks a deduplicated file by its BEST symbol, not its last', () => {
    const picked = selectForContext([hit('b.ts', 0.95), hit('a.ts', 0.70), hit('a.ts', 0.99)]);
    expect(picked[0]).toBe('a.ts');
  });

  it('never floods the context: at most maxFiles', () => {
    const many = Array.from({ length: 20 }, (_, i) => hit(`f${i}.ts`, 1));
    expect(selectForContext(many)).toHaveLength(DEFAULT_SELECT.maxFiles);
    expect(selectForContext(many, { maxFiles: 2 })).toHaveLength(2);
  });

  it('maxFiles of 0 remembers nothing', () => {
    expect(selectForContext([hit('a.ts', 1)], { maxFiles: 0 })).toEqual([]);
  });

  it('a stricter floor keeps only near-perfect matches', () => {
    const hits = [hit('a.ts', 1.0), hit('b.ts', 0.9), hit('c.ts', 0.5)];
    expect(selectForContext(hits, { minRelativeScore: 0.95 })).toEqual(['a.ts']);
    expect(selectForContext(hits, { minRelativeScore: 0 })).toEqual(['a.ts', 'b.ts', 'c.ts']);
  });

  it('ignores junk rather than throwing: no hits, no path, no score, zero and negative scores', () => {
    expect(selectForContext([])).toEqual([]);
    expect(selectForContext([{ path: '', score: 1 } as SearchHit])).toEqual([]);
    expect(selectForContext([{ score: 1 } as unknown as SearchHit])).toEqual([]);
    expect(selectForContext([{ path: 'a.ts', score: Number.NaN } as SearchHit])).toEqual([]);
    expect(selectForContext([hit('a.ts', 0), hit('b.ts', -1)])).toEqual([]);
  });
});
