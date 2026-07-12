import { describe, it, expect } from 'vitest';

import { DEFAULT_AGENTS } from '../db/defaults';
import type { AgentConfig } from '../types';

// The extended IT-industry roster. These ship as built-in defaults so they exist on first
// boot (agents.ts backfills missing DEFAULT_AGENTS roles at startup) and are restored by
// POST /agents/reset (seed.ts reverts every built-in role). Everything here is asserted
// against DEFAULT_AGENTS itself — the seeding/restore machinery has its own tests.
const NEW_ROLES = [
  'product-owner',
  'business-analyst',
  'scrum-master',
  'delivery-manager',
  'devops-engineer',
  'security-engineer',
  'sre',
  'ui-ux-designer',
  'data-engineer',
  'tech-writer',
] as const;

// The original pipeline roles. Code elsewhere (the default workflow graph, the seeding
// tests) assumes these exist — adding a roster must never displace them.
const ORIGINAL_ROLES = ['owner', 'architect', 'dev', 'qa'] as const;

const byRole = (role: string): AgentConfig | undefined => DEFAULT_AGENTS.find(a => a.role === role);

describe('the extended default roster', () => {
  it('ships every new IT-industry role', () => {
    for (const role of NEW_ROLES) {
      expect(byRole(role), `missing built-in role '${role}'`).toBeDefined();
    }
  });

  it('still ships the original four pipeline roles, first and in order', () => {
    for (const role of ORIGINAL_ROLES) {
      expect(byRole(role), `original role '${role}' was displaced`).toBeDefined();
    }
    // The first four entries are the pipeline roles — appending the roster must not reorder
    // them, because the default workflow and its tests were written against this order.
    expect(DEFAULT_AGENTS.slice(0, 4).map(a => a.role)).toEqual([...ORIGINAL_ROLES]);
  });

  it('has a unique role id for every entry — duplicates would collide in the agents table', () => {
    const roles = DEFAULT_AGENTS.map(a => a.role);
    expect(new Set(roles).size).toBe(roles.length);
  });

  it('gives every entry a non-empty role, label, model, and prompt', () => {
    for (const a of DEFAULT_AGENTS) {
      expect(a.role, 'role must be non-empty').toBeTruthy();
      expect(a.label, `'${a.role}' needs a label`).toBeTruthy();
      expect(a.model, `'${a.role}' needs a model`).toBeTruthy();
      expect(a.promptTemplate, `'${a.role}' needs a prompt`).toBeTruthy();
    }
  });

  it('keeps the new roles on sonnet — opus is reserved for the owner and the architect', () => {
    for (const role of NEW_ROLES) {
      expect(byRole(role)!.model, `'${role}' must be sonnet`).toBe('sonnet');
    }
  });

  it('marks every new role as a system role, so reset restores it and the UI cannot delete it', () => {
    for (const role of NEW_ROLES) {
      expect(byRole(role)!.isSystem, `'${role}' must be a system role`).toBe(true);
    }
  });

  it('gives every entry a valid worktree mode and a distinct display order', () => {
    const modes = ['plan', 'create', 'reuse', 'none'];
    for (const a of DEFAULT_AGENTS) {
      expect(modes, `'${a.role}' has an invalid worktreeMode '${a.worktreeMode}'`).toContain(a.worktreeMode);
    }
    const ords = DEFAULT_AGENTS.map(a => a.ord);
    expect(new Set(ords).size).toBe(ords.length);
  });

  it('never hard-codes a stage in any new template — routing is graph-driven', () => {
    // The same rule promptOutcomes.test.ts pins for the whole roster, asserted here per new
    // role so a regression names the offender directly.
    for (const role of NEW_ROLES) {
      const a = byRole(role)!;
      expect(a.promptTemplate, `'${role}' names a stage`).not.toMatch(/"stage"\s*:/);
    }
  });

  it('tells every new role how to hand off — each prompt carries the outcome PUT', () => {
    // Belt and braces: renderPrompt appends a HOW TO FINISH block anyway, but the shipped
    // templates follow the house convention of an explicit outcome curl.
    for (const role of NEW_ROLES) {
      expect(byRole(role)!.promptTemplate).toMatch(/"outcome"\s*:\s*"/);
    }
  });

  it('gives GIT RULES to every role that works in a task worktree', () => {
    // Roles with a worktree of their own ('create') or the dev's ('reuse') can run git —
    // they carry the same strict rules the dev and QA do. Read-only ('plan') and repo-less
    // ('none') roles skip them, exactly as the architect's plan template does.
    for (const a of DEFAULT_AGENTS) {
      if (a.worktreeMode === 'create' || a.worktreeMode === 'reuse') {
        expect(a.promptTemplate, `'${a.role}' runs in a worktree but has no GIT RULES`).toContain('GIT RULES');
      }
    }
  });
});
