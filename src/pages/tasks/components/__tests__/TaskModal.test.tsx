// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { TaskModal } from '../TaskModal';
import type { Task } from '../../types';
import { API_BASE } from '../../../../apiBase';

// The modal reads the project list + active project from context; pin both so
// payload assertions ("projectId: 'default'") are deterministic.
vi.mock('../../projectContext', () => ({
  useProjects: () => ({
    projects: [
      { id: 'default', name: 'Default' },
      { id: 'p2', name: 'Second' },
    ],
    activeId: 'default',
  }),
}));

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  (globalThis as any).fetch = fetchMock;
});
afterEach(cleanup);

function openModal(props: Partial<React.ComponentProps<typeof TaskModal>> = {}) {
  const onClose = vi.fn();
  const onSave = vi.fn();
  const onCreated = vi.fn();
  render(
    <TaskModal isOpen onClose={onClose} onSave={onSave} onCreated={onCreated} {...props} />,
  );
  return { onClose, onSave, onCreated };
}

// ── Field lookups (manual tab) ────────────────────────────────────────────────
const titleInput = () =>
  screen.getByPlaceholderText('e.g. Add a dark-mode toggle to Settings') as HTMLInputElement;
const descriptionInput = () =>
  screen.getByPlaceholderText(/Context the agent needs/) as HTMLTextAreaElement;
const dodInput = () =>
  document.querySelector('[data-feature-id="task-modal-dod"]') as HTMLTextAreaElement;
const dependsInput = () =>
  screen.getByPlaceholderText('TASK-ID-1, TASK-ID-2') as HTMLInputElement;
const filesInput = () =>
  screen.getByPlaceholderText('src/main.ts, db/schema.sql') as HTMLInputElement;
const parentInput = () =>
  screen.getByPlaceholderText('Leave empty if root task') as HTMLInputElement;

// ── Field lookups (AI tab) ────────────────────────────────────────────────────
const aiTextarea = () =>
  document.querySelector('[data-feature-id="task-modal-ai-message"]') as HTMLTextAreaElement;

const manualTab = () => screen.getByRole('tab', { name: 'Manual' });
const aiTab = () => screen.getByRole('tab', { name: 'From AI' });

/** Queue one successful /intake response. */
function mockIntakeOk(created: Array<{ id: string; title: string; status: string }>) {
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ created }) });
}

