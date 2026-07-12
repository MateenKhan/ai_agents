// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../Toast';
import { ConfirmProvider } from '../ConfirmProvider';

// StudioNavbar and ProjectBar both read the same projectContext module (StudioNavbar via
// ../../pages/tasks/projectContext, ProjectBar via ../../projectContext — both resolve to the
// one projectContext file). Mocking it once covers both.
vi.mock('../../projectContext', () => ({
  useProjects: () => ({
    projects: [{ id: 'default', name: 'Default' }],
    activeId: 'default',
    loading: false,
    setActiveId: vi.fn(),
    refreshProjects: vi.fn(),
    createProject: vi.fn(),
    updateProject: vi.fn(),
    deleteProject: vi.fn(),
  }),
}));

// StudioNavbar polls GET /system-status for its health dot — stub fetch so it never hits network.
vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })) as any);

import { StudioNavbar } from '../../../../components/navigation/StudioNavbar';
import { ProjectBar } from '../ProjectBar';

afterEach(cleanup);

// The two header rows exactly as /tasks stacks them (TasksPage renders StudioNavbar then ProjectBar).
const renderTasksHeader = () => render(
  <MemoryRouter initialEntries={['/tasks']}>
    <ToastProvider>
      <ConfirmProvider>
        <StudioNavbar />
        <ProjectBar />
      </ConfirmProvider>
    </ToastProvider>
  </MemoryRouter>,
);

describe('/tasks header — one set of studio nav links (Bug 1)', () => {
  it('renders exactly one link to each studio destination', () => {
    const { container } = renderTasksHeader();
    // StudioNavbar owns cross-studio nav; ProjectBar must not duplicate /canvas or /designer.
    expect(container.querySelectorAll('a[href="/canvas"]')).toHaveLength(1);
    expect(container.querySelectorAll('a[href="/designer"]')).toHaveLength(1);
    expect(container.querySelectorAll('a[href="/tasks"]')).toHaveLength(1);
    expect(container.querySelectorAll('a[href="/ide"]')).toHaveLength(1);
  });

  it('renders the Piranha brand mark exactly once (StudioNavbar owns it)', () => {
    const { container } = renderTasksHeader();
    // The brand svg carries the teeth mark; ProjectBar no longer renders a second copy.
    const brandLinks = Array.from(container.querySelectorAll('a[href="/features"]'));
    expect(brandLinks).toHaveLength(0); // ProjectBar's old brand link is gone
    // Exactly one "Piranha" wordmark remains, in StudioNavbar.
    const wordmarks = Array.from(container.querySelectorAll('span, h1')).filter(
      (el) => el.textContent === 'Piranha',
    );
    expect(wordmarks).toHaveLength(1);
  });

  it('ProjectBar no longer renders the legacy "Studio" self-link', () => {
    const { container } = renderTasksHeader();
    expect(container.querySelector('[data-feature-id="tasks-open-designer"]')).toBeNull();
  });
});
