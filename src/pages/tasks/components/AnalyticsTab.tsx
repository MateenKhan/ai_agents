import React, { useEffect, useState } from 'react';
import { BarChart3, Clock, Cpu, AlertOctagon, SearchX, Search, FileCode, Pin, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { Task } from '../types';
import { API_BASE, withProject } from '../../../apiBase';
import { Tooltip } from './Tooltip';

interface AnalyticsTabProps {
  tasks: Task[];
}

interface DbUsageRow { agentName: string; searches: number; tasks: number }

const fmtMins = (ms: number) => {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
};

const fmtAgo = (iso: string) => fmtMins(Date.now() - new Date(iso).getTime()) + ' ago';

function StatCard({ label, value, sub, muted, delta }: { label: string; value: string | number; sub?: string; muted?: boolean; delta?: React.ReactNode }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm">
      <p className="eyebrow">{label}</p>
      <p className={`mt-0.5 ${muted ? 'text-base font-semibold text-slate-400' : 'text-2xl font-bold text-slate-900'}`}>{value}</p>
      {delta && <div className="mt-0.5">{delta}</div>}
      {sub && <p className="text-2xs text-slate-500 mt-0.5">{sub}</p>}
    </div>
  );
}

// Trend chip vs the prior 7-day window (item 41). Presentation only — it renders a
// separately-derived delta and never alters the headline total above it.
function Delta({ value, tone = 'neutral', suffix }: { value: number; tone?: 'neutral' | 'up-good'; suffix?: string }) {
  if (value === 0) {
    return <span className="inline-flex items-center gap-0.5 text-micro text-slate-400"><Minus size={10} /> no change vs last week</span>;
  }
  const up = value > 0;
  const color = tone === 'up-good' ? (up ? 'text-emerald-600' : 'text-rose-600') : 'text-slate-500';
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-0.5 text-micro font-semibold ${color}`}>
      <Icon size={11} />{up ? '+' : ''}{value}{suffix} vs last week
    </span>
  );
}

// Agent-role palette, hoisted so the bars, the stacked swimlanes and the shared legend
// all read from ONE source — keeping the role legend consistent with the bar colours (item 44).
const ROLE_ORDER = ['architect', 'dev', 'qa', 'merge'];
const ROLE_COLOR: Record<string, string> = { architect: 'bg-fuchsia-500', dev: 'bg-accent-500', qa: 'bg-amber-500', merge: 'bg-emerald-500' };

function RoleLegend() {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 pt-0.5">
      {ROLE_ORDER.map(role => (
        <span key={role} className="inline-flex items-center gap-1 text-micro text-slate-500 capitalize">
          <span className={`inline-block w-2 h-2 rounded-sm ${ROLE_COLOR[role]}`} />
          {role}
        </span>
      ))}
    </div>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3 shadow-sm">
      <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-900">
        {icon} {title}
      </h3>
      {children}
    </div>
  );
}

// Compact single-line variant — for sections that hold only one row or a placeholder,
// so a lone item doesn't eat a full padded card's height.
function ThinSection({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg px-3 py-2 shadow-sm flex items-center gap-3">
      <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-900 shrink-0">
        {icon} {title}
      </h3>
      <div className="ml-auto min-w-0">{children}</div>
    </div>
  );
}

// Loading skeleton for the two async sections (item 88) — animate-pulse blocks that hold the
// section's shape while db-usage / context-usage fetch, instead of a blank flash then a pop-in.
function SkeletonRows({ rows = 3, bar }: { rows?: number; bar?: boolean }) {
  return (
    <div className="space-y-2" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="h-3 rounded bg-slate-100 animate-pulse" style={{ width: `${34 + (i % 3) * 14}%` }} />
          {bar && <div className="h-2 flex-1 rounded-full bg-slate-100 animate-pulse" />}
          <div className="h-3 w-12 rounded bg-slate-100 animate-pulse ml-auto" />
        </div>
      ))}
    </div>
  );
}

interface FileUsageRow { path: string; uses: number; agents: number; inContext: 0 | 1; tokens: number | null; }

export default function AnalyticsTab({ tasks }: AnalyticsTabProps) {
  const [dbUsage, setDbUsage] = useState<DbUsageRow[] | null>(null);
  const [fileUsage, setFileUsage] = useState<FileUsageRow[] | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/db-usage`)
      .then(r => r.json())
      .then(d => setDbUsage(d.usage ?? []))
      .catch(() => setDbUsage([]));
    fetch(withProject(`${API_BASE}/context/usage?limit=25`))
      .then(r => r.json())
      .then(d => setFileUsage(d.usage ?? []))
      .catch(() => setFileUsage([]));
  }, []);

  // ── Throughput ──
  const byStatus: Record<string, number> = {};
  for (const t of tasks) byStatus[t.status] = (byStatus[t.status] || 0) + 1;

  // ── Speed (needs both started & completed) ──
  const timed = tasks
    .filter(t => t.status === 'DONE' && t.started && t.completed)
    .map(t => ({ ...t, ms: new Date(t.completed!).getTime() - new Date(t.started!).getTime() }))
    .filter(t => t.ms > 0);
  const avgMs = timed.length ? timed.reduce((s, t) => s + t.ms, 0) / timed.length : 0;
  const slowest = [...timed].sort((a, b) => b.ms - a.ms).slice(0, 5);

  // ── Actual agent time (from stageTimings: role → ms) ──
  const tasksWithTime = tasks
    .map(t => { const timings = t.stageTimings || {}; return { t, timings, total: Object.values(timings).reduce((s, v) => s + v, 0) }; })
    .filter(x => x.total > 0);
  const roleTotals: Record<string, number> = {};
  for (const { timings } of tasksWithTime) for (const [role, ms] of Object.entries(timings)) roleTotals[role] = (roleTotals[role] || 0) + ms;
  const grandTotal = Object.values(roleTotals).reduce((s, v) => s + v, 0);
  const topByTime = [...tasksWithTime].sort((a, b) => b.total - a.total).slice(0, 8);

  // ── Models ──
  const byModel: Record<string, number> = {};
  for (const t of tasks) if (t.model) byModel[t.model] = (byModel[t.model] || 0) + 1;

  // ── Stuck & why ──
  const stuck = [
    ...tasks.filter(t => t.status === 'BLOCKED').map(t => ({
      t, why: t.lastError || 'Blocked (dependencies or dead-letter — see task log)',
    })),
    ...tasks.filter(t => t.status === 'WORKING' && (t.attempts || 0) > 1).map(t => ({
      t, why: `Retrying — attempt ${t.attempts}${t.lastError ? `, last error: ${t.lastError}` : ''}${t.nextRetryAt ? `, next try ${fmtAgo(t.nextRetryAt).replace(' ago', '')}` : ''}`,
    })),
    ...tasks.filter(t => t.status === 'TESTING' && t.completed == null && t.started).map(t => ({
      t, why: `Waiting on YOUR review since ${fmtAgo(t.started!)}`,
    })),
  ];

  const zeroSearchAgents = (dbUsage ?? []).filter(u => u.searches === 0);
  const claimedAgents = new Set(tasks.map(t => t.claimedBy).filter(Boolean));
  const neverSearched = [...claimedAgents].filter(a => !(dbUsage ?? []).some(u => u.agentName === a));

  // ── Trend vs the prior 7-day window (item 41) ──
  // Purely additive: counts this-week against last-week using timestamps already on the
  // tasks, so the four headline totals above are unchanged.
  const WEEK = 7 * 24 * 3_600_000;
  const nowMs = Date.now();
  const inWin = (iso: string | null | undefined, from: number, to: number) => {
    if (!iso) return false;
    const ts = new Date(iso).getTime();
    return ts >= from && ts < to;
  };
  const createdDelta =
    tasks.filter(t => inWin(t.createdAt, nowMs - WEEK, nowMs)).length -
    tasks.filter(t => inWin(t.createdAt, nowMs - 2 * WEEK, nowMs - WEEK)).length;
  const doneDelta =
    tasks.filter(t => inWin(t.completed, nowMs - WEEK, nowMs)).length -
    tasks.filter(t => inWin(t.completed, nowMs - 2 * WEEK, nowMs - WEEK)).length;

  // Whole-tab empty state (item 46) — a project with zero tasks has no numbers to show, so
  // mirror the board's calm centred voice instead of a grid of zeros (item 100).
  if (tasks.length === 0) {
    return (
      <div className="p-3 sm:p-4 h-full overflow-y-auto custom-scrollbar" data-feature-id="tasks-analytics-tab">
        <div className="h-full min-h-[60vh] flex items-center justify-center p-6 text-center">
          <div className="flex flex-col items-center gap-2.5 max-w-xs">
            <BarChart3 size={28} className="text-slate-300" />
            <p className="eyebrow text-slate-400">No analytics yet</p>
            <p className="text-2xs text-slate-500">Numbers show up here once this project has tasks — define your first one on the board and throughput, timings and token-burn start flowing in.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-4 space-y-3 pb-24 h-full overflow-y-auto custom-scrollbar" data-feature-id="tasks-analytics-tab">
      {/* Headline stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Defined" value={tasks.length} delta={<Delta value={createdDelta} />} sub={`${byStatus['AVAILABLE'] || 0} available, ${byStatus['TODO'] || 0} todo`} />
        <StatCard label="Done" value={byStatus['DONE'] || 0} delta={<Delta value={doneDelta} tone="up-good" />} sub={`${byStatus['TESTING'] || 0} awaiting your review`} />
        <StatCard label="Avg completion" value={timed.length ? fmtMins(avgMs) : 'No data yet'} muted={!timed.length} sub={timed.length ? `across ${timed.length} timed tasks` : 'no timed completions yet'} />
        <StatCard label="Stuck" value={stuck.length} sub={`${byStatus['BLOCKED'] || 0} blocked, ${byStatus['WORKING'] || 0} working`} />
      </div>

      {/* Models — a lone bar or an empty state collapses to a thin single line */}
      {Object.keys(byModel).length <= 1 ? (
        <ThinSection icon={<Cpu size={14} className="text-accent-600" />} title="Models used">
          {Object.keys(byModel).length === 0 ? (
            <span className="text-xs text-slate-500">No model data yet — set CLAUDE_MODEL env to name it.</span>
          ) : (
            <span className="flex items-center gap-2 text-xs">
              <span className="font-mono text-slate-800 truncate">{Object.entries(byModel)[0][0]}</span>
              <span className="font-semibold text-slate-600 shrink-0">{Object.entries(byModel)[0][1]}</span>
            </span>
          )}
        </ThinSection>
      ) : (
        <Section icon={<Cpu size={14} className="text-accent-600" />} title="Models used">
          <div className="space-y-1.5">
            {Object.entries(byModel).sort((a, b) => b[1] - a[1]).map(([model, count]) => (
              <div key={model} className="grid grid-cols-[minmax(0,160px)_1fr_2rem] items-center gap-3">
                <span className="text-xs font-mono text-slate-800 truncate">{model}</span>
                <Tooltip label={`${model}: ${count} of ${tasks.length} task${tasks.length !== 1 ? 's' : ''}`}>
                  <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-accent-500 rounded-full" style={{ width: `${(count / tasks.length) * 100}%` }} />
                  </div>
                </Tooltip>
                <span className="text-xs font-semibold text-slate-600 text-right">{count}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Slowest tasks — a single completion or the empty state collapses to a thin line */}
      {slowest.length <= 1 ? (
        <ThinSection icon={<Clock size={14} className="text-amber-700" />} title="Slowest completions">
          {slowest.length === 0 ? (
            <span className="text-xs text-slate-500">No completed timed tasks yet.</span>
          ) : (
            <span className="flex items-center gap-2 text-xs min-w-0">
              <span className="text-slate-800 truncate">{slowest[0].title}</span>
              <span className="font-bold text-amber-700 shrink-0">{fmtMins(slowest[0].ms)}{slowest[0].attempts ? ` · ${slowest[0].attempts} attempt${slowest[0].attempts > 1 ? 's' : ''}` : ''}</span>
            </span>
          )}
        </ThinSection>
      ) : (
        <Section icon={<Clock size={14} className="text-amber-700" />} title="Slowest completions">
          <div className="space-y-2">
            {slowest.map(t => (
              <div key={t.id} className="flex items-center justify-between gap-3 text-xs">
                <span className="text-slate-800 truncate">{t.title}</span>
                <span className="font-bold text-amber-700 shrink-0">{fmtMins(t.ms)}{t.attempts ? ` · ${t.attempts} attempt${t.attempts > 1 ? 's' : ''}` : ''}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Agent time by role — who took how long (actual, measured) */}
      <Section icon={<Clock size={14} className="text-fuchsia-600" />} title="Agent time by role — who took how long">
        {grandTotal === 0 ? (
          <p className="text-xs text-slate-500">No agent time recorded yet — accumulates as agents finish runs.</p>
        ) : (
          <div className="space-y-1.5">
            {ROLE_ORDER.filter(r => roleTotals[r]).map(role => (
              <div key={role} className="grid grid-cols-[72px_1fr_3.5rem_2.25rem] items-center gap-3">
                <span className="text-xs font-semibold text-slate-800 capitalize">{role}</span>
                <Tooltip label={`${role}: ${fmtMins(roleTotals[role])} (${Math.round((roleTotals[role] / grandTotal) * 100)}%)`}>
                  <div className="h-2.5 w-full bg-slate-100 rounded-full overflow-hidden">
                    <div className={`h-full ${ROLE_COLOR[role] || 'bg-slate-400'} rounded-full`} style={{ width: `${(roleTotals[role] / grandTotal) * 100}%` }} />
                  </div>
                </Tooltip>
                <span className="text-xs font-bold text-slate-700 text-right">{fmtMins(roleTotals[role])}</span>
                <span className="text-micro text-slate-500 text-right">{Math.round((roleTotals[role] / grandTotal) * 100)}%</span>
              </div>
            ))}
            <div className="pt-1.5 mt-1 border-t border-slate-100 flex justify-between text-2xs text-slate-500">
              <span>Total agent time across {tasksWithTime.length} task{tasksWithTime.length !== 1 ? 's' : ''}</span>
              <span className="font-bold text-slate-700">{fmtMins(grandTotal)}</span>
            </div>
            <RoleLegend />
          </div>
        )}
      </Section>

      {/* Time per task, broken down by agent */}
      <Section icon={<Clock size={14} className="text-accent-600" />} title="Time per task (by agent)">
        {topByTime.length === 0 ? (
          <p className="text-xs text-slate-500">No per-task timing yet.</p>
        ) : (
          <div className="space-y-3">
            {topByTime.map(({ t, timings, total }) => (
              <div key={t.id}>
                <div className="grid grid-cols-[1fr_auto] items-center gap-2 text-xs mb-1">
                  <Tooltip label={t.title}>
                    <span className="flex-1 min-w-0 truncate text-slate-800">{t.title}</span>
                  </Tooltip>
                  <span className="font-bold text-slate-700">{fmtMins(total)}</span>
                </div>
                <div className="grid h-2 rounded-full overflow-hidden bg-slate-100" style={{ gridTemplateColumns: ROLE_ORDER.filter(r => timings[r]).map(r => `${timings[r]}fr`).join(' ') }}>
                  {ROLE_ORDER.filter(r => timings[r]).map(role => (
                    <Tooltip key={role} label={`${role}: ${fmtMins(timings[role])}`}>
                      <div className={`w-full h-full ${ROLE_COLOR[role] || 'bg-slate-400'}`} />
                    </Tooltip>
                  ))}
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                  {ROLE_ORDER.filter(r => timings[r]).map(role => (
                    <span key={role} className="text-micro text-slate-500 capitalize">
                      <span className={`inline-block w-2 h-2 rounded-sm mr-1 align-middle ${ROLE_COLOR[role] || 'bg-slate-400'}`} />
                      {role} {fmtMins(timings[role])}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Stuck & why */}
      <Section icon={<AlertOctagon size={14} className="text-rose-600" />} title="Who's stuck & why">
        {stuck.length === 0 ? (
          <p className="text-xs text-emerald-600">Nothing stuck. Board is flowing.</p>
        ) : (
          <div className="space-y-2.5">
            {stuck.map(({ t, why }) => (
              <div key={t.id} className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-900 truncate">{t.title}</span>
                  <span className="text-micro font-semibold px-1.5 py-0.5 rounded bg-rose-50 text-rose-600 border border-rose-300 shrink-0">{t.status}</span>
                </div>
                <p className="text-2xs text-slate-600 mt-1 leading-relaxed">{why}</p>
                {t.claimedBy && <p className="text-micro text-slate-500 mt-0.5">last agent: {t.claimedBy}</p>}
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Index usage — the token-burn audit */}
      <Section icon={<Search size={14} className="text-cyan-700" />} title="Code index usage per agent">
        {dbUsage === null ? (
          <SkeletonRows rows={3} />
        ) : dbUsage.length === 0 && neverSearched.length === 0 ? (
          <p className="text-xs text-slate-500">No usage recorded yet — populates as headless agents run tasks.</p>
        ) : (
          <div className="space-y-2">
            {dbUsage.map(u => (
              <div key={u.agentName} className="flex items-center justify-between gap-3 text-xs">
                <span className="font-mono text-slate-800">{u.agentName}</span>
                <span className="text-slate-600">{u.searches} searches / {u.tasks} task{u.tasks !== 1 ? 's' : ''}
                  <span className={`ml-2 font-bold ${u.searches / Math.max(1, u.tasks) >= 2 ? 'text-emerald-600' : 'text-amber-700'}`}>
                    {(u.searches / Math.max(1, u.tasks)).toFixed(1)}/task
                  </span>
                </span>
              </div>
            ))}
            {neverSearched.map(a => (
              <div key={a as string} className="flex items-center justify-between gap-3 text-xs bg-rose-50 border border-rose-200 rounded-lg px-2.5 py-1.5">
                <span className="flex items-center gap-1.5 font-mono text-rose-700"><SearchX size={12} /> {a}</span>
                <span className="font-bold text-rose-600">NEVER used the index — token burner</span>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Most-used context files — which files agents pull into memory most, and how many
          distinct agents touched each. Sourced from the context op-log. */}
      <Section icon={<FileCode size={14} className="text-ai-600" />} title="Most-used context files">
        {fileUsage === null ? (
          <SkeletonRows rows={4} bar />
        ) : fileUsage.length === 0 ? (
          <p className="text-xs text-slate-500">No context activity yet — agents populate this as they read files.</p>
        ) : (
          <div className="space-y-1.5">
            {fileUsage.map(f => (
              <div key={f.path} className="flex items-center gap-2 text-2xs">
                {f.inContext ? <Pin size={11} className="text-accent-500 shrink-0" /> : <FileCode size={11} className="text-slate-400 shrink-0" />}
                <span className="flex-1 min-w-0 truncate font-mono text-slate-700" title={f.path}>{f.path}</span>
                {f.tokens != null && <span className="shrink-0 text-slate-500 tabular-nums">{f.tokens >= 1000 ? `${Math.round(f.tokens / 1000)}K` : f.tokens} tok</span>}
                <span className="shrink-0 text-ai-700 font-bold tabular-nums">{f.uses}×</span>
                <span className="shrink-0 text-slate-500 tabular-nums" title="distinct agents that used this file">{f.agents} agent{f.agents === 1 ? '' : 's'}</span>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
