// ─────────────────────────────────────────────────────────────────────────────
// Schema-coverage guards (gap 50 / gap 84).
//
// `ALL_COLUMN_NAMES` drives pgStore's key-normalising result mapper: any column a
// row→object mapper reads MUST appear here, or Postgres hands back a folded key the
// mapper never picks up (a silently-null field). These tests pin down two things the
// mapper relies on:
//   1. the columns the row mappers depend on are actually present in the list, and
//   2. the list has no duplicate entries (it is built through a Set, so a duplicate
//      would signal the de-dup was removed).
//
// The INDEXES array is intentionally NOT exported (it is an internal migration detail),
// so the hot-query index guard reads the migration source directly rather than widening
// the module's public surface — the same file-read approach pgCompat.test.ts uses.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ALL_COLUMN_NAMES } from '../migrations';

const MIGRATIONS_SRC = readFileSync(
  join(process.cwd(), 'agentic', 'db', 'migrations.ts'),
  'utf8',
);

describe('ALL_COLUMN_NAMES coverage', () => {
  // The columns the row→object mappers (tasks.ts, agents.ts, …) read by camelCase name.
  // If any of these ever falls out of the schema, the pg result mapper stops reconciling
  // it and the field silently reads as null/undefined on Postgres.
  const REQUIRED = [
    'id', 'plan', 'journal', 'failureDetail', 'consultLog',
    'projectId', 'stage', 'qaVerdict',
  ] as const;

  it('includes every column the row mappers depend on', () => {
    const missing = REQUIRED.filter(c => !ALL_COLUMN_NAMES.includes(c));
    expect(missing).toEqual([]);
  });

  it('has no duplicate entries', () => {
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const name of ALL_COLUMN_NAMES) {
      if (seen.has(name)) dupes.push(name);
      seen.add(name);
    }
    expect(dupes).toEqual([]);
    // Sanity: the Set-based build means unique count === length.
    expect(new Set(ALL_COLUMN_NAMES).size).toBe(ALL_COLUMN_NAMES.length);
  });
});

describe('hot-query indexes (gap 84)', () => {
  // Each hot query verified at its call site. The index must exist in the migration's
  // INDEXES array for the query to stay off a full table scan. INDEXES is not exported,
  // so assert against the migration source text.
  const EXPECTED_INDEXES: Array<[string, RegExp]> = [
    // per-task and project-scoped log reads / purges
    ['agent_logs(taskId)', /idx_agent_logs_task\s+ON\s+agent_logs\(taskId\)/],
    ['agent_logs(projectId)', /idx_agent_logs_project\s+ON\s+agent_logs\(projectId\)/],
    // board / dispatch: project + status; orchestrator scan: status + stage
    ['tasks(projectId, status)', /idx_tasks_project_status\s+ON\s+tasks\(projectId,\s*status\)/],
    ['tasks(status, stage)', /idx_tasks_status_stage\s+ON\s+tasks\(status,\s*stage\)/],
    // project-scoped context reads
    ['context_files(projectId)', /idx_ctx_files_proj\s+ON\s+context_files\(projectId\)/],
  ];

  for (const [label, re] of EXPECTED_INDEXES) {
    it(`declares a hot-query index on ${label}`, () => {
      expect(re.test(MIGRATIONS_SRC)).toBe(true);
    });
  }

  it('creates every index idempotently (CREATE INDEX IF NOT EXISTS)', () => {
    // A CREATE INDEX without IF NOT EXISTS would throw on the second boot.
    const bareCreates = MIGRATIONS_SRC.split('\n').filter(
      line => /CREATE\s+(UNIQUE\s+)?INDEX\s+/i.test(line) && !/IF\s+NOT\s+EXISTS/i.test(line),
    );
    expect(bareCreates).toEqual([]);
  });
});
