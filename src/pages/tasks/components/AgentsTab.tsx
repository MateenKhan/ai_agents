import React, { useEffect, useState } from 'react';
import { Tooltip } from './Tooltip';
import { Bot, Save, Plus, Trash2, RotateCcw, Power, Cpu, GitBranch, X, ArrowRight, UserCheck, FileText, ShieldCheck, Activity, Zap, Stethoscope, Workflow as WorkflowIcon, ChevronDown, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Modal } from './Modal';
import { useConfirm } from './ConfirmProvider';
import { useToast } from './Toast';
import { API_BASE as API } from '../../../apiBase';
// Same skill map the orchestrator injects into prompts (dependency-free module) — so
// the UI shows exactly which superpowers each role runs, with no drift.
import { skillsForRole, SKILL_DESCRIPTIONS } from '../../../../agentic/methodology/superpowers';
import { btnPrimary, btnPrimarySm, btnGhost, inputCls, selectCls, textareaCls, selectSm, iconBtnDanger } from '../ui';

/**
 * Agents tab — edit the pipeline's role config (prompt + model + worktree + enabled),
 * add custom agents, reset to shipped defaults. All persisted in the DB; the
 * orchestrator re-reads within ~10s so edits apply live.
 */

// Model aliases the Claude Code CLI resolves to the latest of each tier (future-proof —
// no dated ids to rot). The runner passes the chosen value straight to `claude --model`.
const MODELS: { v: string; label: string }[] = [
  { v: 'opus', label: 'Opus — deepest reasoning' },
  { v: 'sonnet', label: 'Sonnet — balanced (default)' },
  { v: 'haiku', label: 'Haiku — fastest / cheapest' },
];

// Small skill chip — one superpowers skill the role leads with.
function SkillChip({ name }: { name: string }) {
  return (
    <span
      title={SKILL_DESCRIPTIONS[name] || 'superpowers skill'}
      className="inline-flex items-center gap-1 text-[10px] font-bold text-ai-700 px-1.5 py-0.5 bg-ai-50 rounded border border-ai-200"
    >
      <Sparkles size={9} /> {name}
    </span>
  );
}
const WORKTREES = [
  { v: 'plan', d: 'read-only isolated (architect)' },
  { v: 'create', d: 'own task branch (dev)' },
  { v: 'reuse', d: "dev's branch (qa)" },
  { v: 'none', d: 'main repo (merge)' },
];

const PLACEHOLDERS = ['id', 'title', 'description', 'dod', 'plan', 'summary', 'reviewNote', 'qaReport', 'testUrl', 'staleWarnings', 'previousError', 'gitRules', 'searchProtocol'];

interface Agent {
  role: string; label: string; enabled: number; model: string;
  worktreeMode: string; ord: number; isSystem: number; promptTemplate: string;
  mergePromptTemplate?: string;
}

