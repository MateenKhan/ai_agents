import { useCallback, useState } from 'react';

/** localStorage flag: the first-run setup was completed (or explicitly skipped). */
export const SETUP_DONE_KEY = 'piranha:setup-done';

/** The slice of a project the gate needs — keeps the hook decoupled from projectContext. */
export interface GateProject { id: string }

export interface SetupGateInput {
  /** True while the project list is still loading — never flash setup over a loading board. */
  projectsLoading: boolean;
  /** True while the task list is still loading. */
  tasksLoading: boolean;
  projects: GateProject[];
  taskCount: number;
}

/**
 * First-run setup gate. The starting screen shows exactly when ALL of these hold:
 *   - the `piranha:setup-done` flag has never been written (completed OR skipped),
 *   - both the projects and tasks polls have settled (no flash-of-setup during load),
 *   - no project beyond the seeded 'default' exists,
 *   - the board has zero tasks.
 * Once `complete()` runs (the screen writes the flag itself), the gate never re-opens —
 * including on installs where localStorage is unavailable (private mode falls back to done,
 * because a setup screen that reappears every launch is worse than none).
 */
export function useSetupGate({ projectsLoading, tasksLoading, projects, taskCount }: SetupGateInput) {
  const [setupDone, setSetupDone] = useState<boolean>(() => {
    try { return localStorage.getItem(SETUP_DONE_KEY) === '1'; } catch { return true; }
  });
  const needsSetup = !setupDone && !projectsLoading && !tasksLoading
    && !projects.some(p => p.id !== 'default') && taskCount === 0;
  const complete = useCallback(() => setSetupDone(true), []);
  return { needsSetup, complete };
}
