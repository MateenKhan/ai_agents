import { describe, expect, it } from 'vitest';
import {
  superpowersMethodology,
  superpowersPreamble,
  skillsForRole,
  ROLE_SKILLS,
  DEFAULT_SKILLS,
} from '../superpowers';

describe('skillsForRole', () => {
  it('dev leads with test-driven-development', () => {
    expect(skillsForRole('dev')).toContain('test-driven-development');
  });
  it('architect leads with planning skills', () => {
    expect(skillsForRole('architect')).toEqual(ROLE_SKILLS.architect);
    expect(skillsForRole('architect')).toContain('writing-plans');
  });
  it('an unknown/custom role falls back to the defaults', () => {
    expect(skillsForRole('reviewer')).toEqual(DEFAULT_SKILLS);
  });
});

describe('superpowersPreamble', () => {
  it('names the role and its skills', () => {
    const p = superpowersPreamble('dev');
    expect(p).toContain('"dev"');
    expect(p).toContain('test-driven-development');
  });

  // It must NOT assert the skills are installed — they usually are not, and a false claim sends
  // the agent hunting for skills that do not exist. The claim is conditional.
  it('is conditional, never asserting the skills are present', () => {
    const p = superpowersPreamble('dev');
    expect(p).toMatch(/\bIF\b/);
    expect(p).toMatch(/if they are not installed/i);
    expect(p).not.toMatch(/library is installed in this environment/);
  });

  it('is non-empty for a custom role too', () => {
    expect(superpowersPreamble('reviewer').length).toBeGreaterThan(0);
    expect(superpowersPreamble('reviewer')).toContain('brainstorming');
  });
});

describe('superpowersMethodology (the wired seam)', () => {
  it('preambleFor delegates to superpowersPreamble', () => {
    expect(superpowersMethodology.preambleFor('qa')).toBe(superpowersPreamble('qa'));
  });
});