export default function AgentsTab() {
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [editing, setEditing] = useState<Agent | null>(null);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [openGuard, setOpenGuard] = useState<string | null>(null);
  const [openStep, setOpenStep] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();
  const toast = useToast();

  const load = () => fetch(`${API}/agents`).then(r => r.json()).then(d => setAgents(d.agents ?? [])).catch(() => setAgents([]));
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      await fetch(`${API}/agents`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editing) });
      setEditing(null); load();
    } finally { setBusy(false); }
  };

  const toggle = async (a: Agent) => {
    await fetch(`${API}/agents`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...a, enabled: a.enabled ? 0 : 1 }) });
    load();
  };

  // Quick model change straight from the card (no need to open the editor).
  const setModel = async (a: Agent, model: string) => {
    if (model === a.model) return;
    setAgents(prev => prev?.map(x => x.role === a.role ? { ...x, model } : x) ?? prev); // optimistic
    try {
      await fetch(`${API}/agents`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...a, model }) });
      toast.success('Model updated', `${a.label || a.role} → ${model}`);
    } catch (e: any) { toast.error('Update failed', e?.message); load(); }
  };

  const del = async (role: string) => {
    const ok = await confirm({
      title: 'Delete agent?',
      message: `Delete custom agent "${role}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    try { await fetch(`${API}/agents/${encodeURIComponent(role)}`, { method: 'DELETE' }); load(); toast.success('Agent deleted', role); }
    catch (e: any) { toast.error('Delete failed', e?.message); }
  };

  const reset = async () => {
    const ok = await confirm({
      title: 'Reset to shipped defaults?',
      message: 'Reset all built-in roles to their shipped default prompts, models and workspaces. Custom agents are kept.',
      confirmLabel: 'Reset',
      tone: 'default',
    });
    if (!ok) return;
    try { await fetch(`${API}/agents/reset`, { method: 'POST' }); load(); toast.success('Agents reset to defaults'); }
    catch (e: any) { toast.error('Reset failed', e?.message); }
  };

  const addCustom = () => setEditing({ role: '', label: '', enabled: 1, model: 'sonnet', worktreeMode: 'create', ord: 99, isSystem: 0, promptTemplate: 'Task: {{title}} ({{id}})\nDoD:\n{{dod}}\n\nWhen done: curl -X PUT http://127.0.0.1:6952/tasks/{{id}} -H "Content-Type: application/json" -d \'{"status":"TESTING"}\'' });

  // Workflow = enabled agents in `ord` order. The pipeline threads a task through them.
  const flow = (agents ?? []).filter(a => a.enabled).sort((a, b) => a.ord - b.ord);

  // Pseudo-code of the pipeline — each step with its exact DB writes.
  const STEPS: { label: string; who: string; lines: string[] }[] = [
    { label: '1 · CREATE', who: 'human', lines: [
      'tasks INSERT  id, title, description,',
      '              scenarios=[{given,when,then}], status="TODO", priority' ] },
    { label: '2 · LAUNCH', who: 'human ▶', lines: [
      'GATE   refuse if scenarios empty',
      'tasks  SET status="WORKING", started=NULL, claimedBy=NULL, stage=NULL',
      'board_settings SET agentStatus="STARTING"   // auto-wake orchestrator' ] },
    { label: '3 · ROUTE', who: 'orchestrator · every 3s', lines: [
      'if stage IS NULL → tasks SET stage = architect_on ? "plan" : "build"' ] },
    { label: '4 · PLAN', who: 'Architect · opus · read-only worktree', lines: [
      'tasks SET claimedBy="agent-N (architect)", attempts+=1,',
      '          leaseExpiresAt=now+15m, model="opus"',
      'agent → tasks SET plan="<steps>", stage="build"',
      'logs.db.agent_logs INSERT (taskId, message, type)' ] },
    { label: '5 · BUILD', who: 'Developer · sonnet · branch task/<id>', lines: [
      'tasks SET claimedBy="agent-N (dev)"',
      'agent commits code → git branch task/<id>   (never pushes)',
      'agent → tasks SET summary="WHAT I DID / HOW TO VERIFY / WATCH OUT",',
      '                  status="TESTING"' ] },
    { label: '6 · QA GATE', who: 'orchestrator', lines: [
      'tasks SET qaVerdict="pending"   // dev done → QA first, not you' ] },
    { label: '7 · VERIFY', who: 'QA · sonnet · dev branch', lines: [
      'tasks SET qaVerdict="running", claimedBy="agent-N (qa)"',
      'agent runs each scenario THEN →',
      'PASS → tasks SET qaVerdict="pass", qaReport="<per-scenario result>"',
      'FAIL → tasks SET qaVerdict="fail", qaReport="<why>"',
      '       then status="WORKING", stage="plan", reviewNote=qaReport' ] },
    { label: '⤴ RESCUE', who: 'orchestrator → Architect · on repeated dev/qa failure', lines: [
      'GATE   infra check — if db-server 6952 is DOWN the callback could not land:',
      '       that is NOT the agent → pause, heal db, requeue SAME stage (no attempt burned)',
      'else, dev/qa exhausted retries → tasks SET stage="rescue", attempts=0, rescueCount+=1',
      'Architect (read-only) diagnoses + re-plans →',
      '       tasks SET summary="<revised brief>", stage="build"   // back to dev',
      'rescueCount > RESCUE_MAX → status="BLOCKED"   // re-plan failed too, needs a human' ] },
    { label: '8 · REVIEW', who: 'You · only qaVerdict="pass" shown', lines: [
      'APPROVE → tasks SET status="DONE", completed=now, stage="merge"',
      'REJECT  → tasks SET status="WORKING", stage="plan", reviewNote=<you>,',
      '                    attempts=0, qaVerdict=NULL' ] },
    { label: '9 · MERGE', who: 'same Architect · opus · main repo', lines: [
      'tasks SET stage="merging"',
      'agent: git merge --no-ff task/<id>  (resolves conflicts, runs tsc)',
      'agent → tasks SET stage="merged"   (or "merge-failed")',
      'orchestrator: remove worktree, delete branch, refresh index,',
      '              logs.db.agent_logs DELETE WHERE taskId=<id>' ] },
  ];
  const GUARD_WRITES = [
    'Watchdog   renews tasks.leaseExpiresAt; on death/stall →',
    '           tasks SET started=NULL, claimedBy=NULL  (retry)',
    'Backoff    tasks SET nextRetryAt, lastError, attempts;',
    '           dev/qa exhausted → Architect RESCUE (re-plan) → then BLOCKED',
    'DB heal    agent callback fails + 6952 down → pause, restart db,',
    '           auto-resume SAME stage  (infra fault ≠ agent fault)',
    'Heal       reconciles bad tasks rows every 2m + on boot',
    'Heartbeat  board_settings["heartbeat"] every 60s (liveness)',
  ];

  const codeLine = (l: string, i: number) => (
    <div key={i} className="whitespace-pre">
      {l.split(/(tasks\b|board_settings|logs\.db\.agent_logs|SET|INSERT|DELETE|GATE|if|→|\/\/.*)/g).map((tok, j) => {
        let cls = 'text-slate-700';
        if (/^(tasks|board_settings|logs\.db\.agent_logs)$/.test(tok)) cls = 'text-cyan-700 font-bold';
        else if (/^(SET|INSERT|DELETE|GATE|if)$/.test(tok)) cls = 'text-fuchsia-700 font-bold';
        else if (tok === '→') cls = 'text-emerald-600';
        else if (/^\/\//.test(tok)) cls = 'text-slate-500 italic';
        return <span key={j} className={cls}>{tok}</span>;
      })}
    </div>
  );

  const GUARDS = [
    { icon: <Activity size={15} />, label: 'Watchdog + stall killer', desc: 'The heart of the system. Every agent holds a 15-min lease renewed while it works; if an agent dies silently the watchdog reclaims its task and retries. It also kills any agent that goes quiet — no output for 8 min = stuck, not working — and requeues it. Nothing stays stuck In Progress forever.' },
    { icon: <Zap size={15} />, label: 'Circuit breaker', desc: 'Watches for API/network failure. After a few failed dispatches it OPENS — pausing all agents, leaving tasks safely queued in SQLite — then probes every 60s and auto-resumes the moment Claude is reachable again. An outage costs time, never work.' },
    { icon: <Stethoscope size={15} />, label: 'Auto-heal', desc: 'Every 2 minutes and on every boot it reconciles task state against reality: re-queues zombies, clears stale claims, bounces tasks with no scenarios. Survives crashes and power cuts — restart and it picks up where it left off.' },
    { icon: <ShieldCheck size={15} />, label: 'Resource gate', desc: 'Reads live CPU/RAM of the host and pauses new agent spawns above the limits, so the pipeline never takes the machine (VPS or laptop) down. Auto-detects hardware — no config.' },
    { icon: <GitBranch size={15} />, label: 'DB self-heal + Architect rescue', desc: 'The agents reach the db-server (6952) to advance their stage and query the code index. If it goes down, an agent that finished looks like it "failed" — so the orchestrator probes it, and on an infra fault it pauses, restarts the db-server, and resumes the SAME stage without burning a retry or blaming the agent. And when a dev or QA genuinely exhausts its retries, the Architect steps in for one re-plan pass — diagnosing the failure and handing a fresh brief back to the dev — before anything is marked Blocked.' },
    { icon: <Stethoscope size={15} />, label: 'Call-for-help + Architect triage', desc: 'A stuck dev or QA can raise its hand the instant it hits a wall — handing the task straight back for a re-plan instead of thrashing through retries. And on a timer (default every 5 min) the orchestrator wakes ONE Architect in read-only triage mode to review a project\'s in-flight tasks in a single batched pass, nudging or re-planning the stuck ones — an architect overseeing ~5 tasks without a process burning tokens 24/7. Reviewed tasks are frozen from dispatch so triage never races a live worker.' },
  ];

  const WorkflowFlow = () => (
    <div className="flex items-center gap-1 flex-wrap">
          <div className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 border border-slate-200 rounded-lg text-xs font-bold text-slate-600"><FileText size={13} /> Task</div>
          {flow.map((a) => (
            <React.Fragment key={a.role}>
              <ArrowRight size={16} className="text-slate-400 shrink-0" />
              <Tooltip label={`${a.label} · ${a.model} · click to edit`}><button
                onClick={() => setEditing(a)}
                data-feature-id="agents-workflow-node"
                className="flex items-center gap-1.5 px-3 py-2 bg-accent-50 border-2 border-accent-200 rounded-lg text-xs font-bold text-accent-800 hover:bg-accent-100 hover:border-accent-400 transition-colors"
              >
                <Bot size={13} className="text-accent-600" /> {a.label}
                <span className="text-[9px] font-mono text-accent-500 bg-white px-1 rounded">{a.model}</span>
              </button></Tooltip>
            </React.Fragment>
          ))}
          <ArrowRight size={16} className="text-slate-400 shrink-0" />
          <div className="flex items-center gap-1.5 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg text-xs font-bold text-emerald-700"><UserCheck size={13} /> You (review)</div>
          {/* Merge is the SAME architect doing a second job */}
          {(agents ?? []).find(a => a.role === 'architect') && (
            <>
              <ArrowRight size={16} className="text-slate-400 shrink-0" />
              <Tooltip label="The same Architect merges the approved branch — click to edit its merge prompt"><button onClick={() => setEditing((agents ?? []).find(a => a.role === 'architect')!)}
                data-feature-id="agents-workflow-merge"
                className="flex items-center gap-1.5 px-3 py-2 bg-accent-50 border-2 border-dashed border-accent-300 rounded-lg text-xs font-bold text-accent-800 hover:bg-accent-100 transition-colors">
                <GitBranch size={13} className="text-accent-600" /> Architect merges
              </button></Tooltip>
            </>
          )}
    </div>
  );

  return (
    <div className="p-3 sm:p-4 space-y-4" data-feature-id="tasks-agents-tab">
      <div className="flex items-center gap-2 flex-wrap">
        <p className="text-sm text-slate-600">Configure each role's model, prompt, and workspace. Edits apply within ~10s.</p>
        <div className="ml-auto flex gap-2">
          <button onClick={() => setWorkspaceOpen(true)} data-feature-id="agents-workspace-btn" className="flex items-center gap-1.5 px-3 min-h-control text-xs font-bold bg-white text-accent-700 border border-accent-300 rounded-lg hover:bg-accent-50"><WorkflowIcon size={14} /> Workspace</button>
          <button onClick={addCustom} className={btnPrimarySm}><Plus size={14} /> Custom agent</button>
          <button onClick={reset} className="flex items-center gap-1.5 px-3 min-h-control text-xs font-bold bg-white text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50"><RotateCcw size={14} /> Reset defaults</button>
        </div>
      </div>

      {/* ── Workspace popup: workflow + supervisor guards (animated Modal) ── */}
      <AnimatePresence>
        {workspaceOpen && (
          <Modal isOpen onClose={() => setWorkspaceOpen(false)} title="Workspace" subtitle="Pipeline & the always-on supervisor" icon={<WorkflowIcon size={20} className="text-accent-600" />} maxW="sm:max-w-3xl" featureId="agents-workspace-popup">
            <div className="space-y-5">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-black uppercase tracking-widest text-slate-700">Workflow</h4>
                  <span className="text-[11px] text-slate-500">click a stage to edit it</span>
                </div>
                <WorkflowFlow />
                <p className="text-[11px] text-slate-500 mt-2.5">Disabled stages are skipped. Toggle a role's power button in the list to add/remove it, or reorder via each stage's order field.</p>
              </div>

              {/* Pseudo-code: the pipeline as DB writes */}
              <div>
                <p className="text-[11px] font-black uppercase tracking-widest text-slate-500 mb-1">Pipeline as DB writes</p>
                <p className="text-[11px] text-slate-500 mb-3">Exactly what each step writes — <span className="font-mono text-cyan-700">table</span>, column, value. This is the ground truth of the framework. Click a step to expand its writes.</p>
                <div className="space-y-2">
                  {STEPS.map(s => {
                    const open = openStep === s.label;
                    return (
                      <div key={s.label} className={`border rounded-xl overflow-hidden transition-colors ${open ? 'border-amber-300 bg-amber-50/40' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                        <button
                          onClick={() => setOpenStep(open ? null : s.label)}
                          className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left"
                          data-feature-id="agents-pipeline-accordion"
                        >
                          <span className="text-[12px] font-black font-mono text-amber-700">{s.label}</span>
                          <span className="text-[11px] text-slate-500 truncate">— {s.who}</span>
                          <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }} className="ml-auto shrink-0 text-slate-400"><ChevronDown size={16} /></motion.span>
                        </button>
                        <AnimatePresence initial={false}>
                          {open && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.22, ease: 'easeOut' }}
                              className="overflow-hidden"
                            >
                              <div className="px-3.5 pb-3 pt-0 overflow-x-auto custom-scrollbar font-mono text-[11px] leading-relaxed">
                                <div className="pl-2 border-l-2 border-amber-200">{s.lines.map(codeLine)}</div>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    );
                  })}
                  {/* Guards writes — same accordion, keyed by its own label */}
                  {(() => {
                    const label = 'GUARDS · always-on, deterministic';
                    const open = openStep === label;
                    return (
                      <div className={`border rounded-xl overflow-hidden transition-colors ${open ? 'border-emerald-300 bg-emerald-50/40' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                        <button
                          onClick={() => setOpenStep(open ? null : label)}
                          className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left"
                          data-feature-id="agents-pipeline-accordion"
                        >
                          <span className="text-[12px] font-black font-mono text-emerald-700">{label}</span>
                          <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }} className="ml-auto shrink-0 text-slate-400"><ChevronDown size={16} /></motion.span>
                        </button>
                        <AnimatePresence initial={false}>
                          {open && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.22, ease: 'easeOut' }}
                              className="overflow-hidden"
                            >
                              <div className="px-3.5 pb-3 pt-0 overflow-x-auto custom-scrollbar font-mono text-[11px] leading-relaxed">
                                <div className="pl-2 border-l-2 border-emerald-200">{GUARD_WRITES.map(codeLine)}</div>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    );
                  })()}
                </div>
              </div>

              <div>
                <p className="text-[11px] font-black uppercase tracking-widest text-slate-500 mb-1">The Supervisor — always-on guards</p>
                <p className="text-[11px] text-slate-500 mb-3">Plain deterministic code (no LLM) — keeps working even when the Claude API is down. Agents can crash or hang; the board still converges to truth on its own.</p>
                <div className="space-y-2">
                  {GUARDS.map(g => {
                    const open = openGuard === g.label;
                    return (
                      <div key={g.label} className={`border rounded-xl overflow-hidden transition-colors ${open ? 'border-accent-300 bg-accent-50/40' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                        <button
                          onClick={() => setOpenGuard(open ? null : g.label)}
                          className="w-full flex items-center gap-2.5 px-3.5 py-3 text-left"
                          data-feature-id="agents-guard-accordion"
                        >
                          <span className={`w-8 h-8 flex items-center justify-center rounded-lg ${open ? 'bg-emerald-100 text-emerald-700' : 'bg-emerald-50 text-emerald-600'}`}>{g.icon}</span>
                          <span className="text-[13px] font-bold text-slate-800">{g.label}</span>
                          <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }} className="ml-auto text-slate-400"><ChevronDown size={16} /></motion.span>
                        </button>
                        <AnimatePresence initial={false}>
                          {open && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.22, ease: 'easeOut' }}
                              className="overflow-hidden"
                            >
                              <p className="px-3.5 pb-3.5 pt-0 text-[12px] text-slate-600 leading-relaxed">{g.desc}</p>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </Modal>
        )}
      </AnimatePresence>

      {agents === null ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {agents.map(a => (
            <div key={a.role} className={`bg-white border-2 rounded-xl p-4 space-y-3 shadow-sm ${a.enabled ? 'border-slate-200' : 'border-slate-200 opacity-60'}`}>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 flex items-center justify-center bg-accent-50 border border-accent-200 rounded-lg"><Bot size={18} className="text-accent-600" /></div>
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-slate-900">{a.label || a.role} {a.isSystem ? '' : <span className="text-[10px] font-black text-accent-600">CUSTOM</span>}</h3>
                  <p className="text-[11px] font-mono text-slate-500">{a.role}</p>
                </div>
                <div className="ml-auto flex items-center gap-1.5">
                  <Tooltip label={a.enabled ? 'Enabled' : 'Disabled'}><button onClick={() => toggle(a)} className={`p-2 rounded-lg border transition-colors ${a.enabled ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-slate-100 text-slate-400 border-slate-200'}`}><Power size={14} /></button></Tooltip>
                  <Tooltip label="Edit"><button onClick={() => setEditing(a)} className="p-2 rounded-lg bg-slate-50 text-slate-600 border border-slate-200 hover:bg-slate-100"><Save size={14} /></button></Tooltip>
                  {!a.isSystem && <Tooltip label="Delete"><button onClick={() => del(a.role)} className={iconBtnDanger}><Trash2 size={14} /></button></Tooltip>}
                </div>
              </div>
              <div className="flex items-center gap-3 text-xs">
                {/* Inline model picker — change the model without opening the editor */}
                <label className="flex items-center gap-1 text-slate-700" title="Model — applies within ~10s">
                  <Cpu size={12} className="text-accent-500" />
                  <select
                    value={a.model}
                    onChange={e => setModel(a, e.target.value)}
                    data-feature-id={`agent-model-${a.role}`}
                    className={`${selectSm} w-auto`}
                  >
                    {/* Include the current value even if it's a custom/unknown model string. */}
                    {!MODELS.some(m => m.v === a.model) && <option value={a.model}>{a.model}</option>}
                    {MODELS.map(m => <option key={m.v} value={m.v}>{m.v}</option>)}
                  </select>
                </label>
                <span className="flex items-center gap-1 text-slate-700"><GitBranch size={12} className="text-emerald-500" /> {a.worktreeMode}</span>
              </div>
              {/* Superpowers — the skills this role leads with (from the shared skill map) */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">Superpowers</span>
                {skillsForRole(a.role).map(s => <SkillChip key={s} name={s} />)}
              </div>
              <p className="text-[11px] text-slate-500 font-mono bg-slate-50 border border-slate-200 rounded-lg p-2 line-clamp-3 whitespace-pre-wrap">{a.promptTemplate}</p>
            </div>
          ))}
        </div>
      )}

      {/* Editor modal */}
      {editing && (
        <Modal
          isOpen
          onClose={() => setEditing(null)}
          title={editing.isSystem ? `Edit ${editing.label}` : editing.role ? `Edit ${editing.role}` : 'New custom agent'}
          icon={<Bot size={18} className="text-accent-600" />}
          maxW="sm:max-w-2xl"
          featureId="agent-editor"
          footer={
            <div className="flex justify-end gap-2 w-full">
              <button onClick={() => setEditing(null)} className={btnGhost}>Cancel</button>
              <button onClick={save} disabled={busy || !editing.role} className={btnPrimary}><Save size={14} /> Save</button>
            </div>
          }
        >
          <div className="space-y-4">
              {!editing.isSystem && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-bold uppercase text-slate-600">Role id</label>
                    <input value={editing.role} onChange={e => setEditing({ ...editing, role: e.target.value.replace(/[^\w-]/g, '') })} className={`${inputCls} mt-1 font-mono`} placeholder="reviewer" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase text-slate-600">Label</label>
                    <input value={editing.label} onChange={e => setEditing({ ...editing, label: e.target.value })} className={`${inputCls} mt-1`} placeholder="Reviewer" />
                  </div>
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold uppercase text-slate-600">Model</label>
                  <select value={editing.model} onChange={e => setEditing({ ...editing, model: e.target.value })} className={`${selectCls} mt-1`}>
                    {!MODELS.some(m => m.v === editing.model) && <option value={editing.model}>{editing.model}</option>}
                    {MODELS.map(m => <option key={m.v} value={m.v}>{m.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase text-slate-600">Workspace</label>
                  <select value={editing.worktreeMode} onChange={e => setEditing({ ...editing, worktreeMode: e.target.value })} className={`${selectCls} mt-1`}>
                    {WORKTREES.map(w => <option key={w.v} value={w.v}>{w.v} — {w.d}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold uppercase text-slate-600">Workflow order</label>
                  <input type="number" value={editing.ord} onChange={e => setEditing({ ...editing, ord: parseInt(e.target.value) || 0 })} className={`${inputCls} mt-1`} />
                  <p className="text-[10px] text-slate-500 mt-0.5">lower = earlier in the flow</p>
                </div>
                <div className="flex items-end pb-1">
                  <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                    <input type="checkbox" checked={!!editing.enabled} onChange={e => setEditing({ ...editing, enabled: e.target.checked ? 1 : 0 })} className="w-4 h-4 accent-emerald-600" />
                    Enabled (part of the workflow)
                  </label>
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase text-slate-600">{editing.role === 'architect' ? 'Plan prompt (job 1: planning)' : 'Prompt template'}</label>
                <textarea value={editing.promptTemplate} onChange={e => setEditing({ ...editing, promptTemplate: e.target.value })} rows={editing.role === 'architect' ? 12 : 16} className={`${textareaCls} mt-1 text-xs font-mono`} />
                <p className="text-[10px] text-slate-500 mt-1.5">Placeholders (filled per task): {PLACEHOLDERS.map(p => <code key={p} className="mx-0.5 px-1 bg-slate-100 rounded text-accent-700">{`{{${p}}}`}</code>)}</p>
              </div>

              {/* Superpowers — auto-injected ahead of the prompt above by the orchestrator */}
              <div className="rounded-lg border border-ai-200 bg-ai-50/50 p-3">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Sparkles size={13} className="text-ai-600" />
                  <span className="text-[10px] font-black uppercase tracking-wider text-ai-700">Superpowers skills</span>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {skillsForRole(editing.role || 'custom').map(s => <SkillChip key={s} name={s} />)}
                </div>
                <p className="text-[10px] text-slate-500 mt-2">Auto-prepended to this prompt at dispatch, telling the agent which <a href="https://github.com/obra/superpowers" target="_blank" rel="noreferrer" className="text-ai-700 underline">superpowers</a> skills to lead with. Requires superpowers installed in the agent runtime.</p>
              </div>
              {editing.role === 'architect' && (
                <div>
                  <label className="text-[10px] font-bold uppercase text-slate-600">Merge prompt (job 2: same architect merges the approved branch)</label>
                  <textarea value={editing.mergePromptTemplate || ''} onChange={e => setEditing({ ...editing, mergePromptTemplate: e.target.value })} rows={12} className={`${textareaCls} mt-1 text-xs font-mono`} />
                  <p className="text-[10px] text-slate-500 mt-1.5">The architect who planned the task also merges it after your approval — one agent, both jobs.</p>
                </div>
              )}
          </div>
        </Modal>
      )}
    </div>
  );
}
