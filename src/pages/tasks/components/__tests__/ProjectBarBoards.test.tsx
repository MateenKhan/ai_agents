// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../Toast';
import { ConfirmProvider } from '../ConfirmProvider';

// ProjectBar fires toasts (delete feedback), opens a typed confirm before deleting a project,
// and its brand mark is a <Link> to /features — which throws without a router in context.
// Render through this, never bare.
const renderBar = () => render(
  <MemoryRouter>
    <ToastProvider>
      <ConfirmProvider>
        <ProjectBar />
      </ConfirmProvider>
    </ToastProvider>
  </MemoryRouter>,
);

// Mock the projects context so the bar renders without any network/fetch.
vi.mock('../../projectContext', () => ({
  useProjects: () => ({
    projects: [{ id: 'default', name: 'Default' }],
    activeId: 'default',
    loading: false,
    setActiveId: vi.fn(),
    refreshProjects: vi.fn(),
    createProject: vi.fn(),
    updateProject: vi.fn(),
    deleteProject: vi.fn(),
  }),
}));

import { ProjectBar } from '../ProjectBar';
import { BOARD_COLUMNS_EVENT } from '../../boardConfig';

afterEach(cleanup);
beforeEach(() => localStorage.clear());

const KEY = 'board.columns:default';
const stored = () => JSON.parse(localStorage.getItem(KEY) || 'null');

function openEditWithBoards(container: HTMLElement) {
  // Projects switcher is a collapsed accordion by default — expand it to reach the edit pencil.
  fireEvent.click(container.querySelector('[data-feature-id="projects-accordion-toggle"]') as HTMLElement);
  fireEvent.click(screen.getByLabelText('Edit Default'));
  fireEvent.click(container.querySelector('[data-feature-id="project-edit-boards-toggle"]') as HTMLElement);
}

describe('ProjectBar — Boards accordion', () => {
  it('opens the project editor and shows the shared lane editor with default lanes', () => {
    const { container } = renderBar();
    openEditWithBoards(container);
    expect(screen.getByText('Swimlanes (4)')).toBeTruthy();
    // Board editor default labels are present.
    expect(screen.getByDisplayValue('Todo')).toBeTruthy();
    expect(screen.getByDisplayValue('Done')).toBeTruthy();
  });

  it('editing lanes persists per-project to localStorage and fires the change event', () => {
    const seen: string[] = [];
    const onEvt = (e: Event) => seen.push((e as CustomEvent).detail?.projectId);
    window.addEventListener(BOARD_COLUMNS_EVENT, onEvt);

    const { container } = renderBar();
    openEditWithBoards(container);

    fireEvent.click(screen.getByText('Add Lane'));

    expect(stored()).toHaveLength(5);
    expect(seen).toContain('default');
    // Accordion header reflects the new count live.
    expect(screen.getByText(/5 lanes/)).toBeTruthy();

    window.removeEventListener(BOARD_COLUMNS_EVENT, onEvt);
  });

  it('Reset lanes writes the 4 default lanes back', () => {
    const { container } = renderBar();
    openEditWithBoards(container);
    fireEvent.click(screen.getByText('Add Lane'));
    expect(stored()).toHaveLength(5);
    fireEvent.click(screen.getByText('Reset lanes'));
    expect(stored().map((c: any) => c.id)).toEqual(['TODO', 'AVAILABLE', 'WORKING', 'DONE']);
  });
});
