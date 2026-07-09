import React, { useEffect, useState } from 'react';
import { BarChart3, Clock, Cpu, AlertOctagon, SearchX, Search, FileCode, Pin } from 'lucide-react';
import type { Task } from '../types';
import { API_BASE, withProject } from '../../../apiBase';

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

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
      <p className="text-micro font-bold uppercase tracking-widest text-slate-500">{label}</p>
      <p className="text-2xl font-black text-slate-900 mt-1">{value}</p>
      {sub && <p className="text-2xs text-slate-500 mt-0.5">{sub}</p>}
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
  const ROLE_ORDER = ['architect', 'dev', 'qa', 'merge'];
  const ROLE_COLOR: Record<string, string> = { architect: 'bg-fuchsia-500', dev: 'bg-accent-500', qa: 'bg-amber-500', merge: 'bg-emerald-500' };
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

  return (
    <div className="p-3 sm:p-4 space-y-4 pb-24 h-[calc(100dvh-170px)] overflow-y-auto custom-scrollbar" data-feature-id="tasks-analytics-tab">
      {/* Headline stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Defined" value={tasks.length} sub={`${byStatus['AVAILABLE'] || 0} available, ${byStatus['TODO'] || 0} todo`} />
        <StatCard label="Done" value={byStatus['DONE'] || 0} sub={`${byStatus['TESTING'] || 0} awaiting your review`} />
        <StatCard label="Avg completion" value={timed.length ? fmtMins(avgMs) : '—'} sub={timed.length ? `across ${timed.length} timed tasks` : 'no timed completions yet'} />
        <StatCard label="Stuck" value={stuck.length} sub={`${byStatus['BLOCKED'] || 0} blocked, ${byStatus['WORKING'] || 0} working`} />
      </div>

      {/* Models */}
      <Section icon={<Cpu size={14} className="text-accent-600" />} title="Models used">
        {Object.keys(byModel).length === 0 ? (
          <p className="text-xs text-slate-500">No model data yet — recorded on each dispatch (set CLAUDE_MODEL env to name it explicitly).</p>
        ) : (
          <div className="space-y-1.5">
            {Object.entries(byModel).sort((a, b) => b[1] - a[1]).map(([model, count]) => (
              <div key={model} className="flex items-center gap-3">
                <span className="text-xs font-mono text-slate-800 min-w-[160px] truncate">{model}</span>
                <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full bg-accent-500 rounded-full" style={{ width: `${(count / tasks.length) * 100}%` }} />
                </div>
                <span className="text-xs font-bold text-slate-600 w-8 text-right">{count}</span>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Slowest tasks */}
      <Section icon={<Clock size={14} className="text-amber-700" />} title="Slowest completions">
        {slowest.length === 0 ? (
          <p className="text-xs text-slate-500">No completed timed tasks yet.</p>
        ) : (
          <div className="space-y-2">
            {slowest.map(t => (
              <div key={t.id} className="flex items-center justify-between gap-3 text-xs">
                <span className="text-slate-800 truncate">{t.title}</span>
                <span className="font-bold text-amber-700 shrink-0">{fmtMins(t.ms)}{t.attempts ? ` · ${t.attempts} attempt${t.attempts > 1 ? 's' : ''}` : ''}</span>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Agent time by role — who took how long (actual, measured) */}
      <Section icon={<Clock size={14} className="text-fuchsia-600" />} title="Agent time by role — who took how long">
        {grandTotal === 0 ? (
          <p className="text-xs text-slate-500">No agent time recorded yet — accumulates as agents finish runs.</p>
        ) : (
          <div className="space-y-1.5">
            {ROLE_ORDER.filter(r => roleTotals[r]).map(role => (
              <div key={role} className="flex items-center gap-3">
                <span className="text-xs font-semibold text-slate-800 capitalize min-w-[72px]">{role}</span>
                <div className="flex-1 h-2.5 bg-slate-100 rounded-full overflow-hidden">
                  <div className={`h-full ${ROLE_COLOR[role] || 'bg-slate-400'} rounded-full`} style={{ width: `${(roleTotals[role] / grandTotal) * 100}%` }} />
                </div>
                <span className="text-xs font-bold text-slate-700 w-14 text-right">{fmtMins(roleTotals[role])}</span>
                <span className="text-micro text-slate-500 w-9 text-right">{Math.round((roleTotals[role] / grandTotal) * 100)}%</span>
              </div>
            ))}
            <div className="pt-1.5 mt-1 border-t border-slate-100 flex justify-between text-2xs text-slate-500">
              <span>Total agent time across {tasksWithTime.length} task{tasksWithTime.length !== 1 ? 's' : ''}</span>
              <span className="font-bold text-slate-700">{fmtMins(grandTotal)}</span>
            </div>
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
                <div className="flex items-center justify-between gap-2 text-xs mb-1">
                  <span className="text-slate-800 truncate">{t.title}</span>
                  <span className="font-bold text-slate-700 shrink-0">{fmtMins(total)}</span>
                </div>
                <div className="flex h-2 rounded-full overflow-hidden bg-slate-100">
                  {ROLE_ORDER.filter(r => timings[r]).map(role => (
                    <div key={role} className={ROLE_COLOR[role] || 'bg-slate-400'} style={{ width: `${(timings[role] / total) * 100}%` }} title={`${role}: ${fmtMins(timings[role])}`} />
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
                  <span className="text-micro font-bold px-1.5 py-0.5 rounded bg-rose-50 text-rose-600 border border-rose-300 shrink-0">{t.status}</span>
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
          <p className="text-xs text-slate-500">Loading…</p>
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
          <p className="text-xs text-slate-500">Loading…</p>
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
