import { describe, it, expect } from 'vitest';
import { toBuffer, fromBuffer, cosine } from '../embedder';

// Pure math helpers only. `embed`/`embedQuery` load a HF model and are NOT tested here.

describe('embedder buffer round-trip', () => {
  it('toBuffer -> fromBuffer reproduces a Float32Array exactly', () => {
    const arr = new Float32Array([1.5, -2.25, 0, 3.125, 1e-7, -0.0009765625]);
    const round = fromBuffer(toBuffer(arr));
    expect(round.length).toBe(arr.length);
    for (let i = 0; i < arr.length; i++) {
      expect(round[i]).toBe(arr[i]); // exact — Float32 in, Float32 out
    }
  });

  it('preserves length for an empty vector', () => {
    const arr = new Float32Array([]);
    expect(fromBuffer(toBuffer(arr)).length).toBe(0);
  });
});

describe('cosine similarity', () => {
  it('is ~1 for a vector with itself', () => {
    const a = new Float32Array([1, 2, 3, 4]);
    expect(cosine(a, a)).toBeCloseTo(1, 6);
  });

  it('is ~0 for orthogonal vectors', () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([0, 1, 0]);
    expect(cosine(a, b)).toBeCloseTo(0, 6);
  });

  it('is symmetric: cosine(a,b) === cosine(b,a)', () => {
    const a = new Float32Array([0.2, 0.5, -0.7, 1.1]);
    const b = new Float32Array([-0.3, 0.9, 0.4, 0.6]);
    expect(cosine(a, b)).toBeCloseTo(cosine(b, a), 12);
  });

  it('is ~-1 for anti-parallel vectors', () => {
    const a = new Float32Array([1, 2, 3]);
    const b = new Float32Array([-1, -2, -3]);
    expect(cosine(a, b)).toBeCloseTo(-1, 6);
  });
});
