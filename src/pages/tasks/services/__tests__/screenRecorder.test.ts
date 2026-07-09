// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { estimateBitrate, availableTiers, defaultTier, isUserCancel, QUALITY_TIERS } from '../screenRecorder';

/** Pretend the display is `w×h` CSS px at `dpr` scaling. */
function mockScreen(w: number, h: number, dpr = 1) {
  vi.stubGlobal('devicePixelRatio', dpr);
  Object.defineProperty(window, 'devicePixelRatio', { value: dpr, configurable: true });
  Object.defineProperty(window.screen, 'width', { value: w, configurable: true });
  Object.defineProperty(window.screen, 'height', { value: h, configurable: true });
}

afterEach(() => vi.unstubAllGlobals());

describe('estimateBitrate', () => {
  it('reproduces the original 5 Mbps default at 1080p30', () => {
    // The port replaced a hardcoded 5_000_000 — the formula must not regress that baseline.
    expect(estimateBitrate(1920, 1080, 30)).toBeCloseTo(4_976_640, -5);
  });

  it('scales with pixels and frame rate', () => {
    const p1080 = estimateBitrate(1920, 1080, 30);
    const p4k = estimateBitrate(3840, 2160, 30);
    const p4k60 = estimateBitrate(3840, 2160, 60);
    expect(p4k).toBeGreaterThan(p1080 * 3);   // 4× the pixels
    expect(p4k60).toBeGreaterThan(p4k);        // more frames → more bits
  });

  it('clamps to a sane floor and ceiling', () => {
    expect(estimateBitrate(160, 120, 1)).toBe(2_000_000);        // floor
    expect(estimateBitrate(7680, 4320, 120)).toBe(50_000_000);   // ceiling
  });
});

describe('availableTiers', () => {
  beforeEach(() => mockScreen(1920, 1080));

  it('offers only tiers the display can actually produce', () => {
    const byId = Object.fromEntries(availableTiers().map(t => [t.id, t.supported]));
    expect(byId['720p']).toBe(true);
    expect(byId['1080p']).toBe(true);
    expect(byId['2k']).toBe(false);   // upscaling adds size, not detail
    expect(byId['4k']).toBe(false);
  });

  it('accounts for devicePixelRatio — 2048x1152 @1.25 is really a 2560x1440 panel', () => {
    mockScreen(2048, 1152, 1.25);
    const byId = Object.fromEntries(availableTiers().map(t => [t.id, t.supported]));
    expect(byId['2k']).toBe(true);
    expect(byId['4k']).toBe(false);
  });

  it('always allows 720p — every display can downscale to it', () => {
    mockScreen(800, 600);
    expect(availableTiers().find(t => t.id === '720p')!.supported).toBe(true);
  });

  it('returns every known tier', () => {
    expect(availableTiers().map(t => t.id)).toEqual(QUALITY_TIERS.map(t => t.id));
  });
});

describe('defaultTier', () => {
  it('picks the largest tier the display supports', () => {
    mockScreen(3840, 2160);
    expect(defaultTier()).toBe('4k');
    mockScreen(1920, 1080);
    expect(defaultTier()).toBe('1080p');
    mockScreen(1280, 720);
    expect(defaultTier()).toBe('720p');
  });
});

describe('isUserCancel', () => {
  it('treats a dismissed picker as a cancel, not an error', () => {
    expect(isUserCancel(new DOMException('denied', 'NotAllowedError'))).toBe(true);
    expect(isUserCancel(new DOMException('aborted', 'AbortError'))).toBe(true);
  });

  it('does not swallow real failures', () => {
    expect(isUserCancel(new DOMException('boom', 'NotReadableError'))).toBe(false);
    expect(isUserCancel(new Error('network'))).toBe(false);
  });
});
