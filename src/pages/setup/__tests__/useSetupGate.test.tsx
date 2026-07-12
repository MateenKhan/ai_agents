// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useSetupGate, SETUP_DONE_KEY } from '../useSetupGate';

// A fresh install: polls settled, only the seeded default project, empty board, no flag.
const fresh = {
  projectsLoading: false,
  tasksLoading: false,
  projects: [{ id: 'default' }],
  taskCount: 0,
};

beforeEach(() => localStorage.clear());

describe('useSetupGate', () => {
  it('opens on a fresh install (unconfigured, no tasks, no flag)', () => {
    const { result } = renderHook(() => useSetupGate(fresh));
    expect(result.current.needsSetup).toBe(true);
  });

  it('stays hidden when the setup-done flag is set', () => {
    localStorage.setItem(SETUP_DONE_KEY, '1');
    const { result } = renderHook(() => useSetupGate(fresh));
    expect(result.current.needsSetup).toBe(false);
  });

  it('stays hidden while the projects or tasks polls are still loading', () => {
    const p = renderHook(() => useSetupGate({ ...fresh, projectsLoading: true }));
    expect(p.result.current.needsSetup).toBe(false);
    const t = renderHook(() => useSetupGate({ ...fresh, tasksLoading: true }));
    expect(t.result.current.needsSetup).toBe(false);
  });

  it('stays hidden when a project beyond the default exists', () => {
    const { result } = renderHook(() =>
      useSetupGate({ ...fresh, projects: [{ id: 'default' }, { id: 'p-real' }] }));
    expect(result.current.needsSetup).toBe(false);
  });

  it('stays hidden when the board already has tasks', () => {
    const { result } = renderHook(() => useSetupGate({ ...fresh, taskCount: 3 }));
    expect(result.current.needsSetup).toBe(false);
  });

  it('complete() closes the gate for the rest of the session', () => {
    const { result } = renderHook(() => useSetupGate(fresh));
    expect(result.current.needsSetup).toBe(true);
    act(() => result.current.complete());
    expect(result.current.needsSetup).toBe(false);
  });
});
