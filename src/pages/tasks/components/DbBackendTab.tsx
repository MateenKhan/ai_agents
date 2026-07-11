import React, { useEffect, useState } from 'react';
import { Tooltip } from './Tooltip';
import { Database, HardDrive, Server, Eye, EyeOff, RefreshCw, Save, Plug, CheckCircle2, AlertTriangle, Info } from 'lucide-react';
import { API_BASE } from '../../../apiBase';
import { btnPrimary, btnGhost, inputCls } from '../ui';

/**
 * Datastore backend config — pick SQLite (default) or Postgres, test a Postgres
 * connection, and save the choice. The Postgres URL is a credential: it is stored
 * ENCRYPTED server-side and the API only ever returns a masked target, so the password
 * is never shown here. Saving records the choice; the db-server opens the matching
 * Store (and runs its migrations) at boot, so the switch needs a restart.
 *
 * Rendered as a tab inside GitPanel. Talks only to the db-server (/backend*).
 */

type Kind = 'sqlite' | 'postgres';
type Msg = { kind: 'ok' | 'err'; text: string } | null;

export default function DbBackendTab() {
  const [kind, setKind] = useState<Kind>('sqlite');
  const [url, setUrl] = useState('');
  const [showUrl, setShowUrl] = useState(false);
  const [current, setCurrent] = useState<{ kind: Kind; target: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testMsg, setTestMsg] = useState<Msg>(null);
  const [saveMsg, setSaveMsg] = useState<Msg>(null);

  const load = () => {
    setLoading(true);
    fetch(`${API_BASE}/backend`)
      .then(r => r.json())
      .then(d => { setCurrent(d); setKind(d.kind === 'postgres' ? 'postgres' : 'sqlite'); })
      .catch(() => setCurrent(null))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const test = async () => {
    setTesting(true); setTestMsg(null);
    try {
      const res = await fetch(`${API_BASE}/backend/test`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });
      const d = await res.json();
      setTestMsg(d.ok ? { kind: 'ok', text: 'Connection OK — SELECT 1 succeeded.' } : { kind: 'err', text: d.error || 'Connection failed.' });
    } catch (e: any) {
      setTestMsg({ kind: 'err', text: e?.message || 'db-server unreachable' });
    } finally { setTesting(false); }
  };

  const save = async () => {
    setSaving(true); setSaveMsg(null);
    try {
      const res = await fetch(`${API_BASE}/backend`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(kind === 'postgres' ? { kind, url: url.trim() } : { kind }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'save failed');
      setCurrent(d);
      setSaveMsg({ kind: 'ok', text: 'Saved. Restart the db-server to apply.' });
      setUrl('');
    } catch (e: any) {
      setSaveMsg({ kind: 'err', text: e?.message || 'save failed' });
    } finally { setSaving(false); }
  };

  const msgBox = (m: Msg) => m && (
    <div className={`text-xs rounded-lg px-3 py-2 border break-words flex items-start gap-1.5 ${m.kind === 'ok' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-rose-50 border-rose-200 text-rose-700'}`}>
      {m.kind === 'ok' ? <CheckCircle2 size={14} className="mt-px shrink-0" /> : <AlertTriangle size={14} className="mt-px shrink-0" />}
      <span>{m.text}</span>
    </div>
  );

  const canSave = kind === 'sqlite' || url.trim().length > 0;

  // Live reachability of the db-server, reflected as a connected/checking/failed pill.
  const conn = loading
    ? { label: 'Checking…', cls: 'bg-amber-50 border-amber-200 text-amber-700', dot: 'bg-amber-500' }
    : current
      ? { label: 'Connected', cls: 'bg-emerald-50 border-emerald-200 text-emerald-700', dot: 'bg-emerald-500' }
      : { label: 'Unreachable', cls: 'bg-rose-50 border-rose-200 text-rose-700', dot: 'bg-rose-500' };

  return (
    <div className="space-y-5">
      {/* Current backend */}
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 flex items-center gap-3">
        <Database size={18} className="text-accent-600 shrink-0" />
        <div className="min-w-0">
          <div className="eyebrow">Current backend</div>
          <div className="text-sm font-bold text-slate-800 truncate">
            {loading ? 'Loading…' : current ? (
              <><span className="uppercase">{current.kind}</span> <span className="text-slate-500">·</span> <span className="font-mono text-xs text-slate-600">{current.target}</span></>
            ) : 'Unavailable (db-server unreachable)'}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2 shrink-0">
          <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full border text-micro font-bold ${conn.cls}`} data-feature-id="db-backend-status" role="status">
            <span className={`w-1.5 h-1.5 rounded-full ${conn.dot} ${loading ? 'animate-pulse' : ''}`} />
            {conn.label}
          </span>
          <Tooltip label="Refresh"><button onClick={load} disabled={loading} className={`${btnGhost} shrink-0`}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button></Tooltip>
        </div>
      </div>

      {/* Backend picker */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {([
          { id: 'sqlite', label: 'SQLite', Icon: HardDrive, note: 'Local file (default). Zero setup.' },
          { id: 'postgres', label: 'Postgres', Icon: Server, note: 'External DB via connection URL.' },
        ] as const).map(o => {
          const active = kind === o.id;
          return (
            <button key={o.id} onClick={() => setKind(o.id)} type="button"
              className={`text-left rounded-xl border-2 px-4 py-3 transition-colors ${active ? 'border-accent-500 bg-accent-50' : 'border-slate-200 bg-white sm:hover:bg-slate-50'}`}>
              <div className="flex items-center gap-2">
                <span className={`flex items-center justify-center w-5 h-5 rounded-full border-2 ${active ? 'border-accent-500' : 'border-slate-300'}`}>
                  {active && <span className="w-2.5 h-2.5 rounded-full bg-accent-500" />}
                </span>
                <o.Icon size={16} className={active ? 'text-accent-600' : 'text-slate-500'} />
                <span className={`text-sm font-bold ${active ? 'text-accent-700' : 'text-slate-700'}`}>{o.label}</span>
              </div>
              <p className="text-xs text-slate-500 mt-1.5 ml-7">{o.note}</p>
            </button>
          );
        })}
      </div>

      {/* Postgres URL + actions */}
      {kind === 'postgres' && (
        <div className="space-y-3">
          <div>
            <label className="eyebrow">Connection URL</label>
            <div className="relative mt-1">
              <input
                type={showUrl ? 'text' : 'password'}
                value={url}
                onChange={e => { setUrl(e.target.value); setTestMsg(null); setSaveMsg(null); }}
                placeholder="postgres://user:password@host:5432/dbname"
                autoComplete="off" spellCheck={false}
                className={`${inputCls} font-mono text-xs sm:text-sm pr-11`}
              />
              <Tooltip label={showUrl ? 'Hide' : 'Show'}><button type="button" onClick={() => setShowUrl(s => !s)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-slate-500 sm:hover:text-slate-700" aria-label={showUrl ? 'Hide URL' : 'Show URL'}>
                {showUrl ? <EyeOff size={16} /> : <Eye size={16} />}
              </button></Tooltip>
            </div>
            <p className="text-2xs text-slate-500 mt-1">Stored encrypted on the server. The saved value is never shown back — the password is masked.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={test} disabled={testing || !url.trim()} className={btnGhost}>
              <Plug size={14} className={testing ? 'animate-pulse' : ''} /> {testing ? 'Testing…' : 'Test connection'}
            </button>
          </div>
          {msgBox(testMsg)}
        </div>
      )}

      {/* Save */}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button onClick={save} disabled={saving || !canSave} className={btnPrimary}>
          <Save size={14} /> {saving ? 'Saving…' : 'Save backend'}
        </button>
      </div>
      {msgBox(saveMsg)}

      {/* Scope note */}
      <div className="text-2xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-start gap-1.5">
        <Info size={13} className="mt-px shrink-0" />
        <span>
          Saving records the choice and (for Postgres) the encrypted URL. It takes effect on{' '}
          <strong>db-server restart</strong>, which opens the new datastore and runs its migrations.
          The Database tab stays SQLite-only; inspect Postgres with your own client.
        </span>
      </div>
    </div>
  );
}
