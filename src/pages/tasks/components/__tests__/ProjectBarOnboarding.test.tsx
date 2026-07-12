// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../Toast';
import { ConfirmProvider } from '../ConfirmProvider';

// A mutable projects holder so each test can swap what useProjects() returns without
// re-mocking the module (vi.mock is hoisted once per file).
const state = vi.hoisted(() => ({ projects: [] as Array<Record<string, unknown>> }));

vi.mock('../../projectContext', () => ({
  useProjects: () => ({
    projects: state.projects,
    activeId: 'default',
    loading: false,
    setActiveId: vi.fn(),
    refreshProjects: vi.fn(),
    createProject: vi.fn(),
    updateProject: vi.fn(),
    deleteProject: vi.fn(),
  }),
}));

import { ProjectBar } from '../ProjectBar';

const renderBar = () => render(
  <MemoryRouter>
    <ToastProvider>
      <ConfirmProvider>
        <ProjectBar />
      </ConfirmProvider>
    </ToastProvider>
  </MemoryRouter>,
);

afterEach(cleanup);
beforeEach(() => localStorage.clear());

describe('ProjectBar — first-run onboarding banner (Bug 2)', () => {
  it('shows the import hint on a truly fresh install (only Default, no repo)', () => {
    state.projects = [{ id: 'default', name: 'Default' }];
    renderBar();
    expect(screen.getByText(/Import your first git repo/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Import project/i })).toBeTruthy();
  });

  it('HIDES the hint once the Default project carries a repoPath (local import renamed it in place)', () => {
    // The local-path import renames Default in place, keeping id==='default'. The old id-only
    // guard would keep nagging; the repoPath guard correctly treats this as configured.
    state.projects = [{ id: 'default', name: 'remote_manufacturing', repoPath: 'C:\\code\\remote_manufacturing' }];
    renderBar();
    expect(screen.queryByText(/Import your first git repo/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /Import project/i })).toBeNull();
  });

  it('HIDES the hint when a second real project exists', () => {
    state.projects = [{ id: 'default', name: 'Default' }, { id: 'p-real', name: 'web' }];
    renderBar();
    expect(screen.queryByText(/Import your first git repo/i)).toBeNull();
  });
});
