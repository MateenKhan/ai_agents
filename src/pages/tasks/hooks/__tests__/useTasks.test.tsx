// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor, cleanup } from '@testing-library/react';
import { useTasks } from '../useTasks';
import { API_BASE } from '../../../../apiBase';

// Wire-level regression lock for manual task creation: the tabbed New-task
// modal hands its payload to onSave → createTask, and createTask must keep
// POSTing that payload verbatim to /tasks. If this breaks, the Manual tab
// silently changed what it sends the server.
describe('useTasks.createTask', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    // Default: every call (initial fetch, refetch after create) returns an empty board.
    fetchMock.mockResolvedValue({ ok: true, json: async () => [] });
    (globalThis as any).fetch = fetchMock;
  });
  afterEach(cleanup);

  it('POSTs the task payload verbatim to /tasks scoped to the given project', async () => {
    const { result, unmount } = renderHook(() => useTasks('default'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    fetchMock.mockClear();

    const payload = {
      id: 'NEW-ABC123',
      title: 'Ship the widget',
      description: 'Some context',
      dod: '- pnpm test passes',
      status: 'WORKING' as const,
      priority: 1,
      dependsOn: ['T-1', 'T-2'],
      files: ['src/a.ts', 'src/b.ts'],
      parentId: 'ROOT-9',
    };
    await act(async () => { await result.current.createTask(payload, 'p2'); });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API_BASE}/tasks?project=p2`);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    // Byte-for-byte: the body is exactly the serialized payload, nothing added or dropped.
    expect(init.body).toBe(JSON.stringify(payload));

    // A successful create refetches the board.
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(fetchMock.mock.calls[1][0]).toContain(`${API_BASE}/tasks?`);

    unmount();
  });

  it('surfaces a failed create as an error and rethrows', async () => {
    const { result, unmount } = renderHook(() => useTasks('default'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({}) });

    await expect(
      act(async () => { await result.current.createTask({ title: 'nope' }, 'default'); }),
    ).rejects.toThrow('Failed to create task');

    unmount();
  });
});
