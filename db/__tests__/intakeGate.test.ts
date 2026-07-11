import { describe, it, expect } from 'vitest';
import { specIssues } from '../intakeGate';

// A decomposed task is only handed to agents when it is specified well enough to build AND to
// judge "done" against. specIssues returns the reasons it is not; an empty result means "good".
describe('specIssues (intake quality gate)', () => {
  const goodDod = 'slugify lowercases, trims, collapses non-alphanumerics to single hyphens; a unit test passes';

  it('passes a well-specified task', () => {
    expect(specIssues('Add slugify', ['GIVEN text WHEN slugified THEN kebab-case'], goodDod)).toEqual([]);
  });

  it('flags a task with no acceptance scenarios', () => {
    const issues = specIssues('Add slugify', [], goodDod);
    expect(issues.some(i => /scenarios/.test(i))).toBe(true);
  });

  it('flags a definition of done that is just the title echoed back', () => {
    const issues = specIssues('Add slugify', ['GIVEN … THEN …'], 'Add slugify');
    expect(issues.some(i => /definition of done/.test(i))).toBe(true);
  });

  it('flags an empty or too-short definition of done', () => {
    expect(specIssues('T', ['GIVEN … THEN …'], '').some(i => /definition of done/.test(i))).toBe(true);
    expect(specIssues('T', ['GIVEN … THEN …'], 'too short').some(i => /definition of done/.test(i))).toBe(true);
  });

  it('reports BOTH problems when a task has neither scenarios nor a real DoD', () => {
    expect(specIssues('X', [], '')).toHaveLength(2);
  });

  it('is case-insensitive when comparing DoD to the title', () => {
    expect(specIssues('Add Slugify', ['GIVEN … THEN …'], '  add slugify  ').some(i => /definition of done/.test(i))).toBe(true);
  });
});
