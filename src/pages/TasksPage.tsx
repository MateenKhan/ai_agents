import React, { useState, useRef, useEffect, lazy, Suspense } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { HeartPulse, X, Plus, ClipboardCheck, ChevronLeft, ChevronRight, ChevronDown, WifiOff, Keyboard } from 'lucide-react';
import { TAB_META, loadHiddenTabs, saveHiddenTabs, type TabId } from './tasks/tabsConfig';

// Modular Components
import { useTasks } from './tasks/hooks/useTasks';
import { useOverflowEdges } from './tasks/hooks/useOverflowEdges';
import { OrchestratorToggle } from './tasks/components/OrchestratorToggle';
import { Tooltip } from './tasks/components/Tooltip';
import { RecordButton } from './tasks/components/RecordButton';
import { BoardMenu } from './tasks/components/BoardMenu';
import { TaskBoard } from './tasks/components/TaskBoard';
import { HumanTodos } from './tasks/components/HumanTodos';
import { Modal } from './tasks/components/Modal';
import { useToast } from './tasks/components/Toast';
import { useConfirm } from './tasks/components/ConfirmProvider';
import { ProjectBar } from './tasks/components/ProjectBar';
import { StartScreen, SETUP_DONE_KEY } from './tasks/components/StartScreen';
import { AgentTank } from '../components/piranha/AgentTank';
import { PiranhaLoader } from '../components/piranha/PiranhaLoader';
import { useProjects } from './tasks/projectContext';
import type { Task, Column } from './tasks/types';
import { loadColumns, saveColumns, BOARD_COLUMNS_EVENT } from './tasks/boardConfig';
import { API_BASE, withProject } from '../apiBase';
import { iconBtn } from './tasks/ui';

// Lazy Loaded Components
const TaskModal = lazy(() => import('./tasks/components/TaskModal').then(m => ({ default: m.TaskModal })));
const AnalyticsTab = lazy(() => import('./tasks/components/AnalyticsTab'));
const ContextTab = lazy(() => import('./tasks/components/ContextTab'));
// Type-only: erased at build, so it does NOT pull the lazy chunk into the main bundle.
import type { ContextView } from './tasks/components/ContextTab';
const TaskDetail = lazy(() => import('./tasks/components/TaskDetail'));
const PromptModal = lazy(() => import('./tasks/components/PromptModal').then(m => ({ default: m.PromptModal })));
const SettingsModal = lazy(() => import('./tasks/components/SettingsModal').then(m => ({ default: m.SettingsModal })));
const TerminalMonitor = lazy(() => import('./tasks/components/TerminalMonitor').then(m => ({ default: m.TerminalMonitor })));
const LogsTab = lazy(() => import('./tasks/components/LogsTab'));
const DbTab = lazy(() => import('./tasks/components/DbTab'));
const AgentsTab = lazy(() => import('./tasks/components/AgentsTab'));
const GitPanel = lazy(() => import('./tasks/components/GitPanel').then(m => ({ default: m.GitPanel })));

