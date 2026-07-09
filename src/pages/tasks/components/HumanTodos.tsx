import React, { useState } from 'react';
import { X, CheckCircle2, XCircle, GitBranch, ClipboardCheck, AlertCircle, BookOpen, ChevronDown, ExternalLink, Loader2, Eye, Search } from 'lucide-react';
import type { Task } from '../types';
import { API_BASE } from '../../../apiBase';
import { SlideOver } from './SlideOver';

interface HumanTodosProps {
  isOpen: boolean;
  tasks: Task[]; // tasks in TESTING awaiting human verification
  onClose: () => void;
  onApprove: (taskId: string) => void;
  onReject: (taskId: string, feedback: string, updatedDod?: string) => void;
}

/**
 * Human Todos — the review inbox, sized for real reviewing (~65% of screen on
 * desktop, full screen on mobile). Everything needed to approve lives inline:
 * agent summary, context, full DoD checklist, and the full spec text on demand.
 */
export function HumanTodos({ isOpen, tasks, onClose, onApprove, onReject }: HumanTodosProps) {
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');
  const [updatedDod, setUpdatedDod] = useState('');
  const [specs, setSpecs] = useState<Record<string, string | null>>({}); // specName → content
  const [previews, setPreviews] = useState<Record<string, { status: string; url?: string; port?: number; apiPort?: number; error?: string; logTail?: string; logName?: string }>>({});
  const [query, setQuery] = useState('');
  // A single task opens automatically; a queue stays collapsed so it can be skimmed.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(tasks.length === 1 ? [tasks[0].id] : []));
  const toggle = (id: string) => setExpanded(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const pollPreview = (taskId: string) => {
    fetch(`${API_BASE}/tasks/${taskId}/preview`)
      .then(r => r.json())
      .then(d => {
        setPreviews(p => ({ ...p, [taskId]: d }));
        if (d.status === 'building') setTimeout(() => pollPreview(taskId), 2000);
      })
      .catch(() => {});
  };
  const buildPreview = (taskId: string) => {
    setPreviews(p => ({ ...p, [taskId]: { status: 'building' } }));
    fetch(`${API_BASE}/tasks/${taskId}/preview`, { method: 'POST' })
      .then(() => setTimeout(() => pollPreview(taskId), 1500))
      .catch(() => setPreviews(p => ({ ...p, [taskId]: { status: 'error', error: 'failed to start' } })));
  };

  if (!isOpen) return null;

  const startReject = (task: Task) => {
    setRejectingId(task.id);
    setFeedback('');
    setUpdatedDod(task.dod || '');
  };

  const submitReject = (taskId: string) => {
    if (!feedback.trim()) return;
    onReject(taskId, feedback.trim(), updatedDod.trim() || undefined);
    setRejectingId(null);
    setFeedback('');
    setUpdatedDod('');
  };

  const dodLines = (dod?: string | null) =>
    (dod || '').split('\n').map(l => l.replace(/^[-*•]\s*/, '').trim())
      .filter(l => l && !/^HOW TO VERIFY/i.test(l)); // header line is rendered separately

  /** Split an agent summary into its structured sections (WHAT I DID / HOW TO VERIFY / WATCH OUT). */
  const parseSummary = (summary: string) => {
    const grab = (label: string) => {
      const m = summary.match(new RegExp(`${label}\\s*:?\\s*([\\s\\S]*?)(?=(WHAT I DID|HOW TO VERIFY[^:]*|WATCH OUT)\\s*:|$)`, 'i'));
      return m?.[1].trim() || null;
    };
    const what = grab('WHAT I DID');
    const verify = grab('HOW TO VERIFY[^:]*');
    const watch = grab('WATCH OUT');
    const structured = Boolean(what || verify);
    const verifySteps = (verify || '')
      .split(/\n|(?=\d+\.\s)/)
      .map(s => s.replace(/^\d+\.\s*/, '').replace(/^[-*•]\s*/, '').trim())
      .filter(Boolean);
    return { structured, what, verifySteps, watch };
  };

  /** Numbered verify steps from a task: prefer the agent summary, fall back to DoD lines. */
  const verifySteps = (task: Task): string[] => {
    if (task.summary) {
      const p = parseSummary(task.summary);
      if (p.verifySteps.length > 0) return p.verifySteps;
    }
    // DoD lines that read like steps (numbered or command-like)
    return dodLines(task.dod).map(l => l.replace(/^\d+\.\s*/, ''));
  };

  const specName = (task: Task) => {
    const m = task.dod?.match(/(?:Full spec|spec):\s*(?:next_changes\/specs\/)?([\w.\-]+\.md)/i);
    return m?.[1] ?? null;
  };

  const loadSpec = (name: string) => {
    if (specs[name] !== undefined) return;
    setSpecs(s => ({ ...s, [name]: null })); // loading marker
    fetch(`${API_BASE}/spec/${encodeURIComponent(name)}`)
      .then(r => r.json())
      .then(d => setSpecs(s => ({ ...s, [name]: d.content ?? '(spec file not found)' })))
      .catch(() => setSpecs(s => ({ ...s, [name]: '(failed to load spec)' })));
  };

  /**
   * Extract ONLY the spec fragments the DoD actually references (AC2, Step 4, …),
   * so the reviewer never reads a whole document for one point.
   */
  const extractRelevant = (spec: string, dod?: string | null): Array<{ label: string; text: string }> => {
    const out: Array<{ label: string; text: string }> = [];
    const refs = new Set<string>();
    for (const m of (dod || '').matchAll(/AC\s?(\d+)/gi)) refs.add(`AC${m[1]}`);
    for (const m of (dod || '').matchAll(/Step\s+(\d+)/gi)) refs.add(`Step ${m[1]}`);

    const lines = spec.split('\n');

    // Pull the block for each referenced token: from its line until the next
    // AC/Step/heading boundary (max 12 lines).
    for (const ref of refs) {
      const isAC = ref.startsWith('AC');
      const pattern = isAC
        ? new RegExp(`\\*\\*${ref}\\*\\*|\\b${ref}\\b`, 'i')
        : new RegExp(`(^#+\\s*.*${ref}|^\\s*${ref.replace('Step ', '')}\\.\\s|\\b${ref}\\b)`, 'i');
      const idx = lines.findIndex(l => pattern.test(l));
      if (idx === -1) continue;
      const block: string[] = [];
      for (let i = idx; i < Math.min(idx + 12, lines.length); i++) {
        if (i > idx && (/^#{1,3}\s/.test(lines[i]) || /\*\*(AC|Step)\s?\d+/i.test(lines[i]))) break;
        block.push(lines[i]);
      }
      const text = block.join('\n').trim();
      if (text) out.push({ label: ref, text });
    }

    // Fallback: acceptance criteria section only
    if (out.length === 0) {
      const m = spec.match(/^##\s+Acceptance[^\n]*\n([\s\S]*?)(?=^##\s|$(?![\s\S]))/mi);
      if (m) out.push({ label: 'Acceptance criteria', text: m[1].trim().split('\n').slice(0, 20).join('\n') });
    }
    return out;
  };

  const q = query.trim().toLowerCase();
  const shown = q
    ? tasks.filter(t => [t.id, t.title, t.summary, t.description, t.claimedBy]
        .some(v => (v || '').toLowerCase().includes(q)))
    : tasks;

  return (
    <SlideOver
      onClose={onClose}
      featureId="tasks-human-todos"
      z="z-[90]"
      width="w-full lg:w-[65vw] xl:w-[60vw] lg:max-w-[1200px]"
      panelClassName="border-l border-slate-300"
    >
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-b-2 border-slate-200 bg-slate-50 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <div className="flex items-center gap-2.5">
            <ClipboardCheck size={20} className="text-amber-600" />
            <h2 className="text-base font-bold uppercase tracking-widest text-slate-900">Your Review</h2>
            <span className="text-xs font-black px-2.5 py-0.5 bg-amber-100 border border-amber-300 rounded-full text-amber-700">
              {tasks.length}
            </span>
          </div>
          <button
            onClick={onClose}
            className="flex items-center justify-center min-w-[44px] min-h-control-lg -m-2 text-slate-500 active:bg-slate-200 sm:hover:text-slate-900 rounded-lg transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {tasks.length > 0 && (
          <div className="px-4 sm:px-6 py-2.5 border-b border-slate-200 bg-white flex items-center gap-2">
            <Search size={15} className="text-slate-400 shrink-0" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search title, id, agent, summary…"
              data-feature-id="human-todo-search"
              className="flex-1 min-w-0 text-sm bg-transparent focus:outline-none placeholder:text-slate-400"
            />
            {q && (
              <>
                <span className="text-xs text-slate-500 shrink-0">{shown.length}/{tasks.length}</span>
                <button onClick={() => setQuery('')} aria-label="Clear search" className="text-slate-400 hover:text-slate-700 shrink-0"><X size={14} /></button>
              </>
            )}
          </div>
        )}

        {/* Body — two-column card grid on wide screens */}
        <div className="flex-1 overflow-y-auto custom-scrollbar [-webkit-overflow-scrolling:touch] p-3 sm:p-4 bg-slate-100 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {tasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-8">
              <CheckCircle2 size={36} className="text-emerald-500" />
              <p className="text-base text-slate-600">Nothing to review. When an agent finishes a task, it lands here for your verification.</p>
            </div>
          ) : shown.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-8">
              <Search size={32} className="text-slate-400" />
              <p className="text-base text-slate-600">No task matches “{query}”.</p>
              <button onClick={() => setQuery('')} className="text-sm font-semibold text-slate-900 underline">Clear search</button>
            </div>
          ) : (
            // Two columns only when there's something to put in the second one — a lone card
            // in a 2-col grid sits at half width with dead space beside it.
            <div className={`grid grid-cols-1 gap-3 sm:gap-4 items-start ${shown.length > 1 ? 'xl:grid-cols-2' : ''}`}>
              {shown.map(task => {
                const spec = specName(task);
                const open = expanded.has(task.id);
                return (
                  <div key={task.id} data-feature-id="human-todo-card" className="min-w-0 bg-white border-2 border-slate-200 rounded-xl shadow-sm overflow-hidden">
                    {/* Accordion trigger. Approve/Reject live INSIDE the body on purpose:
                        approving merges to main, so it must not be reachable without opening
                        the card and reading what the agent did. */}
                    <button
                      type="button"
                      onClick={() => toggle(task.id)}
                      aria-expanded={open}
                      data-feature-id="human-todo-toggle"
                      className="w-full text-left p-4 sm:p-5 flex items-start gap-3 sm:hover:bg-slate-50 transition-colors"
                    >
                      <ChevronDown
                        size={18}
                        className={`mt-0.5 shrink-0 text-slate-500 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
                      />
                      <div className="min-w-0 flex-1">
                      <h3 className="text-base font-bold text-slate-900 leading-snug break-words">{task.title}</h3>
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        <span className="text-[11px] font-bold text-slate-600 px-1.5 py-0.5 bg-slate-100 rounded border border-slate-200 font-mono uppercase">{task.id}</span>
                        <span className="flex items-center gap-1 text-[11px] font-bold text-accent-700 px-1.5 py-0.5 bg-accent-50 rounded border border-accent-200">
                          <GitBranch size={10} /> task/{task.id}
                        </span>
                        {task.claimedBy && (
                          <span className="text-[11px] font-bold text-amber-700 px-1.5 py-0.5 bg-amber-50 rounded border border-amber-200">by {task.claimedBy}</span>
                        )}
                        {(task.attempts || 0) > 1 && (
                          <span className="text-[11px] font-bold text-slate-600 px-1.5 py-0.5 bg-slate-100 rounded border border-slate-200">{task.attempts} attempts</span>
                        )}
                      </div>
                      </div>
                    </button>

                    {open && (
                    <div className="px-4 sm:px-5 pb-4 sm:pb-5 space-y-3.5">
                    {/* Reviewer summary — the main review aid */}
                    {task.summary ? (
                      (() => {
                        const p = parseSummary(task.summary!);
                        return p.structured ? (
                          <div className="space-y-2.5">
                            {p.what && (
                              <div className="bg-accent-50 border border-accent-200 rounded-lg p-3.5">
                                <p className="text-[11px] font-bold uppercase tracking-wide text-accent-700 mb-1.5">What the agent did</p>
                                <p className="text-sm text-slate-900 leading-relaxed whitespace-pre-wrap break-words">{p.what}</p>
                              </div>
                            )}
                            {p.watch && p.watch.toLowerCase() !== 'nothing' && (
                              <div className="bg-rose-50 border border-rose-200 rounded-lg p-3.5">
                                <p className="text-[11px] font-bold uppercase tracking-wide text-rose-700 mb-1.5">Watch out</p>
                                <p className="text-sm text-slate-900 leading-relaxed whitespace-pre-wrap break-words">{p.watch}</p>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="bg-accent-50 border border-accent-200 rounded-lg p-3.5">
                            <p className="text-[11px] font-bold uppercase tracking-wide text-accent-700 mb-2">Agent summary</p>
                            <p className="text-sm text-slate-900 leading-relaxed whitespace-pre-wrap break-words">{task.summary}</p>
                          </div>
                        );
                      })()
                    ) : (
                      <div className="bg-slate-50 border border-dashed border-slate-300 rounded-lg p-3.5">
                        <p className="text-[13px] text-slate-600 leading-relaxed">
                          No reviewer summary from the agent (legacy task). Inspect the branch diff
                          (<span className="font-mono text-accent-700">git diff vps-dev...task/{task.id}</span>)
                          or Reject asking for a summary: "what you did + how to verify in 2 minutes".
                        </p>
                      </div>
                    )}

                    {/* Context */}
                    {task.description && (
                      <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5">
                        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-600 mb-1.5">Context</p>
                        <p className="text-sm text-slate-800 leading-relaxed whitespace-pre-wrap break-words">{task.description}</p>
                      </div>
                    )}

                    {/* STEPS TO VERIFY — numbered, tickable, the reviewer's script */}
                    <div className="bg-amber-50/60 border-2 border-amber-300 rounded-lg p-3.5">
                      <p className="text-[11px] font-bold uppercase tracking-wide text-amber-800 mb-2.5">
                        ✓ Steps to verify — do these in order, tick as you go
                      </p>
                      {verifySteps(task).length > 0 ? (
                        <ol className="space-y-3">
                          {verifySteps(task).map((step, i) => (
                            <li key={i} className="flex items-start gap-3 text-sm text-slate-900 leading-relaxed">
                              <label className="flex items-center gap-2 shrink-0 cursor-pointer">
                                <input type="checkbox" className="w-[18px] h-[18px] accent-emerald-600" />
                                <span className="w-6 h-6 flex items-center justify-center text-[11px] font-black bg-amber-200/70 text-amber-900 rounded-full">{i + 1}</span>
                              </label>
                              <span className="pt-0.5 min-w-0 break-words">{step}</span>
                            </li>
                          ))}
                        </ol>
                      ) : (
                        <p className="flex items-center gap-1.5 text-sm text-rose-600"><AlertCircle size={14} /> No verify steps on this task — Reject and ask the agent to provide them.</p>
                      )}
                      <p className="text-[11px] text-slate-600 mt-3">All steps pass → Approve. Any step fails → Reject and say which step number failed and what you saw instead.</p>
                    </div>

    {/* Referenced spec points only — never the whole document */}
                    {spec && (
                      <details
                        className="bg-slate-50 border border-slate-200 rounded-lg overflow-hidden"
                        onToggle={(e) => { if ((e.target as HTMLDetailsElement).open) loadSpec(spec); }}
                      >
                        <summary className="flex items-center gap-2 px-3.5 py-3 cursor-pointer text-[13px] font-bold text-accent-700 select-none list-none [&::-webkit-details-marker]:hidden">
                          <BookOpen size={14} /> What the DoD references (from {spec}) <ChevronDown size={14} className="ml-auto" />
                        </summary>
                        <div className="border-t border-slate-200 p-3.5 max-h-[45vh] overflow-y-auto custom-scrollbar space-y-3">
                          {specs[spec] === undefined || specs[spec] === null ? (
                            <p className="text-xs text-slate-500">Loading…</p>
                          ) : (
                            (() => {
                              const points = extractRelevant(specs[spec]!, task.dod);
                              return points.length > 0 ? points.map(p => (
                                <div key={p.label} className="bg-white border border-slate-200 rounded-lg p-3">
                                  <p className="text-[11px] font-black uppercase tracking-wide text-accent-700 mb-1">{p.label}</p>
                                  <pre className="text-[13px] text-slate-800 leading-relaxed whitespace-pre-wrap break-words font-sans">{p.text}</pre>
                                </div>
                              )) : (
                                <p className="text-xs text-slate-500">No referenced points found in the spec — the DoD may already be self-contained.</p>
                              );
                            })()
                          )}
                        </div>
                      </details>
                    )}

                    {/* Live preview — build & serve the real branch on its own port before approving */}
                    <div>
                      {(() => {
                        const pv = previews[task.id];
                        if (pv?.status === 'ready' && pv.url) {
                          return (
                            <div className="space-y-1.5">
                              <a href={pv.url} target="_blank" rel="noreferrer" data-feature-id="human-todo-open-preview"
                                 className="flex items-center justify-center gap-2 min-h-control-lg text-[13px] font-bold uppercase tracking-wide bg-slate-900 text-white rounded-lg active:bg-slate-950 sm:hover:bg-slate-800 transition-colors">
                                <ExternalLink size={16} /> Open Preview ↗
                              </a>
                              <p className="text-[11px] text-center text-slate-500 font-mono break-all">{pv.url}{pv.apiPort ? ` · api :${pv.apiPort}` : ''}</p>
                            </div>
                          );
                        }
                        if (pv?.status === 'building') {
                          return (
                            <button disabled className="w-full flex items-center justify-center gap-2 min-h-[46px] text-[13px] font-bold uppercase tracking-wide bg-ai-100 text-ai-700 border border-ai-300 rounded-lg">
                              <Loader2 size={16} className="animate-spin" /> Building preview…
                            </button>
                          );
                        }
                        if (pv?.status === 'error') {
                          return (
                            <div className="space-y-1.5">
                              <button onClick={() => buildPreview(task.id)}
                                 className="w-full flex items-center justify-center gap-2 min-h-[46px] text-[12px] font-bold bg-rose-50 text-rose-700 border border-rose-300 rounded-lg active:bg-rose-100">
                                <AlertCircle size={15} /> Preview failed — retry {pv.error ? `(${pv.error})` : ''}
                              </button>
                              {pv.logTail && (
                                <pre className="text-[10px] leading-snug text-rose-800 bg-rose-50/60 border border-rose-200 rounded-lg p-2 max-h-40 overflow-auto whitespace-pre-wrap break-words">{pv.logTail}</pre>
                              )}
                              {pv.logName && <p className="text-[10px] text-slate-500">Full build log: open <span className="font-mono">{pv.logName}</span> in the Logs tab.</p>}
                            </div>
                          );
                        }
                        return (
                          <button onClick={() => buildPreview(task.id)} data-feature-id="human-todo-build-preview"
                             className="w-full flex items-center justify-center gap-2 min-h-[46px] text-[13px] font-bold uppercase tracking-wide bg-ai-50 text-ai-700 border border-ai-300 rounded-lg active:bg-ai-100 sm:hover:bg-ai-100 transition-colors">
                            <Eye size={16} /> Build Preview
                          </button>
                        );
                      })()}
                    </div>

                    {rejectingId === task.id ? (
                      <div className="space-y-2.5">
                        <textarea
                          autoFocus
                          value={feedback}
                          onChange={e => setFeedback(e.target.value)}
                          rows={3}
                          data-feature-id="human-todo-reject-feedback"
                          className="w-full bg-white border border-rose-300 rounded-lg px-3.5 py-3 text-sm text-slate-900 focus:outline-none focus:border-rose-500 resize-none placeholder:text-slate-400"
                          placeholder="What's wrong / what must change? (required)"
                        />
                        <textarea
                          value={updatedDod}
                          onChange={e => setUpdatedDod(e.target.value)}
                          rows={3}
                          data-feature-id="human-todo-reject-dod"
                          className="w-full bg-white border border-amber-300 rounded-lg px-3.5 py-3 text-[13px] text-slate-900 focus:outline-none focus:border-amber-500 resize-none placeholder:text-slate-400"
                          placeholder="Updated Definition of Done (edit if the criteria changed)"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() => submitReject(task.id)}
                            disabled={!feedback.trim()}
                            className="flex-1 min-h-[46px] text-[13px] font-bold uppercase tracking-wide bg-rose-600 text-white rounded-lg disabled:opacity-40 active:bg-rose-700 sm:hover:bg-rose-500 transition-colors"
                          >
                            Send back to agent
                          </button>
                          <button
                            onClick={() => setRejectingId(null)}
                            className="px-5 min-h-[46px] text-[13px] font-bold uppercase tracking-wide bg-white text-slate-700 border border-slate-300 rounded-lg active:bg-slate-100 sm:hover:bg-slate-50 transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <button
                          data-feature-id="human-todo-approve"
                          onClick={() => onApprove(task.id)}
                          className="flex-1 flex items-center justify-center gap-2 min-h-[46px] text-[13px] font-bold uppercase tracking-wide bg-emerald-600 text-white rounded-lg active:bg-emerald-700 sm:hover:bg-emerald-500 transition-colors"
                        >
                          <CheckCircle2 size={16} /> Approve
                        </button>
                        <button
                          data-feature-id="human-todo-reject"
                          onClick={() => startReject(task)}
                          className="flex-1 flex items-center justify-center gap-2 min-h-[46px] text-[13px] font-bold uppercase tracking-wide bg-white text-rose-600 border border-rose-300 rounded-lg active:bg-rose-600 active:text-white sm:hover:bg-rose-50 transition-colors"
                        >
                          <XCircle size={16} /> Reject
                        </button>
                      </div>
                    )}
                    </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
    </SlideOver>
  );
}
