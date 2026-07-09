import React, { useState, useRef, useEffect, lazy, Suspense } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { HeartPulse, X, RefreshCw, Settings, Plus, ClipboardCheck, MessageSquarePlus, ChevronLeft, ChevronRight } from 'lucide-react';
import { TAB_META, loadHiddenTabs, saveHiddenTabs, type TabId } from './tasks/tabsConfig';

// Modular Components
import { useTasks } from './tasks/hooks/useTasks';
import { OrchestratorToggle } from './tasks/components/OrchestratorToggle';
import { Tooltip } from './tasks/components/Tooltip';
import { RecordButton } from './tasks/components/RecordButton';
import { TaskBoard } from './tasks/components/TaskBoard';
import { HumanTodos } from './tasks/components/HumanTodos';
import { Modal } from './tasks/components/Modal';
import { useToast } from './tasks/components/Toast';
import { useConfirm } from './tasks/components/ConfirmProvider';
import { ProjectBar } from './tasks/components/ProjectBar';
import { useProjects } from './tasks/projectContext';
import type { Task, Column } from './tasks/types';
import { loadColumns, saveColumns, BOARD_COLUMNS_EVENT } from './tasks/boardConfig';
import { API_BASE, withProject } from '../apiBase';
import { iconBtn, iconBtnLg } from './tasks/ui';

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
const ChatIntake = lazy(() => import('./tasks/components/ChatIntake'));
const LogsTab = lazy(() => import('./tasks/components/LogsTab'));
const DbTab = lazy(() => import('./tasks/components/DbTab'));
const AgentsTab = lazy(() => import('./tasks/components/AgentsTab'));
const GitPanel = lazy(() => import('./tasks/components/GitPanel').then(m => ({ default: m.GitPanel })));
const SystemStatus = lazy(() => import('./tasks/components/SystemStatus').then(m => ({ default: m.SystemStatus })));

