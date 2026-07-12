import React, { useCallback, useEffect, useState } from 'react';
import {
  SandpackProvider,
  SandpackLayout,
  SandpackCodeEditor,
  SandpackPreview,
  useSandpack,
} from '@codesandbox/sandpack-react';
import { Eye, Code2, Columns, RotateCcw, Sparkles } from 'lucide-react';
import { useProjects } from '../tasks/projectContext';
import { DEVICE_PRESETS, DEFAULT_TWEAKS, DEFAULT_FILES } from './presets';
import { DevicePreset, VisualTweaks } from './types';
import { TweaksSidebar } from './components/TweaksSidebar';
import { AgentPromptBar } from './components/AgentPromptBar';
import { ViewportContainer } from './components/ViewportContainer';
import { StudioNavbar } from '../../components/navigation/StudioNavbar';
import { AiAssistantDrawer, AI_DRAWER_STORAGE_KEY } from './components/AiAssistantDrawer';

const buildDynamicCSS = (t: VisualTweaks) => `:root {
  --bg-color: ${t.bgColor};
  --text-color: ${t.textColor};
  --accent-color: ${t.accentColor};
  --font-family: ${t.fontFamily}, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-size: ${t.fontSize};
  --font-weight: ${t.fontWeight};
  --line-height: ${t.lineHeight};
  --border-radius: ${t.borderRadius}px;
  --border-width: ${t.borderWidth}px;
  --box-shadow: ${t.boxShadow};
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  padding: 0;
  background-color: var(--bg-color);
  color: var(--text-color);
  font-family: var(--font-family);
  font-size: var(--font-size);
  font-weight: var(--font-weight);
  line-height: var(--line-height);
}

.studio-container {
  min-height: 100vh;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.studio-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.logo-badge {
  background: rgba(99, 102, 241, 0.15);
  color: var(--accent-color);
  padding: 6px 12px;
  border-radius: 9999px;
  font-weight: 700;
  font-size: 0.85rem;
  border: 1px solid rgba(99, 102, 241, 0.3);
}

.header-status {
  font-size: 0.85rem;
  opacity: 0.7;
}

.studio-main {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.card {
  background: rgba(255, 255, 255, 0.03);
  border: var(--border-width) solid rgba(255, 255, 255, 0.08);
  border-radius: var(--border-radius);
  padding: 24px;
  box-shadow: var(--box-shadow);
  transition: all 0.2s ease;
}

.card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.tag {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  opacity: 0.6;
}

.status-dot {
  width: 8px;
  height: 8px;
  background: #10b981;
  border-radius: 505;
  box-shadow: 0 0 8px #10b981;
}

h1 {
  margin: 0 0 8px 0;
  font-size: 1.6rem;
  font-weight: 700;
  line-height: 1.25;
}

.subtitle {
  margin: 0 0 20px 0;
  opacity: 0.8;
}

.stats-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-bottom: 24px;
}

.stat-box {
  background: rgba(255, 255, 255, 0.03);
  padding: 12px;
  border-radius: calc(var(--border-radius) * 0.6);
  border: 1px solid rgba(255, 255, 255, 0.05);
  text-align: center;
}

.stat-value {
  display: block;
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--accent-color);
}

.stat-label {
  font-size: 0.75rem;
  opacity: 0.6;
}

.actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.btn {
  padding: 10px 18px;
  border-radius: calc(var(--border-radius) * 0.6);
  font-weight: 600;
  font-size: 0.9rem;
  cursor: pointer;
  border: none;
  transition: transform 0.15s ease, opacity 0.15s ease;
}

.btn:active {
  transform: scale(0.98);
}

.btn-primary {
  background: var(--accent-color);
  color: #ffffff;
  box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);
}

.btn-secondary {
  background: rgba(255, 255, 255, 0.08);
  color: var(--text-color);
}

.tabs-card {
  padding: 0;
  overflow: hidden;
}

.tabs-header {
  display: flex;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(0, 0, 0, 0.2);
}

.tab {
  flex: 1;
  background: none;
  border: none;
  padding: 14px;
  color: var(--text-color);
  font-weight: 600;
  opacity: 0.6;
  cursor: pointer;
  transition: opacity 0.2s;
}

.tab.active {
  opacity: 1;
  border-bottom: 2px solid var(--accent-color);
}

.tab-body {
  padding: 20px 24px;
}`;

/**
 * Reports Sandpack's active file (the code tab the user is viewing) up to the page, so the
 * AI drawer — which lives OUTSIDE the SandpackProvider — can pass the right file context to
 * FileChat. Renders nothing.
 */
const ActiveFileTracker: React.FC<{ onActiveFile: (path: string) => void }> = ({ onActiveFile }) => {
  const { sandpack } = useSandpack();
  useEffect(() => {
    onActiveFile(sandpack.activeFile);
  }, [sandpack.activeFile, onActiveFile]);
  return null;
};

