// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { StudioNavbar } from '../StudioNavbar';
import { ProjectProvider } from '../../../pages/tasks/projectContext';

/**
 * The universal studio navbar: four tabs whose active state follows the route
 * (NavLink → aria-current="page"), and a live backend health dot fed by the same
 * /system-status poll the rest of the app uses. Fetch-mock pattern follows
 * LimitBanner.test.tsx.
 */

const HEALTH = '[data-feature-id="studio-health"]';

// One stub serves both consumers of global fetch: the ProjectProvider's /projects
// load and the navbar's /system-status health poll.
function stubFetch({ healthy }: { healthy: boolean }) {
  const fn = vi.fn().mockImplementation(async (url: unknown) => {
    const u = String(url);
    if (u.includes('/system-status')) {
      if (!healthy) throw new Error('db-server unreachable');
      return { ok: true, status: 200, json: async () => ({ orchestrator: { up: true } }) } as Response;
    }
    if (u.includes('/projects')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ projects: [{ id: 'default', name: 'remote_manufacturing', emoji: '🏭' }] }),
      } as Response;
    }
    return { ok: true, status: 200, json: async () => ({}) } as Response;
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

function renderAt(path: string) {
  return render(
    <ProjectProvider>
      <MemoryRouter initialEntries={[path]}>
        <StudioNavbar />
      </MemoryRouter>
    </ProjectProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('StudioNavbar', () => {
  it('renders all four studio tabs pointing at their routes', async () => {
    const fetchMock = stubFetch({ healthy: true });
    renderAt('/tasks');

    const expectHref = (name: RegExp, href: string) => {
      const link = screen.getByRole('link', { name });
      expect(link.getAttribute('href')).toBe(href);
    };
    expectHref(/swarm board/i, '/tasks');
    expectHref(/architecture canvas/i, '/canvas');
    expectHref(/visual react studio/i, '/designer');
    expectHref(/code ide/i, '/ide');

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  });

  it('marks the tab for the current route with aria-current="page"', async () => {
    stubFetch({ healthy: true });
    renderAt('/designer');

    expect(screen.getByRole('link', { name: /visual react studio/i }).getAttribute('aria-current')).toBe('page');
    for (const name of [/swarm board/i, /architecture canvas/i, /code ide/i]) {
      expect(screen.getByRole('link', { name }).getAttribute('aria-current')).toBeNull();
    }
  });

  it('keeps Swarm Board active on nested /tasks routes (no `end` matching)', async () => {
    stubFetch({ healthy: true });
    renderAt('/tasks/analytics');
    expect(screen.getByRole('link', { name: /swarm board/i }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: /code ide/i }).getAttribute('aria-current')).toBeNull();
  });

  it('shows the health dot UP when /system-status answers', async () => {
    const fetchMock = stubFetch({ healthy: true });
    const { container } = renderAt('/tasks');

    await waitFor(() => expect(container.querySelector(HEALTH)?.textContent).toContain('API: UP'));
    // the poll goes through the shared util → project-scoped /system-status URL
    const urls = fetchMock.mock.calls.map(c => String(c[0]));
    expect(urls.some(u => u.includes('/system-status?project='))).toBe(true);
  });

  it('shows the health dot DOWN when the poll rejects', async () => {
    stubFetch({ healthy: false });
    const { container } = renderAt('/tasks');
    await waitFor(() => expect(container.querySelector(HEALTH)?.textContent).toContain('API: DOWN'));
  });

  it('renders the active project badge from the project context', async () => {
    stubFetch({ healthy: true });
    const { container } = renderAt('/canvas');
    await waitFor(() =>
      expect(container.querySelector('[data-feature-id="studio-project-badge"]')?.textContent).toContain('remote_manufacturing'),
    );
  });
});
