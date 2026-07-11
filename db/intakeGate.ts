// Intake quality gate — the check that a decomposed task is specified well enough for agents to
// build and for the pipeline to judge "done". Kept in its own module (not inline in server.ts)
// so it is unit-testable without booting the HTTP server.

/** What a decomposed task is MISSING before agents should run it. A task with no acceptance
 *  scenarios, or no verifiable definition of done (empty, or just the title echoed back, or a
 *  bare fragment), is not something the pipeline can judge "done" against — so it is created but
 *  held for a human to refine, never auto-dispatched. Returns the problems; empty when good. */
export function specIssues(title: string, scenarios: string[], dod: string): string[] {
  const issues: string[] = [];
  if (!scenarios.length) issues.push('no acceptance scenarios (GIVEN/WHEN/THEN)');
  const d = (dod || '').trim();
  if (!d || d.toLowerCase() === (title || '').trim().toLowerCase() || d.length < 12) {
    issues.push('no verifiable definition of done');
  }
  return issues;
}
