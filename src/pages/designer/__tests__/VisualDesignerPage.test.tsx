// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

/**
 * VisualDesignerPage — AI Assistant & Inspector drawer.
 *
 * Pins the three behaviours the drawer promises:
 *   1. The toolbar toggle opens/closes the drawer, and the state persists to localStorage.
 *   2. FileChat is composed as-is: it receives the active project id via its existing
 *      `activeId` prop (FileChat is mocked; its props are captured and asserted).
 *   3. Selection → context bridge: the Sandpack file being viewed is tagged into the chat
 *      store (`useChatStore().tag` — the same contract FileBrowser's drag-to-tag uses), and
 *      the drawer's context banner tracks the active file.
 *
 * Sandpack and FileChat are mocked — no bundler iframe, no backend.
 */

const h = vi.hoisted(() => ({
  tag: vi.fn(),
  fileChatCalls: [] as Array<Record<string, unknown>>,
}));

// Sandpack mock: a provider holding activeFile state, a fake "tab" button to switch files,
// and a useSandpack() that mirrors the real hook's { sandpack: { activeFile } } shape.
vi.mock('@codesandbox/sandpack-react', async () => {
  const React = await import('react');
  const Ctx = React.createContext<{ activeFile: string; setActiveFile: (f: string) => void }>({
    activeFile: '/App.tsx',
    setActiveFile: () => {},
  });
  const SandpackProvider = ({ children }: { children?: React.ReactNode }) => {
    const [activeFile, setActiveFile] = React.useState('/App.tsx');
    return (
      <Ctx.Provider value={{ activeFile, setActiveFile }}>
        <div data-testid="mock-sandpack">
          <button data-testid="mock-open-styles" onClick={() => setActiveFile('/styles.css')}>
            styles.css tab
          </button>
          {children}
        </div>
      </Ctx.Provider>
    );
  };
  const Pass = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  const useSandpack = () => {
    const { activeFile, setActiveFile } = React.useContext(Ctx);
    return { sandpack: { activeFile, setActiveFile } };
  };
  return {
    SandpackProvider,
    SandpackLayout: Pass,
    SandpackCodeEditor: () => <div data-testid="mock-editor" />,
    SandpackPreview: () => <div data-testid="mock-preview" />,
    useSandpack,
  };
});

// StudioNavbar needs Router + ProjectProvider context; it is not under test here.
vi.mock('../../../components/navigation/StudioNavbar', () => ({
  StudioNavbar: () => <div data-testid="mock-studio-navbar" />,
}));

// FileChat mock: capture the props the drawer passes; expose a spy-backed chat store so the
// SelectionContextBridge's tag() calls can be asserted.
vi.mock('../../tasks/components/FileChat', () => ({
  ChatStoreProvider: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="mock-chat-store">{children}</div>
  ),
  FileChat: (props: Record<string, unknown>) => {
    h.fileChatCalls.push(props);
    return <div data-testid="mock-filechat" />;
  },
  useChatStore: () => ({ tag: h.tag }),
}));

vi.mock('../../tasks/components/ProjectBar', () => ({ ProjectBar: () => null }));

vi.mock('../../tasks/projectContext', () => ({
  useProjects: () => ({
    projects: [],
    activeId: 'proj-1',
    loading: false,
    setActiveId: () => {},
    refreshProjects: async () => [],
    createProject: async () => ({}),
    updateProject: async () => {},
    deleteProject: async () => {},
  }),
}));

import { VisualDesignerPage } from '../VisualDesignerPage';
import { AI_DRAWER_STORAGE_KEY, describeSandpackFile, toRepoPath } from '../components/AiAssistantDrawer';

afterEach(() => {
  cleanup();
  localStorage.clear();
  h.tag.mockClear();
  h.fileChatCalls.length = 0;
});

describe('VisualDesignerPage — AI Assistant & Inspector drawer', () => {
  it('is closed by default and toggles open/closed from the toolbar', () => {
    render(<VisualDesignerPage />);
    expect(screen.queryByTestId('ai-assistant-drawer')).toBeNull();

    fireEvent.click(screen.getByTestId('ai-chat-toggle'));
    expect(screen.getByTestId('ai-assistant-drawer')).toBeTruthy();
    expect(screen.getByTestId('mock-filechat')).toBeTruthy();
    expect(screen.getByTestId('ai-chat-toggle').getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByTestId('ai-chat-toggle'));
    expect(screen.queryByTestId('ai-assistant-drawer')).toBeNull();
    expect(screen.getByTestId('ai-chat-toggle').getAttribute('aria-pressed')).toBe('false');
  });

  it('persists the drawer state to localStorage and restores it on the next mount', () => {
    const first = render(<VisualDesignerPage />);
    fireEvent.click(screen.getByTestId('ai-chat-toggle'));
    expect(localStorage.getItem(AI_DRAWER_STORAGE_KEY)).toBe('1');
    first.unmount();

    // A fresh mount (new visit) restores the open drawer from localStorage.
    render(<VisualDesignerPage />);
    expect(screen.getByTestId('ai-assistant-drawer')).toBeTruthy();

    // The drawer's own close button also persists the collapsed state.
    fireEvent.click(screen.getByTestId('ai-drawer-close'));
    expect(screen.queryByTestId('ai-assistant-drawer')).toBeNull();
    expect(localStorage.getItem(AI_DRAWER_STORAGE_KEY)).toBe('0');
  });

  it('composes FileChat with the existing activeId prop and tags the active file into the chat store', () => {
    render(<VisualDesignerPage />);
    fireEvent.click(screen.getByTestId('ai-chat-toggle'));

    const props = h.fileChatCalls.at(-1);
    expect(props).toBeTruthy();
    expect(props!.activeId).toBe('proj-1');

    // The selection bridge tags the file being viewed (App.tsx by default) so prompts
    // operate on the right Sandpack file.
    expect(h.tag).toHaveBeenCalledWith('App.tsx');
  });

  it('updates the context banner and re-tags when the user views another code file', () => {
    render(<VisualDesignerPage />);
    fireEvent.click(screen.getByTestId('ai-chat-toggle'));

    const banner = () => screen.getByTestId('designer-ai-context').textContent ?? '';
    expect(banner()).toContain('App.tsx');

    fireEvent.click(screen.getByTestId('mock-open-styles'));
    expect(banner()).toContain('styles.css');
    expect(h.tag).toHaveBeenCalledWith('styles.css');
  });
});

describe('AiAssistantDrawer helpers', () => {
  it('strips Sandpack\'s leading slash for repo-style paths', () => {
    expect(toRepoPath('/App.tsx')).toBe('App.tsx');
    expect(toRepoPath('App.tsx')).toBe('App.tsx');
  });

  it('describes the active file with a short human-readable context string', () => {
    expect(describeSandpackFile('/App.tsx')).toMatch(/root react component/i);
    expect(describeSandpackFile('/styles.css')).toMatch(/stylesheet/i);
    expect(describeSandpackFile('/index.tsx')).toMatch(/typescript module/i);
    expect(describeSandpackFile('/public/index.html')).toMatch(/html shell/i);
  });
});
