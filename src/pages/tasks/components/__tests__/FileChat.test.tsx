// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { FileChat, ChatStoreProvider } from '../FileChat';
import { ToastProvider } from '../Toast';
import { ConfirmProvider } from '../ConfirmProvider';

/**
 * Pins the per-reply telemetry caption (docs/plans/ai-chat-metrics-ui.md). The chat reads the
 * new `metrics` object off the `/file/ai-edit` response and shows a small, muted line under the
 * assistant bubble. The endpoint is mocked — no live db-server / model call. The caption must:
 *   - show tps + responseSec + output size when metrics are present,
 *   - render nothing (and not crash) when metrics are absent,
 *   - render nothing when the reply is thin (0 output / 0 tps) rather than "0 tok/s".
 */

const FILES = ['src/index.ts', 'src/server/port.ts', 'README.md'];

const FULL_METRICS = {
  responseMs: 5260, responseSec: 5.26, ttftMs: 3200,
  outputTokens: 283, inputTokens: 9, tps: 53.8, costUsd: 0.0239,
};

function mockFetch(aiEdit: Record<string, unknown>) {
  return vi.fn().mockImplementation((url: string) => {
    if (String(url).includes('/file/ai-edit')) return Promise.resolve({ ok: true, json: async () => aiEdit } as Response);
    if (String(url).includes('/files')) return Promise.resolve({ ok: true, json: async () => ({ files: FILES, isHost: false }) } as Response);
    return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
  });
}

function wrap(ui: React.ReactNode) {
  return <ToastProvider><ConfirmProvider>{ui}</ConfirmProvider></ToastProvider>;
}

const renderChat = () => render(wrap(<ChatStoreProvider activeId="p1"><FileChat activeId="p1" /></ChatStoreProvider>));

// Tag a repo file so send() is allowed, then send the instruction.
async function sendMessage(text = 'change the port') {
  fireEvent.click(await screen.findByRole('button', { name: /repo file/i }));
  fireEvent.click(await screen.findByText('src/server/port.ts'));
  const input = screen.getByPlaceholderText(/describe the change/i);
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

const metricsEl = () => document.querySelector('[data-feature-id="fb-chat-metrics"]');

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

describe('FileChat — response metrics caption', () => {
  it('shows tps · response time · output size when the reply carries metrics', async () => {
    vi.stubGlobal('fetch', mockFetch({ answer: 'Done.', sessionId: 's1', proposals: [], metrics: FULL_METRICS }));
    renderChat();
    await sendMessage();

    await screen.findByText('Done.');
    const line = await waitFor(() => { const el = metricsEl(); expect(el).not.toBeNull(); return el!; });
    // authoritative tps is displayed (reformatted, not recomputed), with response time and size.
    expect(line.textContent).toContain('53.8 tok/s');
    expect(line.textContent).toContain('5.26s');
    expect(line.textContent).toContain('283 tokens');
  });

  it('renders no caption — and does not crash — when the response has no metrics', async () => {
    vi.stubGlobal('fetch', mockFetch({ answer: 'Older-style reply.', sessionId: 's1', proposals: [] }));
    renderChat();
    await sendMessage();

    await screen.findByText('Older-style reply.');
    // the answer renders; the metrics line does not.
    expect(metricsEl()).toBeNull();
  });

  it('hides the caption on a thin reply (0 output / 0 tps) rather than showing "0 tok/s"', async () => {
    vi.stubGlobal('fetch', mockFetch({
      answer: 'Nothing to change.', sessionId: 's1', proposals: [],
      metrics: { ...FULL_METRICS, outputTokens: 0, tps: 0 },
    }));
    renderChat();
    await sendMessage();

    await screen.findByText('Nothing to change.');
    expect(metricsEl()).toBeNull();
    expect(screen.queryByText(/0 tok\/s/)).toBeNull();
  });
});
