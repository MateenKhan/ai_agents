// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { ToastProvider, useToast } from '../components/Toast';

/**
 * The live-region contract.
 *
 * Toasts are the only channel that tells a user an agent edited or merged their repo, so
 * announcement is a safety property, not polish. The rule screen readers enforce: a live
 * region must EXIST BEFORE its content changes. A node that arrives already carrying
 * aria-live is not reliably announced — the reader subscribed to regions at parse time.
 *
 * These tests pin the two things that are easy to silently regress:
 *   1. both regions are in the DOM when zero toasts exist;
 *   2. a toast lands INSIDE the region matching its urgency.
 *
 * They cannot prove a screen reader speaks. That needs a real AT pass.
 *
 * (Plain DOM assertions — this repo has no jest-dom matchers, and four tests do not
 * justify a new dev dependency.)
 */

afterEach(cleanup);

function Fire({ onApi }: { onApi: (api: ReturnType<typeof useToast>) => void }) {
  onApi(useToast());
  return null;
}

const renderToasts = () => {
  let api!: ReturnType<typeof useToast>;
  render(<ToastProvider><Fire onApi={a => { api = a; }} /></ToastProvider>);
  return () => api;
};

describe('ToastProvider live regions', () => {
  it('renders both live regions before any toast exists', () => {
    renderToasts();
    // Present, empty, subscribed. This is the whole point.
    const assertive = screen.getByRole('alert');
    const polite = screen.getByRole('status');
    expect(assertive.getAttribute('aria-live')).toBe('assertive');
    expect(polite.getAttribute('aria-live')).toBe('polite');
    expect(assertive.textContent).toBe('');
    expect(polite.textContent).toBe('');
  });

  it('overrides the implicit aria-atomic of role=alert/status', () => {
    renderToasts();
    // role=alert and role=status both imply aria-atomic=true. Left implicit, adding one
    // toast would re-announce every toast still on screen.
    expect(screen.getByRole('alert').getAttribute('aria-atomic')).toBe('false');
    expect(screen.getByRole('status').getAttribute('aria-atomic')).toBe('false');
  });

  it('routes an error into the assertive region and success into the polite one', () => {
    const api = renderToasts();
    act(() => { api().error('Merge failed', 'conflict in db/server.ts'); });
    act(() => { api().success('Task merged', 'PIR-14'); });

    const assertive = screen.getByRole('alert');
    const polite = screen.getByRole('status');

    expect(assertive.textContent).toContain('Merge failed');
    expect(assertive.textContent).not.toContain('Task merged');

    expect(polite.textContent).toContain('Task merged');
    expect(polite.textContent).not.toContain('Merge failed');
  });

  it('does not put aria-live or a role on the toast row itself', () => {
    const api = renderToasts();
    act(() => { api().info('Indexing', 'piranha'); });
    const row = document.querySelector('[data-feature-id="toast"]')!;
    expect(row.hasAttribute('aria-live')).toBe(false);
    expect(row.hasAttribute('role')).toBe(false);
    // The row stays atomic so it is read as one unit, not word by word.
    expect(row.getAttribute('aria-atomic')).toBe('true');
  });
});
