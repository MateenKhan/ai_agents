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
  it('names the role and its skills, and mentions superpowers', () => {
    const p = superpowersPreamble('dev');
    expect(p).toContain('SUPERPOWERS');
    expect(p).toContain('"dev"');
    expect(p).toContain('test-driven-development');
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
