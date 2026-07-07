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
