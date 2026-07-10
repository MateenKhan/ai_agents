// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react';

// Strip framer-motion's animation layer so enter/exit is synchronous and
// removal assertions are deterministic (no exit-animation hold in jsdom).
vi.mock('framer-motion', () => {
  const FRAMER_PROPS = new Set(['initial', 'animate', 'exit', 'transition', 'layout', 'whileHover', 'whileTap', 'variants', 'custom']);
  const strip = (props: Record<string, any>) => Object.fromEntries(Object.entries(props).filter(([k]) => !FRAMER_PROPS.has(k)));
  const motion = new Proxy({}, {
    get: (_t, tag: string) => ({ children, ...props }: any) => React.createElement(tag, strip(props), children),
  });
  return { motion, AnimatePresence: ({ children }: any) => React.createElement(React.Fragment, null, children) };
});

import { ToastProvider, useToast } from '../Toast';

afterEach(cleanup);

/** Harness exposing one button per toast kind. */
function Harness() {
  const toast = useToast();
  return (
    <div>
      <button onClick={() => toast.success('Saved', 'Token added')}>ok</button>
      <button onClick={() => toast.error('Failed', 'Network down')}>err</button>
    </div>
  );
}

function mount() {
  render(
    <ToastProvider>
      <Harness />
    </ToastProvider>,
  );
}

/** Mount with direct access to the toast API, for cases a button click can't express. */
function mountApi() {
  let api!: ReturnType<typeof useToast>;
  const Grab = () => { api = useToast(); return null; };
  render(<ToastProvider><Grab /></ToastProvider>);
  return () => api;
}

describe('ToastProvider / useToast', () => {
  it('shows a success toast with title and message', () => {
    mount();
    fireEvent.click(screen.getByText('ok'));
    expect(screen.getByText('Saved')).toBeTruthy();
    expect(screen.getByText('Token added')).toBeTruthy();
  });

  it('shows an error toast', () => {
    mount();
    fireEvent.click(screen.getByText('err'));
    expect(screen.getByText('Failed')).toBeTruthy();
    expect(screen.getByText('Network down')).toBeTruthy();
  });

  it('stacks multiple toasts at once', () => {
    mount();
    fireEvent.click(screen.getByText('ok'));
    fireEvent.click(screen.getByText('err'));
    expect(screen.getByText('Saved')).toBeTruthy();
    expect(screen.getByText('Failed')).toBeTruthy();
  });

  it('removes a toast when its dismiss button is clicked', async () => {
    mount();
    fireEvent.click(screen.getByText('ok'));
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    await waitFor(() => expect(screen.queryByText('Saved')).toBeNull());
  });

  it('auto-dismisses after the timeout', async () => {
    vi.useFakeTimers();
    try {
      mount();
      fireEvent.click(screen.getByText('ok'));
      expect(screen.getByText('Saved')).toBeTruthy();
      act(() => { vi.advanceTimersByTime(5000); });
      expect(screen.queryByText('Saved')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * The live-region contract.
 *
 * Toasts are the only channel that tells a user an agent edited or merged their repo, so
 * announcement is a safety property, not polish. The rule screen readers enforce: a live
 * region must EXIST BEFORE its content changes. A node that arrives already carrying
 * aria-live is not reliably announced — the reader subscribed to regions at parse time.
 *
 * These tests pin structure only. They CANNOT prove a screen reader speaks; that still
 * needs a real assistive-technology pass.
 *
 * (Plain DOM assertions — this repo has no jest-dom matchers, and these do not justify a
 * new dev dependency.)
 */
describe('ToastProvider live regions', () => {
  it('renders both live regions before any toast exists', () => {
    mountApi();
    // Present, empty, subscribed. This is the whole point.
    const assertive = screen.getByRole('alert');
    const polite = screen.getByRole('status');
    expect(assertive.getAttribute('aria-live')).toBe('assertive');
    expect(polite.getAttribute('aria-live')).toBe('polite');
    expect(assertive.textContent).toBe('');
    expect(polite.textContent).toBe('');
  });

  it('overrides the implicit aria-atomic of role=alert/status', () => {
    mountApi();
    // role=alert and role=status both imply aria-atomic=true. Left implicit, one new toast
    // re-announces every toast still on screen — a merge failure buried under four successes.
    expect(screen.getByRole('alert').getAttribute('aria-atomic')).toBe('false');
    expect(screen.getByRole('status').getAttribute('aria-atomic')).toBe('false');
  });

  it('routes an error into the assertive region and success into the polite one', () => {
    const api = mountApi();
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
    const api = mountApi();
    act(() => { api().info('Indexing', 'piranha'); });
    const row = document.querySelector('[data-feature-id="toast"]')!;
    expect(row.hasAttribute('aria-live')).toBe(false);
    expect(row.hasAttribute('role')).toBe(false);
    // The row stays atomic so it is read as one unit, not word by word.
    expect(row.getAttribute('aria-atomic')).toBe('true');
  });
});
