// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent, within } from '@testing-library/react';
import { FileBrowser } from '../FileBrowser';
import { FileChat, ChatStoreProvider } from '../FileChat';
import { ToastProvider } from '../Toast';
import { ConfirmProvider } from '../ConfirmProvider';

/**
 * FileBrowser is the ONE reusable code-file component (Context tab + Git modal). These pin the
 * UI contract the backend agent builds against, all offline: the tree comes from a mocked
 * `GET /files`, and the chat's per-thread isolation / drag-to-tag / long-message accordion are
 * exercised without the AI endpoint. No live db-server needed.
 */

const FILES = ['src/index.ts', 'src/server/port.ts', 'README.md'];

function mockFetch() {
  return vi.fn().mockImplementation((url: string) => {
    if (String(url).includes('/files')) return Promise.resolve({ ok: true, json: async () => ({ files: FILES, isHost: false }) } as Response);
    if (String(url).includes('/file?path=')) return Promise.resolve({ ok: true, json: async () => ({ path: 'src/server/port.ts', content: 'const PORT = 3000;', bytes: 18, tokens: 6, truncated: false }) } as Response);
    return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
  });
}

function wrap(ui: React.ReactNode) {
  return <ToastProvider><ConfirmProvider>{ui}</ConfirmProvider></ToastProvider>;
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });
beforeEach(() => { vi.stubGlobal('fetch', mockFetch()); });

describe('FileBrowser — files', () => {
  it('renders the repo tree from GET /files and opens a file into the viewer', async () => {
    render(wrap(<FileBrowser activeId="p1" enableChat={false} />));
    await screen.findByText('README.md');
    // nested files hide under collapsed dirs; the search box filters + auto-expands.
    fireEvent.change(screen.getByPlaceholderText(/find file/i), { target: { value: 'port' } });
    fireEvent.click(await screen.findByText('port.ts'));
    await screen.findByText('const PORT = 3000;');
  });

  it('has Files and Chat tabs; switching to Chat shows the empty-thread prompt', async () => {
    render(wrap(<FileBrowser activeId="p1" />));
    await screen.findByText('README.md');
    fireEvent.click(screen.getByRole('tab', { name: /chat/i }));
    expect(await screen.findByText(/approve the diff before anything is written/i)).toBeTruthy();
  });
});

describe('FileChat — threads', () => {
  const renderChat = () => render(wrap(<ChatStoreProvider activeId="p1"><FileChat activeId="p1" /></ChatStoreProvider>));

  it('keeps each thread isolated — a new chat does not carry the tags of the old one', async () => {
    renderChat();
    // Tag a file in thread 1 via the repo-file picker.
    fireEvent.click(await screen.findByRole('button', { name: /repo file/i }));
    fireEvent.click(await screen.findByText('src/server/port.ts'));
    await screen.findByText('port.ts'); // chip present

    // New thread → tags gone (own context).
    fireEvent.click(document.querySelector('[data-feature-id="fb-chat-new"]') as Element);
    await waitFor(() => expect(screen.queryByText('port.ts')).toBeNull());
    expect(screen.getByText(/Drag files here/i)).toBeTruthy();
  });

  it('collapses a long user message behind a show-more accordion', async () => {
    renderChat();
    // tag something so send is allowed
    fireEvent.click(await screen.findByRole('button', { name: /repo file/i }));
    fireEvent.click(await screen.findByText('src/server/port.ts'));

    const long = 'x'.repeat(400);
    const input = screen.getByPlaceholderText(/describe the change/i);
    fireEvent.change(input, { target: { value: long } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // the sent message is truncated with a Show more toggle
    const more = await screen.findByRole('button', { name: /show more/i });
    fireEvent.click(more);
    expect(screen.getByRole('button', { name: /show less/i })).toBeTruthy();
  });

  it('refuses to send with no tagged file', async () => {
    renderChat();
    const input = await screen.findByPlaceholderText(/describe the change/i);
    fireEvent.change(input, { target: { value: 'change the port' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    // no assistant/user bubble created — the empty-state prompt is still shown
    expect(screen.getByText(/approve the diff before anything is written/i)).toBeTruthy();
  });
});
