// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, cleanup, waitFor } from '@testing-library/react';
import { LimitBanner } from '../LimitBanner';

/**
 * The plan-limit banner must NEVER false-alarm: null, past, malformed, and failed fetches
 * all render nothing. Only a well-formed future `limitPausedUntil` shows the amber banner
 * with the local resume time. Same fetch-mock pattern as ChangesPanelStates.test.tsx.
 */

function statusFetch(limitPausedUntil: string | null) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ limitPausedUntil }),
  } as Response);
}

const BANNER = '[data-feature-id="limit-banner"]';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('LimitBanner', () => {
  it('renders nothing when limitPausedUntil is null', async () => {
    const fetchMock = statusFetch(null);
    vi.stubGlobal('fetch', fetchMock);
    const { container } = render(<LimitBanner />);
    // wait for the mount poll to settle before asserting absence
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(container.querySelector(BANNER)).toBeNull();
  });

  it('shows the banner with the resume HH:MM for a future timestamp', async () => {
    const future = new Date(Date.now() + 32 * 60_000);
    vi.stubGlobal('fetch', statusFetch(future.toISOString()));
    render(<LimitBanner />);

    const banner = await screen.findByRole('status');
    expect(banner.getAttribute('data-feature-id')).toBe('limit-banner');

    // computed with the same options the component uses, so the assertion is locale-proof
    const hhmm = future.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    expect(banner.textContent).toContain(`Plan limit reached · swarm resumes ${hhmm}`);
    expect(banner.textContent).toMatch(/\(in \d+ min\)/);

    // announce once: stable label carries the resume time; the countdown is aria-hidden
    expect(banner.getAttribute('aria-live')).toBe('polite');
    expect(banner.getAttribute('aria-label')).toContain(hhmm);
  });

  it('renders nothing for a past timestamp', async () => {
    const fetchMock = statusFetch(new Date(Date.now() - 60_000).toISOString());
    vi.stubGlobal('fetch', fetchMock);
    const { container } = render(<LimitBanner />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(container.querySelector(BANNER)).toBeNull();
  });

  it('renders nothing when the fetch rejects', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);
    const { container } = render(<LimitBanner />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(container.querySelector(BANNER)).toBeNull();
  });

  it('ticks to "resuming…" when the deadline passes, then clears after the next poll', async () => {
    vi.useFakeTimers();
    // Deadline 15 s out: the t=10 s poll still sees a future value, the deadline passes at
    // t=15 s while mounted, and the t=20 s poll sees it as past and clears the banner.
    const until = new Date(Date.now() + 15_000).toISOString();
    vi.stubGlobal('fetch', statusFetch(until));
    const { container } = render(<LimitBanner />);

    // settle the mount fetch (microtasks only — no timer needs to fire yet)
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(container.querySelector(BANNER)?.textContent).toMatch(/\(in \d+ sec\)/);

    // cross the deadline between polls → the countdown holds at "resuming…"
    await act(async () => { await vi.advanceTimersByTimeAsync(16_000); });
    expect(container.querySelector(BANNER)?.textContent).toContain('resuming…');

    // the t=20 s poll returns the now-past timestamp → the banner unmounts
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(container.querySelector(BANNER)).toBeNull();
  });
});
