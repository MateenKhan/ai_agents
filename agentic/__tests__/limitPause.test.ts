import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { unlinkSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

// Point the runtime config at a throwaway temp DB BEFORE any tasks helper runs, so the
// system_state helpers below bind to the temp file and never touch the real board
// (same pattern as tasks.test.ts).
import { buildConfig, setConfig } from '../index';
import { parseLimitReset, classify } from '../engine/runner';
import { getSystemState, setSystemState } from '../db/tasks';

const tempDbPath = join(tmpdir(), `mc-test-${randomBytes(6).toString('hex')}.db`);

beforeAll(() => {
  const cfg = buildConfig();
  cfg.paths.tasksDbPath = tempDbPath;
  setConfig(cfg); // must precede the first db() call in any helper below
});

afterAll(() => {
  // WAL leaves -wal/-shm sidecars; remove all, ignore if absent.
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    try { unlinkSync(tempDbPath + suffix); } catch { /* ignore */ }
  }
});

// ── parseLimitReset: pure, no DB ────────────────────────────────────────────────
describe('parseLimitReset', () => {
  it('extracts a seconds epoch (10 digits) and returns its ISO timestamp', () => {
    expect(parseLimitReset('Claude AI usage limit reached|1783725600'))
      .toBe(new Date(1783725600 * 1000).toISOString());
  });

  it('treats a 13-digit epoch as milliseconds, not seconds', () => {
    expect(parseLimitReset('Claude AI usage limit reached|1783725600000'))
      .toBe(new Date(1783725600000).toISOString());
  });

  it('returns null when the message carries no epoch', () => {
    expect(parseLimitReset('Claude AI usage limit reached')).toBeNull();
    expect(parseLimitReset('')).toBeNull();
    expect(parseLimitReset('some unrelated output')).toBeNull();
  });

  it('matches the message case-insensitively', () => {
    expect(parseLimitReset('USAGE LIMIT REACHED|1783725600'))
      .toBe(new Date(1783725600 * 1000).toISOString());
  });
});

// ── classify: 'limit' only on the explicit plan-limit message ───────────────────
describe('classify', () => {
  it("classifies the plan-limit message as 'limit', with or without an epoch", () => {
    expect(classify('Claude AI usage limit reached|1783725600')).toBe('limit');
    expect(classify('Claude AI usage limit reached')).toBe('limit');
  });

  it("keeps a bare 429 / rate-limit as 'network' — the circuit breaker owns those", () => {
    expect(classify('HTTP 429 too many requests')).toBe('network');
    expect(classify('rate limit exceeded, retry later')).toBe('network');
  });

  it("classifies anything unrecognised as 'crash'", () => {
    expect(classify('TypeError: x is undefined')).toBe('crash');
  });
});

// ── system_state round-trip (DB-backed against the temp DB) ─────────────────────
describe('getSystemState / setSystemState', () => {
  it('an absent key reads as null; a set value round-trips; a re-set overwrites in place', async () => {
    expect(await getSystemState('limitPausedUntil')).toBeNull();
    await setSystemState('limitPausedUntil', '2026-07-12T10:00:00.000Z');
    expect(await getSystemState('limitPausedUntil')).toBe('2026-07-12T10:00:00.000Z');
    // upsert semantics: the second write replaces the row rather than failing on the PK
    await setSystemState('limitPausedUntil', '2026-07-12T11:00:00.000Z');
    expect(await getSystemState('limitPausedUntil')).toBe('2026-07-12T11:00:00.000Z');
  });

  it('setting null deletes the row — the key reads back as null again', async () => {
    await setSystemState('limitPausedUntil', '2026-07-12T10:00:00.000Z');
    await setSystemState('limitPausedUntil', null);
    expect(await getSystemState('limitPausedUntil')).toBeNull();
  });

  it('keys are independent — deleting one leaves the others intact', async () => {
    await setSystemState('a', '1');
    await setSystemState('b', '2');
    await setSystemState('a', null);
    expect(await getSystemState('a')).toBeNull();
    expect(await getSystemState('b')).toBe('2');
  });
});
