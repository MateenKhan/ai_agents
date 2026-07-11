// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { LogConsole } from '../LogConsole';

/**
 * Fullscreen is the toolbar affordance that rescues a cramped max-h-64 log in a modal. It
 * portals to <body> so the overlay escapes the modal's clipping, and Esc leaves it.
 */

afterEach(cleanup);

const LINES = ['[vite] Compiling serde v1.0.228', '[vite] Compiling syn v2.0.117'];

describe('LogConsole fullscreen', () => {
  it('offers a full-screen button only when fullscreenable is set', () => {
    const { rerender } = render(<LogConsole lines={LINES} copyable />);
    expect(screen.queryByRole('button', { name: /full screen/i })).toBeNull();
    rerender(<LogConsole lines={LINES} copyable fullscreenable />);
    expect(screen.getByRole('button', { name: /full screen/i })).toBeTruthy();
  });

  it('opens a portalled overlay and closes it with Esc', async () => {
    render(<LogConsole lines={LINES} fullscreenable />);
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /^full screen$/i }));
    const overlay = await screen.findByRole('dialog');
    expect(overlay.getAttribute('aria-modal')).toBe('true');
    // the log content is inside the overlay
    expect(overlay.textContent).toContain('Compiling serde');

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
