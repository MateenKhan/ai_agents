import React, { useEffect } from 'react';
import { Sparkles, X, FileCode } from 'lucide-react';
import { ChatStoreProvider, FileChat, useChatStore } from '../../tasks/components/FileChat';

/**
 * AiAssistantDrawer — the collapsible right-side "AI Assistant & Inspector" pane of the
 * Visual Designer. It composes the existing <FileChat /> untouched, inside its own
 * <ChatStoreProvider> (same store contract FileBrowser uses), and bridges the designer's
 * selection into the chat: whatever Sandpack file the user is viewing gets tagged into the
 * active chat thread via the store's `tag()` — the exact mechanism FileBrowser's
 * drag-to-tag uses — so prompts operate on the right file.
 */

/** localStorage key for the drawer's open/closed state (persisted across visits). */
export const AI_DRAWER_STORAGE_KEY = 'designer.aiDrawerOpen';

/** Strip Sandpack's leading slash so paths read like repo-relative paths ("App.tsx"). */
export const toRepoPath = (sandpackPath: string) => sandpackPath.replace(/^\//, '');

/** A short human-readable context line for the file the user is looking at. */
export function describeSandpackFile(sandpackPath: string): string {
  const p = toRepoPath(sandpackPath);
  if (p === 'App.tsx') return 'Root React component rendered in the live preview';
  if (p.endsWith('.css')) return 'Stylesheet applied to the live preview';
  if (p.endsWith('.tsx') || p.endsWith('.ts')) return 'TypeScript module in the Sandpack project';
  if (p.endsWith('.html')) return 'HTML shell of the Sandpack preview';
  return 'File in the Sandpack project';
}

/**
 * Selection → chat-context bridge. Must render INSIDE <ChatStoreProvider>. Tags the active
 * designer file into the current chat thread whenever the selection changes — and re-tags
 * when the user switches threads (`tag` is re-created per active thread), so a fresh thread
 * still knows which file the designer is on. `tag()` is idempotent for already-tagged paths.
 */
export function SelectionContextBridge({ filePath }: { filePath: string }) {
  const { tag } = useChatStore();
  useEffect(() => {
    if (filePath) tag(filePath);
  }, [filePath, tag]);
  return null;
}

export interface AiAssistantDrawerProps {
  /** Active project id — scopes the chat store + API calls, same as FileBrowser. */
  projectId: string;
  /** The Sandpack file currently being viewed/edited, e.g. "/App.tsx". */
  activeFile: string;
  onClose: () => void;
}

export const AiAssistantDrawer: React.FC<AiAssistantDrawerProps> = ({ projectId, activeFile, onClose }) => {
  const repoPath = toRepoPath(activeFile);
  const contextNote = describeSandpackFile(activeFile);

  return (
    <aside
      data-testid="ai-assistant-drawer"
      aria-label="AI Assistant & Inspector"
      className="w-[360px] min-w-[300px] max-w-[45vw] shrink-0 flex flex-col h-full border-l border-slate-800 bg-white text-slate-900 overflow-hidden"
    >
      {/* Drawer chrome — designer-owned, sits above the composed FileChat. */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-200 bg-slate-50 shrink-0">
        <Sparkles size={14} className="text-indigo-500 shrink-0" />
        <span className="flex-1 min-w-0 text-xs font-bold text-slate-800 truncate">
          AI Assistant &amp; Inspector
        </span>
        <button
          type="button"
          data-testid="ai-drawer-close"
          onClick={onClose}
          aria-label="Close AI assistant"
          className="shrink-0 text-slate-400 hover:text-slate-700 transition-colors"
        >
          <X size={15} />
        </button>
      </div>

      {/* Active selection context — what the chat prompts will operate on. */}
      <div
        data-testid="designer-ai-context"
        className="flex items-start gap-1.5 px-3 py-2 border-b border-slate-200 bg-indigo-50/60 shrink-0"
      >
        <FileCode size={13} className="text-indigo-500 shrink-0 mt-0.5" />
        <div className="min-w-0">
          <div className="font-mono text-2xs font-bold text-indigo-900 truncate">{repoPath}</div>
          <div className="text-micro text-indigo-700/80 leading-snug">{contextNote}</div>
        </div>
      </div>

      {/* The existing chat surface, composed as-is under its own store. */}
      <ChatStoreProvider activeId={projectId}>
        <SelectionContextBridge filePath={repoPath} />
        <FileChat activeId={projectId} className="flex-1 min-h-0" />
      </ChatStoreProvider>
    </aside>
  );
};
