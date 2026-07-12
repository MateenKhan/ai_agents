import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { unlinkSync, rmSync, mkdtempSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

// Point the runtime config at throwaway temp DBs BEFORE any tasks/logs helper runs, so
// every db-touching helper below binds to the temp files and never touches the real
// board (same pattern as limitPause.test.ts / tasks.test.ts). logsDir is redirected too:
// parkOverBudget/reconcileBudgetPause log via the orchestrator's file logger.
import { buildConfig, setConfig } from '../index';
import { extractCostUsd, estimateTurnCostUsd, MAX_TURNS_PER_RUN } from '../engine/runner';
import {
  budgetDecision, parkOverBudget, reconcileBudgetPause, BUDGET_PAUSE_KEY,
} from '../engine/orchestrator';
import {
  createTask, getTask, addTaskCost, addDailySpend, getDailySpend,
  getAgentDefaults, setAgentDefaults, getSystemState,
} from '../db/tasks';

const tempDbPath = join(tmpdir(), `mc-cost-test-${randomBytes(6).toString('hex')}.db`);
const tempLogsDb = join(tmpdir(), `mc-cost-logs-${randomBytes(6).toString('hex')}.db`);
const tempLogsDir = mkdtempSync(join(tmpdir(), 'mc-cost-logs-'));

beforeAll(() => {
  const cfg = buildConfig();
  cfg.paths.tasksDbPath = tempDbPath;
  cfg.paths.logsDbPath = tempLogsDb;
  cfg.paths.logsDir = tempLogsDir;
  setConfig(cfg); // must precede the first db() call in any helper below
});

afterAll(() => {
  // WAL leaves -wal/-shm sidecars; remove all, ignore if absent.
  for (const base of [tempDbPath, tempLogsDb]) {
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      try { unlinkSync(base + suffix); } catch { /* ignore */ }
    }
  }
  try { rmSync(tempLogsDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

// ── extractCostUsd: pure — the stream-json `result` event carries the run's cost ──
describe('extractCostUsd', () => {
  it('extracts total_cost_usd from a result event line', () => {
    const line = JSON.stringify({ type: 'result', subtype: 'success', total_cost_usd: 0.4273, num_turns: 12 });
    expect(extractCostUsd(line)).toBe(0.4273);
  });

  it('accepts a zero-cost result (cached run) but rejects a negative one', () => {
    expect(extractCostUsd(JSON.stringify({ type: 'result', total_cost_usd: 0 }))).toBe(0);
    expect(extractCostUsd(JSON.stringify({ type: 'result', total_cost_usd: -1 }))).toBeNull();
  });

  it('returns null for non-result events, even ones that mention a cost-like field', () => {
    expect(extractCostUsd(JSON.stringify({ type: 'assistant', message: { content: [] } }))).toBeNull();
    expect(extractCostUsd(JSON.stringify({ type: 'system', total_cost_usd: 9.99 }))).toBeNull();
  });

  it('returns null when the result carries no usable number', () => {
    expect(extractCostUsd(JSON.stringify({ type: 'result', subtype: 'success' }))).toBeNull();
    expect(extractCostUsd(JSON.stringify({ type: 'result', total_cost_usd: '0.42' }))).toBeNull();
    expect(extractCostUsd(JSON.stringify({ type: 'result', total_cost_usd: NaN }))).toBeNull();
  });

  it('returns null on garbage that is not JSON at all', () => {
    expect(extractCostUsd('')).toBeNull();
    expect(extractCostUsd('not json')).toBeNull();
  });
});

// ── estimateTurnCostUsd: pure — SDK-loop runs price each turn from its usage block ──
describe('estimateTurnCostUsd', () => {
  it('prices a sonnet turn at $3/MTok in, $15/MTok out', () => {
    // 1M input + 1M output = $3 + $15.
    expect(estimateTurnCostUsd('sonnet', { input_tokens: 1_000_000, output_tokens: 1_000_000 })).toBeCloseTo(18, 6);
  });

  it('bills cache reads at 0.1× and cache writes at 1.25× the input rate', () => {
    // opus: $5/MTok input → 1M cache-read = $0.50, 1M cache-write = $6.25.
    expect(estimateTurnCostUsd('claude-opus-4-8', { cache_read_input_tokens: 1_000_000 })).toBeCloseTo(0.5, 6);
    expect(estimateTurnCostUsd('claude-opus-4-8', { cache_creation_input_tokens: 1_000_000 })).toBeCloseTo(6.25, 6);
  });

  it('a missing usage block costs nothing', () => {
    expect(estimateTurnCostUsd('sonnet', null)).toBe(0);
    expect(estimateTurnCostUsd('sonnet', undefined)).toBe(0);
  });

  it('the per-run turn bound is the named 80-turn constant', () => {
    expect(MAX_TURNS_PER_RUN).toBe(80);
  });
});

// ── accumulation: task lifetime total + the project's daily ledger (temp DB) ──────
describe('cost accumulation', () => {
  it('accumulates across two runs on the task row and reads back via getTask', async () => {
    const id = 't-cost-accum';
    await createTask({ id, title: 'accumulates cost', status: 'WORKING' });
    expect((await getTask(id))?.costUsd).toBeUndefined(); // NULL column = no spend yet

    expect(await addTaskCost(id, 0.5)).toBeCloseTo(0.5, 9);
    expect(await addTaskCost(id, 0.25)).toBeCloseTo(0.75, 9);
    expect((await getTask(id))?.costUsd).toBeCloseTo(0.75, 9);
  });

  it('accumulates the project daily ledger per day, starting from zero', async () => {
    expect(await getDailySpend('proj-ledger')).toBe(0);
    expect(await addDailySpend('proj-ledger', 1.5)).toBeCloseTo(1.5, 9);
    expect(await addDailySpend('proj-ledger', 2.25)).toBeCloseTo(3.75, 9);
    expect(await getDailySpend('proj-ledger')).toBeCloseTo(3.75, 9);
    // Another day is another bucket — yesterday's runs never count against today.
    expect(await getDailySpend('proj-ledger', '2020-01-01')).toBe(0);
    // Another project is another bucket.
    expect(await getDailySpend('proj-other')).toBe(0);
  });
});

// ── per-task cap: parks BLOCKED, keeps attempts, is NOT a dead-letter ─────────────
describe('per-task budget cap', () => {
  it('budgetDecision parks at/above the cap and dispatches below it', () => {
    expect(budgetDecision({ taskCostUsd: 1.99, taskCapUsd: 2, dailySpendUsd: 0, dailyCapUsd: 25 }))
      .toEqual({ kind: 'dispatch' });
    expect(budgetDecision({ taskCostUsd: 2, taskCapUsd: 2, dailySpendUsd: 0, dailyCapUsd: 25 }))
      .toEqual({ kind: 'park-task', reason: 'budget exceeded: $2.00 of $2 cap' });
    // The task cap outranks the daily gate: parking is durable information, a skip is not.
    expect(budgetDecision({ taskCostUsd: 3, taskCapUsd: 2, dailySpendUsd: 99, dailyCapUsd: 25 }).kind)
      .toBe('park-task');
    // A cap of 0 disables the gate.
    expect(budgetDecision({ taskCostUsd: 999, taskCapUsd: 0, dailySpendUsd: 0, dailyCapUsd: 0 }))
      .toEqual({ kind: 'dispatch' });
  });

  it('parkOverBudget moves the task to BLOCKED without touching attempts or dead-lettering', async () => {
    const id = 't-cost-park';
    await createTask({ id, title: 'over budget', status: 'WORKING', attempts: 2 });
    await addTaskCost(id, 2.5);

    const task = (await getTask(id))!;
    const decision = budgetDecision({ taskCostUsd: task.costUsd || 0, taskCapUsd: 2, dailySpendUsd: 0, dailyCapUsd: 25 });
    expect(decision.kind).toBe('park-task');
    await parkOverBudget(task, (decision as { kind: 'park-task'; reason: string }).reason);

    const parked = (await getTask(id))!;
    expect(parked.status).toBe('BLOCKED');
    expect(parked.lastError).toBe('budget exceeded: $2.50 of $2 cap');
    expect(parked.attempts).toBe(2);          // no attempt consumed
    expect(parked.nextRetryAt).toBeNull();    // no DEAD_LETTER_AT sentinel — not a dead-letter
    expect(parked.claimedBy).toBeNull();
    expect(parked.started).toBeNull();
  });
});

// ── daily cap: stops dispatch and records why in system_state ────────────────────
describe('daily budget cap', () => {
  it('budgetDecision pauses dispatch when today’s spend meets the daily cap', () => {
    expect(budgetDecision({ taskCostUsd: 0, taskCapUsd: 2, dailySpendUsd: 24.99, dailyCapUsd: 25 }))
      .toEqual({ kind: 'dispatch' });
    expect(budgetDecision({ taskCostUsd: 0, taskCapUsd: 2, dailySpendUsd: 25, dailyCapUsd: 25 }))
      .toEqual({ kind: 'daily-pause', reason: 'daily budget exceeded: $25.00 of $25 cap' });
  });

  it('the gate trips off the SAME ledger the accumulator writes', async () => {
    await addDailySpend('proj-daily', 30);
    const spend = await getDailySpend('proj-daily');
    expect(budgetDecision({ taskCostUsd: 0, taskCapUsd: 0, dailySpendUsd: spend, dailyCapUsd: 25 }).kind)
      .toBe('daily-pause');
  });

  it('reconcileBudgetPause records the reason durably and clears it when the gate opens', async () => {
    expect(await getSystemState(BUDGET_PAUSE_KEY)).toBeNull();
    await reconcileBudgetPause(['project "default": daily budget exceeded: $30.00 of $25 cap']);
    expect(await getSystemState(BUDGET_PAUSE_KEY))
      .toBe('project "default": daily budget exceeded: $30.00 of $25 cap');
    // Re-derived every tick: an empty reason list (day rolled / caps raised) clears the key.
    await reconcileBudgetPause([]);
    expect(await getSystemState(BUDGET_PAUSE_KEY)).toBeNull();
  });
});

// ── caps config: defaults when unset, round-trip beside the existing defaults ────
describe('budget caps in agent defaults', () => {
  it('defaults to $2/task and $25/day when nothing is stored', async () => {
    const d = await getAgentDefaults();
    expect(d.taskCapUsd).toBe(2);
    expect(d.dailyCapUsd).toBe(25);
  });

  it('caps round-trip through setAgentDefaults without disturbing each other', async () => {
    await setAgentDefaults({ taskCapUsd: 5 });
    let d = await getAgentDefaults();
    expect(d.taskCapUsd).toBe(5);
    expect(d.dailyCapUsd).toBe(25); // untouched cap keeps its default

    await setAgentDefaults({ dailyCapUsd: 100 });
    d = await getAgentDefaults();
    expect(d.taskCapUsd).toBe(5);
    expect(d.dailyCapUsd).toBe(100);
    // The neighbours the caps live beside are preserved too.
    expect(d.maxConcurrency).toBe(0);
    expect(d.permissionProfile).toBe('standard');
  });
});
