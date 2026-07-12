// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { EventsFeed, ordinal } from '../EventsFeed';

/**
 * EventsFeed — the live pipeline-events table (SPEC.md Release 1 P0 item 7). Same fetch-mock
 * pattern as the ChangesPanel tests: stub global.fetch with a fixed payload, render, and
 * assert on what the table shows. The 5s poll uses real timers and simply never fires within
 * a test's lifetime; unmount cleanup clears it.
 */

const now = Date.now();
const iso = (secondsAgo: number) => new Date(now - secondsAgo * 1000).toISOString();

const EVENTS = {
  ok: true,
  events: [
    {
      id: 'e1', taskId: 'T-1', taskTitle: 'Draw arrow', agent: 'architect',
      message: 'planned (3 scenarios)', type: 'info', ts: iso(30), attempt: 2,
      logPath: '.agent_logs/agent-1.log',
    },
    {
      id: 'e2', taskId: 'T-2', taskTitle: 'Fix login', agent: 'dev',
      message: 'build failed: missing import', type: 'error', ts: iso(120), attempt: 1,
      logPath: null,
    },
    {
      // Deleted task: taskTitle/agent/logPath are all null — row falls back to the raw id
      // and renders no log button.
      id: 'e3', taskId: 'T-GONE', taskTitle: null, agent: null,
      message: 'task record was deleted', type: 'warning', ts: iso(300), attempt: 1,
      logPath: null,
    },
  ],
};

function mockFetch(body: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({ ok, status, json: async () => body } as Response);
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('EventsFeed', () => {
  it('renders one row per event with title, capitalised agent, and ordinal attempt', async () => {
    vi.stubGlobal('fetch', mockFetch(EVENTS));
    render(<EventsFeed />);

    // (a) rows render with title, agent (capitalised in JS, so it's real DOM text), attempt ordinal
    expect(await screen.findByText('Draw arrow')).toBeTruthy();
    expect(screen.getByText('Fix login')).toBeTruthy();
    expect(screen.getByText('Architect')).toBeTruthy();
    expect(screen.getByText('Dev')).toBeTruthy();
    expect(screen.getByText('2nd')).toBeTruthy();
    expect(screen.getAllByText('1st').length).toBe(2);
    // the message text and the shown/total count are visible
    expect(screen.getByText('planned (3 scenarios)')).toBeTruthy();
    expect(screen.getByText('3 of 3 shown')).toBeTruthy();
    // it is a real accessible table with column headers
    expect(screen.getByRole('table')).toBeTruthy();
    for (const col of ['Task', 'Agent', 'Action', 'Link', 'Time', 'Attempt']) {
      expect(screen.getByRole('columnheader', { name: col })).toBeTruthy();
    }
    // the request went to the events endpoint with the project + limit params
    const url = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain('/events?limit=100');
    expect(url).toContain('project=');
  });

  it('falls back to the taskId for deleted tasks and renders no log button for them', async () => {
    vi.stubGlobal('fetch', mockFetch(EVENTS));
    render(<EventsFeed />);

    // (b) the deleted-task row shows the raw id
    expect(await screen.findByText('T-GONE')).toBeTruthy();
    // no log button for it (no logPath and no agent)…
    expect(screen.queryByRole('button', { name: 'Open log for T-GONE' })).toBeNull();
    // …while the rows that have a logPath or an agent do get one
    expect(screen.getByRole('button', { name: 'Open log for Draw arrow' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open log for Fix login' })).toBeTruthy();
  });

  it('filters rows client-side across title, agent, and message', async () => {
    vi.stubGlobal('fetch', mockFetch(EVENTS));
    render(<EventsFeed />);
    await screen.findByText('Draw arrow');

    // (c) typing narrows the rows and the shown/total count follows
    const input = screen.getByRole('textbox', { name: /filter events/i });
    fireEvent.change(input, { target: { value: 'login' } });
    expect(screen.getByText('Fix login')).toBeTruthy();
    expect(screen.queryByText('Draw arrow')).toBeNull();
    expect(screen.getByText('1 of 3 shown')).toBeTruthy();

    // matching on the agent works too (case-insensitive)
    fireEvent.change(input, { target: { value: 'ARCHITECT' } });
    expect(screen.getByText('Draw arrow')).toBeTruthy();
    expect(screen.queryByText('Fix login')).toBeNull();

    // and a no-hit query shows the no-match row, not the global empty state
    fireEvent.change(input, { target: { value: 'zzz-no-such-event' } });
    expect(screen.getByText(/no events match/i)).toBeTruthy();
    expect(screen.getByText('0 of 3 shown')).toBeTruthy();
  });

  it('clicking the log icon calls onOpenLog with (taskId, agent)', async () => {
    vi.stubGlobal('fetch', mockFetch(EVENTS));
    const onOpenLog = vi.fn();
    render(<EventsFeed onOpenLog={onOpenLog} />);
    await screen.findByText('Draw arrow');

    // (d) the icon-only button hands the task + agent to the caller
    fireEvent.click(screen.getByRole('button', { name: 'Open log for Draw arrow' }));
    expect(onOpenLog).toHaveBeenCalledWith('T-1', 'architect');
  });

  it('an empty payload shows the empty state', async () => {
    vi.stubGlobal('fetch', mockFetch({ ok: true, events: [] }));
    render(<EventsFeed />);

    // (e) calm empty state instead of a bare table
    expect(await screen.findByText(/dispatch a task and the feed fills up/i)).toBeTruthy();
    expect(screen.getByText('0 of 0 shown')).toBeTruthy();
  });

  it('a thrown first fetch shows the error state, and Retry recovers', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    render(<EventsFeed />);

    expect(await screen.findByText(/network down/i)).toBeTruthy();
    const retry = screen.getByRole('button', { name: /retry/i });

    vi.stubGlobal('fetch', mockFetch(EVENTS));
    fireEvent.click(retry);
    await waitFor(() => expect(screen.getByText('Draw arrow')).toBeTruthy());
    expect(screen.queryByText(/network down/i)).toBeNull();
  });

  it('ordinal() covers the awkward English cases', () => {
    expect(ordinal(1)).toBe('1st');
    expect(ordinal(2)).toBe('2nd');
    expect(ordinal(3)).toBe('3rd');
    expect(ordinal(4)).toBe('4th');
    expect(ordinal(11)).toBe('11th');
    expect(ordinal(12)).toBe('12th');
    expect(ordinal(13)).toBe('13th');
    expect(ordinal(21)).toBe('21st');
    expect(ordinal(22)).toBe('22nd');
    expect(ordinal(103)).toBe('103rd');
  });
});
