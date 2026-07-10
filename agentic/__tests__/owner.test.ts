import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { unlinkSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

import { buildConfig, setConfig, getConfig } from '../index';
import { createTask, getTask, updateTask, coerceScenarios } from '../db/tasks';
import { getAgents } from '../db/agents';
import { DEFAULT_AGENTS } from '../db/defaults';

const tempDbPath = join(tmpdir(), `mc-owner-${randomBytes(6).toString('hex')}.db`);

beforeAll(() => {
  const cfg = buildConfig();
  cfg.paths.tasksDbPath = tempDbPath;
  setConfig(cfg);
});

afterAll(() => {
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    try { unlinkSync(tempDbPath + suffix); } catch { /* ignore */ }
  }
});

// The user's original ask is the ONLY thing an acceptance gate can judge against. If any agent
// can rewrite it, the gate ends up checking the work against a description the work produced.
describe('intent is write-once', () => {
  it('is captured at creation, defaulting to the description', async () => {
    await createTask({ id: 'int1', title: 'T', description: 'make the header blue', status: 'WORKING' });
    expect((await getTask('int1'))!.intent).toBe('make the header blue');
  });

  it('falls back to the title when there is no description', async () => {
    await createTask({ id: 'int2', title: 'just a title', status: 'WORKING' });
    expect((await getTask('int2'))!.intent).toBe('just a title');
  });

  it('an explicit intent at creation wins over the description', async () => {
    await createTask({ id: 'int3', title: 'T', description: 'desc', intent: 'the real ask', status: 'WORKING' });
    expect((await getTask('int3'))!.intent).toBe('the real ask');
  });

  it('CANNOT be overwritten by a later update — an agent must not restate the user\'s ask', async () => {
    await createTask({ id: 'int4', title: 'T', description: 'make the header blue', status: 'WORKING' });
    await updateTask('int4', { intent: 'make the header any colour, really' });
    expect((await getTask('int4'))!.intent).toBe('make the header blue');
  });

  it('other fields still update normally alongside a rejected intent write', async () => {
    await createTask({ id: 'int5', title: 'T', description: 'original ask', status: 'WORKING' });
    await updateTask('int5', { intent: 'hijacked', summary: 'the plan', stage: 'build' });
    const t = (await getTask('int5'))!;
    expect(t.intent).toBe('original ask'); // held
    expect(t.summary).toBe('the plan');    // written
    expect(t.stage).toBe('build');         // written
  });

  it('cannot be nulled or blanked either — the guard is not just about replacement', async () => {
    await createTask({ id: 'int6', title: 'T', description: 'original ask', status: 'WORKING' });
    await updateTask('int6', { intent: null });
    await updateTask('int6', { intent: '' });
    expect((await getTask('int6'))!.intent).toBe('original ask');
  });

  it('a pre-migration row with an empty intent can still gain one', async () => {
    // Rows created before the column existed read back as NULL/'' — those, and only those,
    // may be backfilled.
    await createTask({ id: 'int7', title: 'T', intent: '', status: 'WORKING' });
    expect((await getTask('int7'))!.intent).toBeFalsy();
    await updateTask('int7', { intent: 'backfilled' });
    expect((await getTask('int7'))!.intent).toBe('backfilled');
  });
});