const TasksPage: React.FC = () => {
  const navigate = useNavigate();
  const { activeId, projects } = useProjects();
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
  // Collapse the action cluster by default on phones so the tab strip keeps its room;
  // expanded from sm+ up to preserve the desktop header. Tap the chevron to reveal it.
  const [actionsOpen, setActionsOpen] = useState(
    () => typeof window === 'undefined' || !window.matchMedia || window.matchMedia('(min-width: 640px)').matches
  );
  const [chatOpen, setChatOpen] = useState(false);
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
  const handleAddTask = () => {
    setEditingTask(null);
    setIsTaskModalOpen(true);
  };

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
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-100 gap-4">
        <div className="w-12 h-12 border-4 border-accent-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-micro font-black uppercase tracking-widest text-slate-500">Waking the swarm…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800 selection:bg-accent-200 selection:text-accent-900">
      <ProjectBar onOpenGit={() => setGitOpen(true)} />

      <main className="max-w-[1600px] mx-auto">
      <div className="px-3 sm:px-4 pt-3">
        {/* Tab switcher — folder tabs whose active tab connects into the content panel below */}
        <div className="flex items-end gap-2 border-b border-slate-300" data-feature-id="tasks-tab-switcher">
          <div className="flex items-stretch gap-1 overflow-x-auto overflow-y-hidden custom-scrollbar min-w-0 flex-1 pb-px">
            {visibleTabs.map((t) => {
              const Icon = t.icon;
              const active = activeTab === t.id;
              return (
                <button
                  key={t.id}
                  data-feature-id={`tasks-tab-${t.id}`}
                  onClick={() => setActiveTab(t.id)}
                  className={`relative -mb-px shrink-0 flex items-center gap-1.5 px-4 min-h-control-lg text-xs font-bold uppercase tracking-widest rounded-t-lg border transition-colors ${active
                    ? 'z-10 bg-white border-slate-300 border-b-white text-accent-700 shadow-sm'
                    : 'border-transparent text-slate-500 sm:hover:text-slate-900 sm:hover:bg-slate-50'}`}
                >
                  {active && (
                    <>
                      {/* Neon accent sitting on the tab's bottom seam, glowing downward */}
                      <motion.span
                        layoutId="tasks-tab-underline"
                        transition={{ type: 'spring', stiffness: 500, damping: 38 }}
                        className="absolute left-3 right-3 -bottom-px h-[3px] rounded-full bg-gradient-to-r from-accent-400 via-accent-500 to-accent-400 shadow-[0_6px_14px_0_rgba(99,102,241,0.9),0_11px_26px_1px_rgba(99,102,241,0.6)]"
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
                  <Icon size={14} className={active ? 'text-accent-600' : ''} />
                  {t.label}
                  {t.closeable && (
                    <span
                      role="button"
                      tabIndex={0}
                      data-feature-id={`tasks-tab-close-${t.id}`}
                      title={`Hide ${t.label} — restore from Settings`}
                      onClick={(e) => { e.stopPropagation(); hideTab(t.id); }}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); hideTab(t.id); } }}
                      className="flex items-center justify-center min-w-control min-h-control -mr-2 ml-0.5 p-1 rounded text-slate-500 sm:hover:text-rose-600 sm:hover:bg-rose-50 transition-colors cursor-pointer"
                    >
                      <X size={12} />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {/* action cluster — icon-only + custom tooltips, collapsible via the chevron */}
          <div className="ml-auto shrink-0 flex items-center gap-1 pb-1.5 pl-1" data-feature-id="tasks-actions">
            <Tooltip label={actionsOpen ? 'Hide actions' : 'Show actions'}>
              <button
                onClick={() => setActionsOpen(o => !o)}
                aria-label={actionsOpen ? 'Hide actions' : 'Show actions'}
                data-feature-id="tasks-actions-toggle"
                className={iconBtnLg}
              >
                {actionsOpen ? <ChevronRight size={22} strokeWidth={2.5} /> : <ChevronLeft size={22} strokeWidth={2.5} />}
              </button>
            </Tooltip>
            {actionsOpen && (
              <div className="flex items-center gap-1">
                <OrchestratorToggle />
                <RecordButton />
                <Tooltip label={`Your Review${reviewQueue.length ? ` — ${reviewQueue.length} awaiting` : ''}`}>
                  <button
                    onClick={() => setTodosOpen(true)}
                    data-feature-id="tasks-open-todos"
                    aria-label="Your Review"
                    className={`${iconBtn} relative ${reviewQueue.length > 0 ? 'bg-amber-50 text-amber-700 border-amber-300 sm:hover:bg-amber-100' : ''}`}
                  >
                    <ClipboardCheck size={16} />
                    {reviewQueue.length > 0 && (
                      <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center text-micro font-black bg-amber-500 text-white rounded-full">{reviewQueue.length}</span>
                    )}
                  </button>
                </Tooltip>
                <Tooltip label="Refresh board">
                  <button onClick={fetchTasks} aria-label="Refresh board" className={`${iconBtn} ${loading ? 'animate-spin text-accent-600' : ''}`}>
                    <RefreshCw size={16} />
                  </button>
                </Tooltip>
                <Tooltip label="Unstick — restart stalled tasks">
                  <button onClick={handleHeal} disabled={healing} data-feature-id="tasks-heal" aria-label="Heal" className={iconBtn}>
                    <HeartPulse size={16} className={healing ? 'animate-pulse' : ''} />
                  </button>
                </Tooltip>
                <Tooltip label="Describe work, get tasks">
                  <button onClick={() => setChatOpen(true)} data-feature-id="tasks-chat-create" aria-label="Chat to Tasks" className={iconBtn}>
                    <MessageSquarePlus size={16} />
                  </button>
                </Tooltip>
                <Tooltip label="Settings">
                  <button onClick={() => setIsSettingsOpen(true)} data-feature-id="tasks-open-settings" aria-label="Settings" className={iconBtn}>
                    <Settings size={16} />
                  </button>
                </Tooltip>
                <Tooltip label="New task">
                  <button onClick={() => handleAddTask()} aria-label="New task" className={iconBtn}>
                    <Plus size={16} strokeWidth={3} />
                  </button>
                </Tooltip>
              </div>
            )}
          </div>
        </div>

        {/* Content panel — bordered box connected to the active tab (its bottom border is open) */}
        <div className="border border-t-0 border-slate-300 rounded-b-xl bg-white overflow-hidden">
        {error && (
          <div className="m-6 p-4 bg-rose-50 border border-rose-200 rounded-xl flex items-center justify-between">
            <span className="text-xs font-bold text-rose-600 uppercase tracking-widest">Error: {error}</span>
            <button onClick={fetchTasks} className="text-micro font-black underline uppercase tracking-tighter text-rose-600">Try again</button>
          </div>
        )}

        {activeTab === 'context' ? (
          <Suspense fallback={<div className="p-8 text-center text-xs font-bold uppercase tracking-widest text-slate-400">Loading context…</div>}>
            <ContextTab activeId={activeId} view={contextView} onViewChange={setContextView} />
          </Suspense>
        ) : activeTab === 'analytics' ? (
          <Suspense fallback={<div className="p-8 text-center text-xs font-bold uppercase tracking-widest text-slate-400">Loading analytics…</div>}>
            <AnalyticsTab tasks={tasks} />
          </Suspense>
        ) : activeTab === 'logs' ? (
          <Suspense fallback={<div className="p-8 text-center text-xs font-bold uppercase tracking-widest text-slate-400">Loading logs…</div>}>
            <LogsTab initialAgent={logsAgent} />
          </Suspense>
        ) : activeTab === 'db' ? (
          <Suspense fallback={<div className="p-8 text-center text-xs font-bold uppercase tracking-widest text-slate-400">Loading database…</div>}>
            <DbTab />
          </Suspense>
        ) : activeTab === 'agents' ? (
          <Suspense fallback={<div className="p-8 text-center text-xs font-bold uppercase tracking-widest text-slate-400">Loading agents…</div>}>
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
          onAddTask={handleAddTask}
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

          {chatOpen && (
            <ChatIntake isOpen={chatOpen} onClose={() => setChatOpen(false)} onCreated={fetchTasks} />
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


          {isTaskModalOpen && (
            <TaskModal
              isOpen={isTaskModalOpen}
              onClose={() => setIsTaskModalOpen(false)}
              onSave={handleSaveTask}
              editingTask={editingTask}
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

      <Suspense fallback={null}>
        <SystemStatus activeId={activeId} />
      </Suspense>
    </div>
  );
};

export default TasksPage;