describe('TaskModal tabs', () => {
  it('creation shows the Manual and From AI tabs, starting on Manual', () => {
    openModal();
    expect(manualTab().getAttribute('aria-selected')).toBe('true');
    expect(aiTab().getAttribute('aria-selected')).toBe('false');
    expect(titleInput()).toBeTruthy();
  });

  it('honours initialMode="ai" so entry points can land straight on the AI tab', () => {
    openModal({ initialMode: 'ai' });
    expect(aiTab().getAttribute('aria-selected')).toBe('true');
    expect(aiTextarea()).toBeTruthy();
  });

  it('editing an existing task shows no tabs — always the plain manual form', () => {
    const editingTask = {
      id: 'T-1', title: 'Existing', description: 'desc', dod: '- done',
      status: 'TODO', priority: 2, dependsOn: [], files: [],
    } as unknown as Task;
    openModal({ editingTask });
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(titleInput().value).toBe('Existing');
  });

  it('switching tabs preserves each tab\'s entered state', () => {
    openModal();

    fireEvent.change(titleInput(), { target: { value: 'Keep me' } });
    fireEvent.change(dodInput(), { target: { value: '- verified' } });

    fireEvent.click(aiTab());
    expect(screen.queryByPlaceholderText('e.g. Add a dark-mode toggle to Settings')).toBeNull();
    fireEvent.change(aiTextarea(), { target: { value: 'build a widget' } });

    fireEvent.click(manualTab());
    expect(titleInput().value).toBe('Keep me');
    expect(dodInput().value).toBe('- verified');

    fireEvent.click(aiTab());
    expect(aiTextarea().value).toBe('build a widget');
  });

  it('moves focus to the first field of a newly selected tab', () => {
    openModal();
    fireEvent.click(aiTab());
    expect(document.activeElement).toBe(aiTextarea());
    fireEvent.click(manualTab());
    expect(document.activeElement).toBe(titleInput());
  });

  it('Escape still closes the modal (Modal-level shortcut preserved)', () => {
    const { onClose } = openModal();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('TaskModal manual tab', () => {
  it('submit hands onSave the exact legacy payload (regression lock) and never fetches', () => {
    const { onSave, onClose } = openModal();

    fireEvent.change(titleInput(), { target: { value: 'Ship the widget' } });
    fireEvent.change(descriptionInput(), { target: { value: 'Some context' } });
    fireEvent.change(dodInput(), { target: { value: '- pnpm test passes' } });

    // Comboboxes in DOM order: Project, Status, Priority.
    const [projectSel, statusSel, prioritySel] = screen.getAllByRole('combobox');
    fireEvent.change(projectSel, { target: { value: 'p2' } });
    fireEvent.change(statusSel, { target: { value: 'WORKING' } });
    fireEvent.change(prioritySel, { target: { value: '1' } });

    fireEvent.change(dependsInput(), { target: { value: 'T-1, T-2' } });
    fireEvent.change(filesInput(), { target: { value: 'src/a.ts, src/b.ts' } });
    fireEvent.change(parentInput(), { target: { value: 'ROOT-9' } });

    fireEvent.click(screen.getByRole('button', { name: 'Create task' }));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(
      {
        title: 'Ship the widget',
        description: 'Some context',
        dod: '- pnpm test passes',
        status: 'WORKING',
        priority: 1,
        dependsOn: ['T-1', 'T-2'],
        files: ['src/a.ts', 'src/b.ts'],
        parentId: 'ROOT-9',
      },
      'p2',
    );
    expect(onClose).toHaveBeenCalledTimes(1);
    // The manual path goes through onSave (POST /tasks upstream) — the modal
    // itself must not fire any request, /intake included.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('blocks submit without a Definition of Done', () => {
    const { onSave } = openModal();
    fireEvent.change(titleInput(), { target: { value: 'No DoD' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(/Definition of Done is mandatory/)).toBeTruthy();
  });

  it('Ctrl+Enter submits from inside a textarea', () => {
    const { onSave } = openModal();
    fireEvent.change(titleInput(), { target: { value: 'Kbd' } });
    fireEvent.change(dodInput(), { target: { value: '- ok' } });
    fireEvent.keyDown(dodInput(), { key: 'Enter', ctrlKey: true });
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});

describe('TaskModal From AI tab', () => {
  it('submit POSTs /intake with the description only — none of the manual fields', async () => {
    const { onSave, onCreated } = openModal();
    mockIntakeOk([{ id: 'T1', title: 'Widget task', status: 'WORKING' }]);

    fireEvent.click(aiTab());
    fireEvent.change(aiTextarea(), { target: { value: '  build a widget  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create tasks' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API_BASE}/intake`);
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body);
    expect(body).toEqual({ message: 'build a widget', autoStart: true, projectId: 'default' });
    // Regression lock: the AI payload must never grow the manual-form fields.
    expect(Object.keys(body).sort()).toEqual(['autoStart', 'message', 'projectId']);

    expect(onSave).not.toHaveBeenCalled();
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(screen.getByText(/Created 1 task/)).toBeTruthy();
    expect(screen.getByText(/Widget task/)).toBeTruthy();
  });

  it('sends the selected project when the user switches it', async () => {
    openModal();
    mockIntakeOk([]);

    fireEvent.click(aiTab());
    const [projectSel] = screen.getAllByRole('combobox'); // only Project remains on the AI tab
    fireEvent.change(projectSel, { target: { value: 'p2' } });
    fireEvent.change(aiTextarea(), { target: { value: 'do the thing' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create tasks' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).projectId).toBe('p2');
  });

  it('the removed manual-only fields are absent from the AI tab DOM', () => {
    openModal();
    fireEvent.click(aiTab());

    expect(screen.queryByPlaceholderText('e.g. Add a dark-mode toggle to Settings')).toBeNull(); // title
    expect(document.querySelector('[data-feature-id="task-modal-dod"]')).toBeNull();            // DoD
    expect(screen.queryByText('Status')).toBeNull();
    expect(screen.queryByText('Priority')).toBeNull();
    expect(screen.queryByText(/Depends On/)).toBeNull();
    expect(screen.queryByText(/Associated Files/)).toBeNull();
    expect(screen.queryByText('Parent Task ID')).toBeNull();

    // Only the description textarea + project picker remain.
    expect(aiTextarea()).toBeTruthy();
    expect(screen.getAllByRole('combobox')).toHaveLength(1);
  });

  it('Ctrl+Enter submits the AI description', async () => {
    openModal();
    mockIntakeOk([]);
    fireEvent.click(aiTab());
    fireEvent.change(aiTextarea(), { target: { value: 'quick one' } });
    fireEvent.keyDown(aiTextarea(), { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toBe(`${API_BASE}/intake`);
  });

  it('a failed intake surfaces the server error and does not report created tasks', async () => {
    const { onCreated } = openModal();
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'intake exploded' }) });

    fireEvent.click(aiTab());
    fireEvent.change(aiTextarea(), { target: { value: 'break please' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create tasks' }));

    await waitFor(() => expect(screen.getByText('intake exploded')).toBeTruthy());
    expect(onCreated).not.toHaveBeenCalled();
    // The typed description is kept so the user can retry.
    expect(aiTextarea().value).toBe('break please');
  });

  it('does not submit an empty description', () => {
    openModal();
    fireEvent.click(aiTab());
    const btn = screen.getByRole('button', { name: 'Create tasks' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