export const VisualDesignerPage: React.FC = () => {
  const { activeId } = useProjects();
  const [selectedPreset, setSelectedPreset] = useState<DevicePreset>(DEVICE_PRESETS[0]);
  const [tweaks, setTweaks] = useState<VisualTweaks>(DEFAULT_TWEAKS);
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait');
  const [zoom, setZoom] = useState<number>(1);
  const [code, setCode] = useState<string>(DEFAULT_FILES['/App.tsx']);
  const [viewMode, setViewMode] = useState<'split' | 'preview' | 'code'>('split');

  // Which Sandpack file the user is viewing — the AI drawer's selection context.
  const [activeFile, setActiveFile] = useState<string>('/App.tsx');

  // AI Assistant & Inspector drawer — collapsed by default, persisted across visits.
  const [aiDrawerOpen, setAiDrawerOpen] = useState<boolean>(() => {
    try { return localStorage.getItem(AI_DRAWER_STORAGE_KEY) === '1'; } catch { return false; }
  });
  const toggleAiDrawer = useCallback(() => {
    setAiDrawerOpen(open => {
      const next = !open;
      try { localStorage.setItem(AI_DRAWER_STORAGE_KEY, next ? '1' : '0'); } catch { /* quota */ }
      return next;
    });
  }, []);

  return (
    <div className="flex flex-col h-screen w-screen bg-slate-950 text-slate-100 overflow-hidden">
      <StudioNavbar />
      {/* No ProjectBar here: StudioNavbar already carries the brand, the active-project badge,
          and cross-studio nav. The light-themed ProjectBar also clashed with this dark studio
          and leaked the onboarding banner into the designer, so it is dropped entirely. Project
          switching stays on the Swarm Board; the active project is reflected in StudioNavbar. */}

      {/* Top Header Bar */}
      <div className="border-b border-slate-800 bg-slate-900/80 px-4 py-2.5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-bold text-slate-100 flex items-center gap-2">
            <span>Visual React Studio</span>
            <span className="text-2xs font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
              Live Preview & Agent
            </span>
          </h1>
        </div>

        <div className="flex items-center gap-2">
          {/* View Mode Switcher */}
          <div className="flex items-center bg-slate-800 border border-slate-700 rounded-lg p-0.5">
            <button
              type="button"
              data-testid="view-split"
              onClick={() => setViewMode('split')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-2xs font-medium transition-colors ${
                viewMode === 'split'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Columns size={13} />
              <span>Split</span>
            </button>
            <button
              type="button"
              data-testid="view-preview"
              onClick={() => setViewMode('preview')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-2xs font-medium transition-colors ${
                viewMode === 'preview'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Eye size={13} />
              <span>Preview</span>
            </button>
            <button
              type="button"
              data-testid="view-code"
              onClick={() => setViewMode('code')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-2xs font-medium transition-colors ${
                viewMode === 'code'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Code2 size={13} />
              <span>Code</span>
            </button>
          </div>

          <button
            type="button"
            data-testid="ai-chat-toggle"
            onClick={toggleAiDrawer}
            aria-pressed={aiDrawerOpen}
            className={`px-2.5 py-1 text-2xs font-medium border rounded-lg transition-colors flex items-center gap-1.5 ${
              aiDrawerOpen
                ? 'bg-indigo-600 border-indigo-500 text-white'
                : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-300'
            }`}
            title="Toggle AI Assistant & Inspector"
          >
            <Sparkles size={13} />
            <span>AI Chat</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setCode(DEFAULT_FILES['/App.tsx']);
              setTweaks(DEFAULT_TWEAKS);
              setSelectedPreset(DEVICE_PRESETS[0]);
            }}
            className="px-2.5 py-1 text-2xs font-medium bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-slate-300 transition-colors flex items-center gap-1.5"
            title="Reset Everything"
         >
            <RotateCcw size={13} />
            <span>Reset Project</span>
          </button>
        </div>
      </div>

      {/* Main Studio Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Hand Tweaks Sidebar */}
        <TweaksSidebar
           tweaks={tweaks}
            onChange={setTweaks}
            onReset={() => setTweaks(DEFAULT_TWEAKS)}
        />

        {/* Sandpack Workspace Area — min-w-0 lets it shrink when the AI drawer opens
            instead of forcing the flex row to overflow. */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden relative">
          <SandpackProvider
             template="react-ts"
             theme="dark"
             files={{
                '/App.tsx': {
                  code,
                  active: true,
                },
                '/styles.css': {
                  code: buildDynamicCSS(tweaks),
                  hidden: true,
                },
              }}
          >
            <ActiveFileTracker onActiveFile={setActiveFile} />
            <SandpackLayout
              style={{
                flex: 1,
                display: 'flex',
                height: '100%',
                border: 'none',
                borderRadius: 0,
                overflow: 'hidden',
              }}
            >
              {viewMode !== 'preview' && (
                <div
                  style={{
                    flex: viewMode === 'code' ? 1 : 0.45,
                    display: 'flex',
                    flexDirection: 'column',
                    height: '100%',
                    borderRight: '1px solid #1e293b',
                  }}
                >
                  <SandpackCodeEditor
                    showTabs
                    showLineNumbers
                    showInlineErrors
                    wrapContent
                    style={{ height: '100%', flex: 1 }}
                  />
                </div>
              )}

              {viewMode !== 'code' && (
                <ViewportContainer
                 selectedPreset={selectedPreset}
                  onPresetChange={setSelectedPreset}
                  orientation={orientation}
                  onOrientationToggle={() =>
                    setOrientation((o) => (o === 'portrait' ? 'landscape' : 'portrait'))
                  }
                  zoom={zoom}
                  onZoomChange={setZoom}
                >
                  <SandpackPreview
                    showOpenInCodeSandbox={false}
                    showRefreshButton
                    style={{ width: '100%', height: '100%', flex: 1 }}
                  />
                </ViewportContainer>
              )}
            </SandpackLayout>
          </SandpackProvider>

          {/* Bottom Agent Prompt Bar */}
          <AgentPromptBar code={code} tweaks={tweaks} />
        </div>

        {/* Right-hand AI Assistant & Inspector drawer (collapsible, persisted) */}
        {aiDrawerOpen && (
          <AiAssistantDrawer
            projectId={activeId || 'default-project'}
            activeFile={activeFile}
            onClose={toggleAiDrawer}
          />
        )}
      </div>
    </div>
  );
};