// A task will not dispatch without at least one scenario. The owner's whole job at intake is
// to write them, and it is told to PUT them as a Gherkin string — which used to normalise to
// [] and stall the task with no error anywhere.
describe('scenario coercion (what agents actually send)', () => {
  it('parses the exact shape the owner and architect prompts tell agents to send', () => {
    const s = coerceScenarios('GIVEN the board is empty WHEN I add a task THEN it appears');
    expect(s).toHaveLength(1);
    expect(s[0].given).toBe('the board is empty');
    expect(s[0].when).toBe('I add a task');
    expect(s[0].then).toBe('it appears');
  });

  it('splits blank-line separated blocks into separate scenarios', () => {
    const s = coerceScenarios('GIVEN a WHEN b THEN c\n\nGIVEN d WHEN e THEN f');
    expect(s.map(x => x.then)).toEqual(['c', 'f']);
  });

  it('splits one-per-line when every line is a scenario', () => {
    const s = coerceScenarios('GIVEN a WHEN b THEN c\nGIVEN d WHEN e THEN f');
    expect(s.map(x => x.then)).toEqual(['c', 'f']);
  });

  it('strips a leading "Scenario N:" label', () => {
    expect(coerceScenarios('Scenario 1: GIVEN a THEN b')[0].then).toBe('b');
  });

  it('keeps a bare statement rather than dropping it', () => {
    // Silently dropping an unparseable scenario is worse than storing it verbatim: the task
    // stalls with no scenarios and nothing says why.
    expect(coerceScenarios('the header must be readable')).toEqual([{ then: 'the header must be readable' }]);
  });

  it('accepts arrays of strings, arrays of objects, and double-encoded JSON', () => {
    expect(coerceScenarios(['GIVEN a THEN b']).map(x => x.then)).toEqual(['b']);
    expect(coerceScenarios([{ then: 'c' }]).map(x => x.then)).toEqual(['c']);
    expect(coerceScenarios('[{"then":"d"}]').map(x => x.then)).toEqual(['d']);
  });

  it('is empty for empty input, and drops malformed array members', () => {
    expect(coerceScenarios(null)).toEqual([]);
    expect(coerceScenarios('')).toEqual([]);
    expect(coerceScenarios('   ')).toEqual([]);
    expect(coerceScenarios([{ nope: 1 }, 42, null])).toEqual([]);
  });

  it('survives the DB round-trip — the bug was in storage, not in parsing', async () => {
    await createTask({ id: 'sc1', title: 'T', status: 'WORKING' });
    // Exactly what an owner's curl sends.
    await updateTask('sc1', { scenarios: 'GIVEN a WHEN b THEN c' as any });
    const back = (await getTask('sc1'))!.scenarios!;
    expect(back).toHaveLength(1);
    expect(back[0].then).toBe('c');
  });

  it('an already-parsed array survives a second update untouched', async () => {
    await createTask({ id: 'sc2', title: 'T', scenarios: [{ then: 'x' }], status: 'WORKING' });
    await updateTask('sc2', { summary: 'plan' }); // unrelated write re-serialises the row
    expect((await getTask('sc2'))!.scenarios).toEqual([{ then: 'x' }]);
  });

  it('recovers a legacy row whose scenarios were stored double-encoded', async () => {
    // Written by an older build: JSON.stringify("GIVEN a THEN b") => '"GIVEN a THEN b"'.
    // safeParseScenarios read that back as [] and the task could never dispatch.
    const { getStore, ensureMigrated } = await import('../db/getStore');
    await ensureMigrated('tasks');
    await createTask({ id: 'sc3', title: 'legacy', status: 'WORKING' });
    await getStore('tasks').run(`UPDATE tasks SET scenarios = ? WHERE id = ?`,
      [JSON.stringify('GIVEN a WHEN b THEN c'), 'sc3']);

    const back = (await getTask('sc3'))!.scenarios!;
    expect(back).toHaveLength(1);
    expect(back[0].then).toBe('c');
  });
});

describe('owner role registration', () => {
  it('ships as a system role with both of its stage templates', () => {
    const owner = DEFAULT_AGENTS.find(a => a.role === 'owner')!;
    expect(owner).toBeDefined();
    expect(owner.isSystem).toBe(true);
    expect(owner.promptTemplate).toBeTruthy();       // intake
    expect(owner.acceptPromptTemplate).toBeTruthy(); // accept
  });

  it('is told, in both templates, that it cannot see the running app', () => {
    // The single most expensive failure mode: an owner that cannot see pixels bouncing a task
    // for "the colour is wrong" and triggering a full re-plan on a guess.
    const owner = DEFAULT_AGENTS.find(a => a.role === 'owner')!;
    expect(owner.promptTemplate).toMatch(/no ability to see|NO eyes/i);
    expect(owner.acceptPromptTemplate!).toMatch(/NO eyes|cannot see/i);
    expect(owner.acceptPromptTemplate!).toMatch(/never comment on colour/i);
  });

  it('never sets qaVerdict — it cannot overrule QA', () => {
    const owner = DEFAULT_AGENTS.find(a => a.role === 'owner')!;
    // The accept template must not hand it a qaVerdict write.
    expect(owner.acceptPromptTemplate!).not.toMatch(/"qaVerdict":\s*"(pass|fail)"/);
  });

  it('is backfilled into an EXISTING agents table, not only a fresh one', async () => {
    // seedIfEmpty used to seed only when the table was empty, so a system role added later
    // would never appear on an existing install and the orchestrator would look up nothing.
    const roles = (await getAgents()).map(a => a.role);
    for (const d of DEFAULT_AGENTS) expect(roles).toContain(d.role);
    expect(roles).toContain('owner');
  });

  it('loads acceptPromptTemplate back out of the DB (not dropped by rowToAgent)', async () => {
    const owner = (await getAgents()).find(a => a.role === 'owner')!;
    expect(owner.acceptPromptTemplate).toBeTruthy();
    expect(owner.acceptPromptTemplate).not.toBe(owner.promptTemplate);
  });
});

// The hard-coded routing table these tests pinned is gone: routing is now graph-driven, and
// agentic/workflow/__tests__/route.test.ts covers it — including the case that matters most,
// where renaming `qa` to `tapora` leaves it holding the QA powers.
