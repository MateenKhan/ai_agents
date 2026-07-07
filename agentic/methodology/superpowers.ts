// ─────────────────────────────────────────────────────────────────────────────
// Methodology seam → obra/superpowers  (https://github.com/obra/superpowers)
//
// superpowers is a skill library that auto-loads in Claude Code. The engine can't
// (and shouldn't) call it directly — instead it renders a PREAMBLE onto each role's
// prompt telling the agent which skills to lead with. That preamble is produced here
// and injected by engine/prompts.ts via config.methodology.preambleFor(role).
//
// This module is intentionally dependency-free (type-only imports) so the web UI can
// import the same skill map to SHOW users what powers each role has, with no drift.
// ─────────────────────────────────────────────────────────────────────────────

import type { Methodology } from '../types';

/** The superpowers skills each built-in role leads with. Custom roles fall back to
 *  DEFAULT_SKILLS. Names track skills shipped by obra/superpowers. */
export const ROLE_SKILLS: Record<string, string[]> = {
  architect: ['brainstorming', 'writing-plans'],
  dev: ['test-driven-development', 'executing-plans', 'ui-ux-pro-max'],
  qa: ['test-driven-development', 'requesting-code-review'],
};

/** Applied to any role without an explicit entry (i.e. user-created custom agents). */
export const DEFAULT_SKILLS: string[] = ['brainstorming', 'test-driven-development'];

/** One-line, human-facing description per skill — used by the Agents UI chips. */
export const SKILL_DESCRIPTIONS: Record<string, string> = {
  'brainstorming': 'Explore approaches before committing when the path is ambiguous.',
  'writing-plans': 'Produce a crisp, scoped, testable plan.',
  'executing-plans': 'Follow the plan step by step, staying in scope.',
  'test-driven-development': 'Red → green → refactor: write the failing test first.',
  'requesting-code-review': 'Self-review against the acceptance criteria before handoff.',
  'ui-ux-pro-max': 'Apply vetted UI/UX patterns when building interface work.',
};

/** The superpowers skills for a role (explicit entry, else the custom-role default). */
export function skillsForRole(role: string): string[] {
  return ROLE_SKILLS[role] ?? DEFAULT_SKILLS;
}

/** The prompt preamble injected ahead of a role's template. */
export function superpowersPreamble(role: string): string {
  const skills = skillsForRole(role);
  return [
    'SUPERPOWERS — the superpowers skill library is installed in this environment.',
    `For this "${role}" role, lead with these skills: ${skills.join(', ')}.`,
    'Consult the relevant skill BEFORE acting, follow it, and state which skill you are using.',
    'These skills define HOW you work; the task brief below defines WHAT you deliver.',
  ].join('\n');
}

/** Drop-in Methodology for config.methodology — wires superpowers into every prompt. */
export const superpowersMethodology: Methodology = {
  preambleFor: superpowersPreamble,
};