const TasksPage: React.FC = () => {
  const navigate = useNavigate();
  const { activeId, projects, loading: projectsLoading } = useProjects();
  const activeProject = projects.find(p => p.id === activeId);
  const {
    tasks,
    loading,
    error,
    triggeringIds,
    controllingIds,
    fetchTasks,
    createTask,
    updateTask,
    deleteTask,
    deleteTasks,
    triggerAgent,
    controlTask
  } = useTasks(activeId);

  // Local UI State
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  // Board columns are per-project; reload when the active project changes or another
  // surface (the project Edit popup's Boards accordion) saves them.
  const [columns, setColumns] = useState<Column[]>(() => loadColumns(activeId));
  useEffect(() => { setColumns(loadColumns(activeId)); }, [activeId]);
  useEffect(() => {
    const onChanged = (e: Event) => {
      const pid = (e as CustomEvent).detail?.projectId;
      if (!pid || pid === activeId) setColumns(loadColumns(activeId));
    };
    window.addEventListener(BOARD_COLUMNS_EVENT, onChanged);
    return () => window.removeEventListener(BOARD_COLUMNS_EVENT, onChanged);
  }, [activeId]);
  const [gitOpen, setGitOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [todosOpen, setTodosOpen] = useState(false);
  const { tab: urlTab } = useParams<{ tab?: string }>();
  // `search` is not a tab — it is the Search view of the Context tab. The path is kept so
  // the old /tasks/search deep link (and anyone's bookmark) still lands somewhere correct.
  const PATH_TO_TAB: Record<string, TabId> = { context: 'context', search: 'context', analytics: 'analytics', logs: 'logs', database: 'db', agents: 'agents' };
  const TAB_TO_PATH: Record<TabId, string> = { board: '', context: 'context', analytics: 'analytics', logs: 'logs', db: 'database', agents: 'agents' };
  const activeTab: TabId = PATH_TO_TAB[urlTab ?? ''] ?? 'board';
  const setActiveTab = (t: TabId) => navigate(`/tasks${TAB_TO_PATH[t] ? '/' + TAB_TO_PATH[t] : ''}`);

  // The Context view lives in the URL, so it survives reload and the back button.
  const contextView: ContextView = urlTab === 'search' ? 'search' : 'memory';
  const setContextView = (v: ContextView) => navigate(v === 'search' ? '/tasks/search' : '/tasks/context');

  // Closeable tabs the user has hidden. Persisted; restored from Settings → Visible Tabs.
  const [hiddenTabs, setHiddenTabs] = useState<Set<TabId>>(() => new Set(loadHiddenTabs()));
  const applyHidden = (next: Set<TabId>) => { setHiddenTabs(next); saveHiddenTabs([...next]); };
  const hideTab = (id: TabId) => { const next = new Set(hiddenTabs); next.add(id); applyHidden(next); };
  const setTabHidden = (id: TabId, hidden: boolean) => {
    const next = new Set(hiddenTabs);
    hidden ? next.add(id) : next.delete(id);
    applyHidden(next);
  };
  // Hiding the tab you're on falls back to the Board.
  useEffect(() => { if (hiddenTabs.has(activeTab)) setActiveTab('board'); }, [hiddenTabs, activeTab]);
  const visibleTabs = TAB_META.filter(t => !hiddenTabs.has(t.id));
  // The strip shows a real scrollbar (`.scroll-x-bar`, always reserved so the row never
  // jumps). We still measure the overflow — the cluster below uses it to fold itself away.
  const { ref: tabStripRef, edges: tabEdges } = useOverflowEdges<HTMLDivElement>();
  // Collapse the action cluster by default on phones so the tab strip keeps its room;
  // expanded from sm+ up to preserve the desktop header. Tap the chevron to reveal it.
  const [actionsOpen, setActionsOpen] = useState(
    () => typeof window === 'undefined' || !window.matchMedia || window.matchMedia('(min-width: 640px)').matches
  );
  // Once the user has touched the chevron, their choice is final — never fight it.
  const actionsTouched = useRef(false);
  const toggleActions = () => { actionsTouched.current = true; setActionsOpen(o => !o); };

  // Tabs outrank the cluster. When the strip is genuinely clipping a tab, fold the cluster
  // away and give the width back — a sliced "DATABA…" is worse than a hidden Settings icon.
  //
  // A viewport breakpoint cannot do this: the tab row shares its width with the AgentTank
  // column, so the pixel at which tabs start clipping is not a property of the window. We
  // already measure the strip; use the measurement.
  //
  // COLLAPSE ONLY. Auto-expanding once the width is free would re-clip the tabs, which would
  // free the width again — a layout oscillation. One-way is stable by construction.
  useEffect(() => {
    if (!actionsTouched.current && actionsOpen && tabEdges.right) setActionsOpen(false);
  }, [actionsOpen, tabEdges.right]);
  // Which tab the New-task modal opens on: 'manual' (the form) or 'ai' (chat intake).
  const [taskModalMode, setTaskModalMode] = useState<'manual' | 'ai'>('manual');
  const [logsAgent, setLogsAgent] = useState<string | null>(null);
  const [healReport, setHealReport] = useState<{ healed: number; steps: any[] } | null>(null);
  const [healing, setHealing] = useState(false);
  const [healDots, setHealDots] = useState(1);
  useEffect(() => {
    if (!healing) { setHealDots(1); return; }
    const iv = setInterval(() => setHealDots(d => (d % 3) + 1), 400);
    return () => clearInterval(iv);
  }, [healing]);

  const handleHeal = async () => {
    setHealing(true);
    try {
      const res = await fetch(`${API_BASE}/heal`, { method: 'POST' });
      const d = await res.json();
      setHealReport({ healed: d.healed ?? 0, steps: d.steps ?? [] });
    } catch {
      setHealReport({ healed: 0, steps: [{ step: 'Heal failed', status: 'warn', detail: 'db-server unreachable' }] });
    } finally {
      setHealing(false);
      await fetchTasks();
    }
  };
  const [viewingTask, setViewingTask] = useState<Task | null>(null);

  // ── First-run setup gate ──
  const [setupDone, setSetupDone] = useState<boolean>(() => {
    try { return localStorage.getItem(SETUP_DONE_KEY) === '1'; } catch { return true; }
  });
  const needsSetup = !setupDone && !projectsLoading && !loading
    && !projects.some(p => p.id !== 'default') && tasks.length === 0;

  // ── Item 90: global offline banner ──
  // The db-server (:6952) is the whole backend; when it is down every panel fails silently.
  // A dedicated lightweight health poll (GET /health returns {ok:true}) gives one honest,
  // page-wide signal instead of letting each tab guess. It is separate from the tasks poll's
  // `error` (which also fires on ordinary 4xx/5xx) so the banner means exactly "server
  // unreachable", never "one request failed".
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const ping = async () => {
      try {
        const res = await fetch(`${API_BASE}/health`);
        if (!cancelled) setOffline(!res.ok);
      } catch {
        if (!cancelled) setOffline(true);
      }
    };
    ping();
    const iv = setInterval(ping, 8000);
    return () => { cancelled = true; clearInterval(iv); };
  }, []);

  // ── Item 104: minimal global keyboard-shortcut layer ──
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  // Human review queue — agent-finished tasks awaiting verification
  const reviewQueue = tasks.filter(t => t.status === 'TESTING');

  const handleApprove = async (taskId: string) => {
    // APPROVE (review-before-merge) = merge the reviewed branch. The orchestrator picks up
    // stage=merge, merges, and marks it DONE. The preview (if any) is torn down server-side.
    try {
      const res = await fetch(withProject(`${API_BASE}/tasks/${encodeURIComponent(taskId)}/approve`), { method: 'POST' });
      if (!res.ok) throw new Error('approve endpoint failed');
      await fetchTasks();
    } catch {
      await updateTask(taskId, { stage: 'merge', status: 'WORKING', started: null, claimedBy: null, reviewNote: null });
    }
  };

  const handleReject = async (taskId: string, feedback: string, updatedDod?: string) => {
    // REJECT = send back to the dev with the reason (stage=build). Preview torn down server-side.
    try {
      const res = await fetch(withProject(`${API_BASE}/tasks/${encodeURIComponent(taskId)}/reject`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: feedback }),
      });
      if (!res.ok) throw new Error('reject endpoint failed');
      if (updatedDod) await updateTask(taskId, { dod: updatedDod });
      await fetchTasks();
    } catch {
      await updateTask(taskId, {
        stage: 'build', status: 'WORKING', started: null, claimedBy: null, qaVerdict: null,
        reviewNote: feedback, ...(updatedDod ? { dod: updatedDod } : {}), attempts: 0, nextRetryAt: null,
      });
    }
  };

  // Global confirm + toast (promise-based dialog, page notifications).
  const confirm = useConfirm();
  const toast = useToast();

  // Fire-and-forget confirm helper: keeps existing call sites unchanged.
  const requestConfirm = (title: string, message: string, action: () => void) => {
    confirm({ title, message }).then(ok => { if (ok) action(); });
  };

  // Prompt & Terminal State
  const [promptModal, setPromptModal] = useState({ open: false, prompt: '', title: '', copied: false });
  const [terminal, setTerminal] = useState({ open: false, minimized: false, taskId: null as string | null, agentName: null as string | null, output: '' });
  const terminalBodyRef = useRef<HTMLDivElement>(null);

  // Handlers
  const handleAddTask = (mode: 'manual' | 'ai' = 'manual') => {
    setEditingTask(null);
    setTaskModalMode(mode);
    setIsTaskModalOpen(true);
  };

  // Global shortcuts: n = new task, / = search context, ? = toggle this help.
  // Guarded so they never fire while the user is typing (input/textarea/select/
  // contentEditable) and never hijack a browser/OS chord (meta/ctrl/alt held).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable) return;
      if (e.key === '?') { e.preventDefault(); setShortcutsOpen(s => !s); }
      else if (e.key === 'Escape') { if (shortcutsOpen) setShortcutsOpen(false); }
      else if (e.key === 'n') { e.preventDefault(); handleAddTask(); }
      else if (e.key === '/') { e.preventDefault(); setContextView('search'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shortcutsOpen]);

  const handleEditTask = (task: Task) => {
    setEditingTask(task);
    setIsTaskModalOpen(true);
  };

  const handleSaveTask = async (taskData: Partial<Task>, projectId: string) => {
    if (editingTask) {
      await updateTask(editingTask.id, taskData);
    } else {
      await createTask({
        ...taskData,
        id: `NEW-${Math.random().toString(36).substring(2, 8).toUpperCase()}`
      }, projectId);
    }
  };

  const handleTrigger = async (taskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    try {
      // 1. Start agent execution
      await triggerAgent(taskId);

      // 2. Fetch specific trigger info for the prompt
      const res = await fetch(withProject(`${API_BASE}/tasks/${taskId}/trigger`), { method: 'POST' });
      const data = await res.json();

      // 3. Show prompt modal
      setPromptModal({
        open: true,
        prompt: data.agentPrompt || 'No prompt generated.',
        title: task.title,
        copied: false
      });

      // 4. Open terminal
      setTerminal({
        open: true,
        minimized: false,
        taskId,
        agentName: task.claimedBy || 'dev',
        output: ''
      });
    } catch (err) {
      console.error('Trigger failed', err);
    }
  };

  // Poll tmux output for terminal
  useEffect(() => {
    let interval: any;
    if (terminal.open && !terminal.minimized && terminal.agentName) {
      const poll = async () => {
        try {
          const res = await fetch(`${API_BASE}/agent-logs/${terminal.agentName}`);
          const text = await res.text();
          setTerminal(prev => ({ ...prev, output: text }));
          if (terminalBodyRef.current) {
            terminalBodyRef.current.scrollTop = terminalBodyRef.current.scrollHeight;
          }
        } catch { }
      };
      poll();
      interval = setInterval(poll, 2000);
    }
    return () => clearInterval(interval);
  }, [terminal.open, terminal.minimized, terminal.agentName]);

  if (loading && tasks.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-100">
        <PiranhaLoader size={64} label="Waking the swarm…" />
      </div>
    );
  }

  // First-run setup: the project source is the root decision every task depends on, so a
  // brand-new install (only the seeded default project, zero tasks, setup never completed)
  // gets the starting screen before the board. Completing or skipping it never nags again.
  if (needsSetup) {
    return <StartScreen onDone={() => setSetupDone(true)} />;
  }

  // Your Review — the page's one notification affordance. It opens the review panel
  // (a dialog, hence aria-haspopup + the small down-caret hint — item 78) and carries the
  // count of tasks awaiting verification. Extracted so item 72 can render it in TWO places
  // without duplicating markup: inside the collapsible cluster when there is nothing to
  // review, and promoted to the always-visible row the moment the count is non-zero — a
  // badge folded behind the chevron is a badge nobody sees.
  const reviewLabel = `Your Review${reviewQueue.length ? ` — ${reviewQueue.length} awaiting` : ''}`;
  const reviewButton = (
    <Tooltip label={reviewLabel}>
      <button
        onClick={() => setTodosOpen(true)}
        data-feature-id="tasks-open-todos"
        aria-haspopup="dialog"
        aria-label={reviewLabel}
        className={`${iconBtn} relative gap-0.5 ${reviewQueue.length > 0 ? 'bg-amber-50 text-amber-700 border-amber-300 sm:hover:bg-amber-100' : ''}`}
      >
        <ClipboardCheck size={14} />
        <ChevronDown size={10} strokeWidth={2.5} className="opacity-50" aria-hidden="true" />
        {reviewQueue.length > 0 && (
          <span aria-hidden="true" className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center text-micro font-bold bg-amber-500 text-white rounded-full">{reviewQueue.length > 9 ? '9+' : reviewQueue.length}</span>
        )}
      </button>
    </Tooltip>
  );

  // The tab switcher. It lives in the header (see ProjectBar) so the tank can span both
  // header rows instead of leaving dead space beside the brand.
  const tabStrip = (
        <div className="flex items-end gap-2 pt-1.5" data-feature-id="tasks-tab-switcher">
          <div ref={tabStripRef} className="flex items-stretch gap-1 scroll-x-bar min-w-0 shrink">
            {visibleTabs.map((t) => {
              const Icon = t.icon;
              const active = activeTab === t.id;
              return (
                // A tab used to be a <button> that wrapped the close affordance — interactive
                // content nested inside interactive content, which is invalid HTML and confuses
                // screen readers. This wrapper is now inert (a plain div): the select action and
                // the close action are two sibling <button>s, each natively keyboard-reachable,
                // so neither has to fake key handling or stop event propagation. It stays
                // `relative` and carries all the tab chrome (background, border, the -mb-px /
                // border-b-white seam) so the shared-layout motion accents still anchor to the
                // full tab box — spanning past the close button, exactly as before.
                <div
                  key={t.id}
                  className={`relative -mb-px shrink-0 flex items-center min-h-control text-micro font-bold uppercase tracking-normal rounded-t-lg border transition-colors ${active
                    ? 'z-10 bg-white border-slate-300 border-b-white text-accent-700 shadow-sm'
                    : 'border-transparent text-slate-500 sm:hover:text-slate-900 sm:hover:bg-slate-50'}`}
                >
                  {active && (
                    <>
                      {/* Neon accent sitting on the tab's bottom seam, glowing downward */}
                      <motion.span
                        layoutId="tasks-tab-underline"
                        transition={{ type: 'spring', stiffness: 500, damping: 38 }}
                        className="absolute left-3 right-3 -bottom-px h-[3px] rounded-full bg-gradient-to-r from-accent-400 via-accent-500 to-accent-400 shadow-[0_6px_14px_0_rgba(255,59,29,0.9),0_11px_26px_1px_rgba(255,59,29,0.6)]"
                      />
                      {/* Soft light pooling downward only */}
                      <motion.span
                        layoutId="tasks-tab-glow"
                        transition={{ type: 'spring', stiffness: 500, damping: 38 }}
                        aria-hidden
                        className="absolute left-2 right-2 -bottom-1.5 h-5 bg-gradient-to-b from-accent-400/55 to-transparent blur-md pointer-events-none"
                      />
                    </>
                  )}
                  <button
                    type="button"
                    data-feature-id={`tasks-tab-${t.id}`}
                    onClick={() => setActiveTab(t.id)}
                    className="self-stretch flex items-center gap-1.5 pl-2 pr-2"
                  >
                    <Icon size={15} className={active ? 'text-accent-600' : ''} />
                    {t.label}
                  </button>
                  {/* The close affordance is the widest thing in a tab, so it appears only on the
                      ACTIVE tab, the way browser tabs do: you cannot close what you are not looking
                      at, and Settings → Visible Tabs still hides any of them. Rendered conditionally
                      rather than hidden by a hover variant, so it never occupies width it isn't using.
                      Its right margin (mr-1) plus the select button's pr-2 reproduce the old spacing
                      the -mr-1/ml-0.5 pair used to fake. */}
                  {t.closeable && active && (
                    <button
                      data-feature-id={`tasks-tab-close-${t.id}`}
                      aria-label={`Hide ${t.label} — restore from Settings`}
                      onClick={() => hideTab(t.id)}
                      className="flex items-center justify-center w-5 h-5 mr-1 rounded text-slate-400 sm:hover:text-rose-600 sm:hover:bg-rose-50 transition-colors cursor-pointer"
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          {/* Action cluster — icon-only + custom tooltips, collapsible via the chevron.
              `ml-auto` pins it to the right edge, and the chevron is the LAST child. Together
              that means expanding grows the row leftwards into empty space while the chevron
              itself never moves — it is the one control you press twice in a row, so it must
              not slide out from under the cursor between presses. */}
          {/* A hairline divider fences the action cluster off from the tab strip, so the
              chevron reads as "disclose these actions" and never as tab navigation (item 77):
              the tabs already scroll on their own real scrollbar — this chevron does not move
              between tabs. `ml-auto` still pins the whole group to the right edge. */}
          <div className="ml-auto shrink-0 flex items-center gap-1 pb-1.5 pl-2 ml-2 border-l border-slate-200" data-feature-id="tasks-actions">
            {actionsOpen && (
              <div className="flex items-center gap-1">
                <OrchestratorToggle />
                <RecordButton />
                {/* When nothing is awaiting review the badge lives here with its low-frequency
                    peers; the moment the count climbs it is promoted below (item 72). */}
                {reviewQueue.length === 0 && reviewButton}
                <BoardMenu
                  onChat={() => handleAddTask('ai')}
                  onRefresh={fetchTasks}
                  onHeal={handleHeal}
                  onSettings={() => setIsSettingsOpen(true)}
                  refreshing={loading}
                  healing={healing}
                />
              </div>
            )}
            {/* Item 72: with a pending review count, surface the badge OUTSIDE the collapsible
                group so it stays visible even when the chevron folds the rest away. */}
            {reviewQueue.length > 0 && reviewButton}
            {/* The one action you take most. Never behind a menu — so it lives OUTSIDE the
                collapsible group and stays visible even when the chevron folds the rest away. */}
            <Tooltip label="New task (n)">
              <button onClick={() => handleAddTask()} aria-label="New task" className={iconBtn}>
                <Plus size={14} strokeWidth={3} />
              </button>
            </Tooltip>
            <Tooltip label="Keyboard shortcuts (?)">
              <button onClick={() => setShortcutsOpen(true)} aria-label="Keyboard shortcuts" aria-haspopup="dialog" className={iconBtn}>
                <Keyboard size={14} />
              </button>
            </Tooltip>
            {/* Chevron points AT the icons: left when they are hidden (they will appear to the
                left), right when shown (they will fold away to the right). Direction is a
                promise about where things go, not decoration. */}
            <Tooltip label={actionsOpen ? 'Hide actions' : 'Show actions'}>
              <button
                onClick={toggleActions}
                aria-expanded={actionsOpen}
                aria-label={actionsOpen ? 'Hide actions' : 'Show actions'}
                data-feature-id="tasks-actions-toggle"
                className={iconBtn}
              >
                {actionsOpen ? <ChevronRight size={16} strokeWidth={2.5} /> : <ChevronLeft size={16} strokeWidth={2.5} />}
              </button>
            </Tooltip>
          </div>
        </div>
  );

  return (
    /* App shell: exactly one viewport tall, and it never scrolls. Everything that scrolls does
       so INSIDE the content panel below.
       This replaces five hand-guessed `calc(100dvh - 170px | 260px | 330px)` offsets, one per
       tab, each a different guess at the header's height. None of them were right, and any tab
       that forgot to guess (Agents) simply grew the page — which is the scrollbar you saw. A
       flex column measures the header instead of estimating it. */
    <div className="h-dvh flex flex-col overflow-hidden bg-slate-100 text-slate-800 selection:bg-accent-200 selection:text-accent-900">
      {/* Item 90: slim page-wide banner when the db-server (the whole backend) is unreachable.
          Health is polled independently of the tasks fetch, so this reads exactly "offline",
          not "one request 500'd". `role=status` + polite live region announces it once. */}
      {offline && (
        <div
          role="status"
          aria-live="polite"
          data-feature-id="offline-banner"
          className="shrink-0 flex items-center justify-center gap-2 px-3 py-1.5 bg-rose-600 text-white text-2xs font-bold"
        >
          <WifiOff size={13} aria-hidden="true" />
          <span>db-server unreachable — changes won't save. Retrying…</span>
          <button
            onClick={() => { fetchTasks(); }}
            className="ml-1 underline underline-offset-2 uppercase tracking-wide sm:hover:text-rose-100"
          >
            Retry now
          </button>
        </div>
      )}
      {/* The header is two columns: brand + tabs on the left, the tank on the right, sharing
          a top edge. The tabs live up here so the tank can span both rows without leaving
          dead space beside them. */}
      <div className="shrink-0">
        <ProjectBar
          onOpenGit={() => setGitOpen(true)}
          tabs={tabStrip}
          right={<AgentTank tasks={tasks} />}
        />
      </div>

      <main className="flex-1 min-h-0 w-full max-w-[1600px] mx-auto flex flex-col">
      {/* `min-h-0` at every level: a flex child's default `min-height:auto` refuses to shrink
          below its content, so without it the panel grows and the page scrolls anyway. */}
      <div className="flex-1 min-h-0 flex flex-col px-3 sm:px-4 pt-3 pb-3">
        {/* Content panel — bordered box connected to the active tab (its bottom border is open) */}
        <div className="flex-1 min-h-0 flex flex-col border border-slate-300 rounded-xl bg-white overflow-hidden">
        {error && (
          <div className="m-6 p-4 bg-rose-50 border border-rose-200 rounded-xl flex items-center justify-between">
            <span className="text-xs font-bold text-rose-600 uppercase tracking-widest">Error: {error}</span>
            <button onClick={fetchTasks} className="text-micro font-bold underline uppercase tracking-tighter text-rose-600">Try again</button>
          </div>
        )}

        {activeTab === 'context' ? (
          <Suspense fallback={<div className="p-10 flex justify-center"><PiranhaLoader size={40} label="Loading context…" /></div>}>
            <ContextTab activeId={activeId} view={contextView} onViewChange={setContextView} />
          </Suspense>
        ) : activeTab === 'analytics' ? (
          <Suspense fallback={<div className="p-10 flex justify-center"><PiranhaLoader size={40} label="Loading analytics…" /></div>}>
            <AnalyticsTab tasks={tasks} />
          </Suspense>
        ) : activeTab === 'logs' ? (
          <Suspense fallback={<div className="p-10 flex justify-center"><PiranhaLoader size={40} label="Loading logs…" /></div>}>
            <LogsTab initialAgent={logsAgent} />
          </Suspense>
        ) : activeTab === 'db' ? (
          <Suspense fallback={<div className="p-10 flex justify-center"><PiranhaLoader size={40} label="Loading database…" /></div>}>
            <DbTab />
          </Suspense>
        ) : activeTab === 'agents' ? (
          <Suspense fallback={<div className="p-10 flex justify-center"><PiranhaLoader size={40} label="Loading agents…" /></div>}>
            <AgentsTab />
          </Suspense>
        ) : (
        <TaskBoard
          tasks={tasks}
          onEdit={handleEditTask}
          onDelete={id => {
            const t = tasks.find(x => x.id === id);
            requestConfirm('Delete task?', `"${t?.title ?? id}" will be permanently deleted.`, async () => {
              try { await deleteTask(id); toast.success('Task deleted', t?.title); }
              catch (e: any) { toast.error('Delete failed', e?.message); }
            });
          }}
          onTrigger={handleTrigger}
          onControl={controlTask}
          // TaskBoard passes the lane id here; the modal doesn't take a lane, so drop it
          // rather than let it be misread as a creation mode.
          onAddTask={() => handleAddTask('manual')}
          onMove={(id, status) => {
            const label = columns.find(c => c.id === status)?.label ?? status;
            updateTask(id, { status })
              .then(() => toast.info('Task moved', `Moved to ${label}`))
              .catch((e: any) => toast.error('Move failed', e?.message));
          }}
          onBulkDelete={ids => requestConfirm(
            `Delete ${ids.length} task${ids.length > 1 ? 's' : ''}?`,
            'This cannot be undone.',
            async () => {
              try { await deleteTasks(ids); toast.success(`Deleted ${ids.length} task${ids.length > 1 ? 's' : ''}`); }
              catch (e: any) { toast.error('Delete failed', e?.message); }
            }
          )}
          onView={task => setViewingTask(task)}
          onOpenLogs={(agent) => { setLogsAgent(agent ?? null); setActiveTab('logs'); }}
          triggeringIds={triggeringIds}
          controllingIds={controllingIds}
          columns={columns}
        />
        )}
        </div>
      </div>
    </main>

      {/* Modals Overlay with Suspense */}
      <Suspense fallback={null}>
        <AnimatePresence>
          {viewingTask && (
            <TaskDetail
              task={tasks.find(t => t.id === viewingTask.id) ?? viewingTask}
              onClose={() => setViewingTask(null)}
              onEdit={handleEditTask}
              onDelete={id => {
                const t = tasks.find(x => x.id === id);
                requestConfirm('Delete task?', `"${t?.title ?? id}" will be permanently deleted.`, async () => {
                  try { await deleteTask(id); toast.success('Task deleted', t?.title); setViewingTask(null); }
                  catch (e: any) { toast.error('Delete failed', e?.message); }
                });
              }}
              onTrigger={handleTrigger}
              onControl={controlTask}
              isControlling={controllingIds.has(viewingTask.id)}
              onOpenLogs={(agent) => { setLogsAgent(agent ?? null); setActiveTab('logs'); setViewingTask(null); }}
            />
          )}

          {todosOpen && (
            <HumanTodos
              isOpen={todosOpen}
              tasks={reviewQueue}
              onClose={() => setTodosOpen(false)}
              onApprove={handleApprove}
              onReject={handleReject}
            />
          )}

          {healReport && (
            <Modal
              isOpen
              onClose={() => setHealReport(null)}
              title="Healing sweep complete"
              subtitle={`${healReport.healed} issue${healReport.healed !== 1 ? 's' : ''} fixed across ${healReport.steps.length} checks`}
              icon={<HeartPulse size={20} className="text-rose-500" />}
              maxW="sm:max-w-md"
              featureId="heal-report"
            >
              <div className="space-y-2">
                {healReport.steps.map((s: any, i: number) => (
                  <button
                    key={i}
                    onClick={() => { setHealReport(null); setLogsAgent(String(s.step).toLowerCase().includes('orchestrator') ? 'orchestrator' : null); setActiveTab('logs'); }}
                    style={{ animation: 'healStepIn .35s ease both', animationDelay: `${i * 90}ms` }}
                    className={`w-full text-left text-xs rounded-lg px-3 py-2.5 border flex items-start gap-2 transition-colors group ${s.status === 'fixed' ? 'bg-amber-50 border-amber-200 hover:bg-amber-100' : s.status === 'warn' ? 'bg-rose-50 border-rose-200 hover:bg-rose-100' : 'bg-slate-50 border-slate-200 hover:bg-slate-100'}`}
                  >
                    <span className={`mt-1 w-2 h-2 rounded-full shrink-0 ${s.status === 'fixed' ? 'bg-amber-500' : s.status === 'warn' ? 'bg-rose-500' : 'bg-emerald-500'}`} />
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-slate-700">{s.step}</div>
                      <div className="text-slate-500 mt-0.5">{s.detail}</div>
                    </div>
                    <span className="text-micro text-slate-500 mt-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">logs ›</span>
                  </button>
                ))}
                <p className="text-2xs text-slate-500 pt-1">Swarm restarted — the tasks it reset pick back up in a few seconds.</p>
              </div>
            </Modal>
          )}


          {shortcutsOpen && (
            <Modal
              isOpen
              onClose={() => setShortcutsOpen(false)}
              title="Keyboard shortcuts"
              icon={<Keyboard size={20} className="text-accent-600" />}
              maxW="sm:max-w-xs"
              featureId="shortcuts-help"
            >
              <div className="space-y-1.5">
                {[
                  { keys: ['n'], label: 'New task' },
                  { keys: ['/'], label: 'Search the context index' },
                  { keys: ['?'], label: 'Toggle this help' },
                ].map(({ keys, label }) => (
                  <div key={label} className="flex items-center justify-between gap-4 px-1 py-1.5">
                    <span className="text-xs text-slate-700">{label}</span>
                    <span className="flex items-center gap-1">
                      {keys.map(k => (
                        <kbd key={k} className="min-w-[22px] px-1.5 py-0.5 flex items-center justify-center rounded-md border border-slate-300 bg-slate-50 text-2xs font-bold text-slate-700 shadow-sm">{k}</kbd>
                      ))}
                    </span>
                  </div>
                ))}
                <p className="text-micro text-slate-500 pt-1">Shortcuts pause while you're typing in a field.</p>
              </div>
            </Modal>
          )}

          {isTaskModalOpen && (
            <TaskModal
              isOpen={isTaskModalOpen}
              onClose={() => setIsTaskModalOpen(false)}
              onSave={handleSaveTask}
              editingTask={editingTask}
              initialMode={taskModalMode}
              onCreated={fetchTasks}
            />
          )}

          {promptModal.open && (
            <PromptModal
              isOpen={promptModal.open}
              onClose={() => setPromptModal(p => ({ ...p, open: false }))}
              prompt={promptModal.prompt}
              taskTitle={promptModal.title}
              copied={promptModal.copied}
              onCopy={async () => {
                try {
                  await navigator.clipboard.writeText(promptModal.prompt);
                  setPromptModal(p => ({ ...p, copied: true }));
                } catch (_) { }
              }}
            />
          )}

          {gitOpen && <GitPanel isOpen={gitOpen} onClose={() => setGitOpen(false)} activeId={activeId} />}

          {isSettingsOpen && (
            <SettingsModal
              isOpen={isSettingsOpen}
              onClose={() => setIsSettingsOpen(false)}
              columns={columns}
              onSave={(cols) => { setColumns(cols); saveColumns(activeId, cols); }}
              hiddenTabs={hiddenTabs}
              onSetTabHidden={setTabHidden}
            />
          )}
        </AnimatePresence>

        <TerminalMonitor
          isOpen={terminal.open}
          minimized={terminal.minimized}
          onClose={() => setTerminal(t => ({ ...t, open: false }))}
          onMinimize={() => setTerminal(t => ({ ...t, minimized: !t.minimized }))}
          onMaximize={() => setTerminal(t => ({ ...t, minimized: false }))}
          output={terminal.output}
          agentName={terminal.agentName}
          taskId={terminal.taskId}
          bodyRef={terminalBodyRef}
        />
      </Suspense>

      {/* The floating status panel is gone. Its ambient half lives in the tank's status bar;
          its alarms (server unreachable, corrupt board) surface there too. */}
    </div>
  );
};

export default TasksPage;
