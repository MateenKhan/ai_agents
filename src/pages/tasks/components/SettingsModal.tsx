import React, { useEffect, useState } from 'react';
import { Tooltip } from './Tooltip';
import { Settings, RotateCcw, Eye, EyeOff, Cpu, ShieldAlert } from 'lucide-react';
import type { Column } from '../types';
import { DEFAULT_COLUMNS } from '../boardConfig';
import { TAB_META, type TabId } from '../tabsConfig';
import { BoardColumnsEditor } from './BoardColumnsEditor';
import { Modal } from './Modal';
import { API_BASE } from '../../../apiBase';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  columns: Column[];
  onSave: (columns: Column[]) => void;
  hiddenTabs: Set<TabId>;
  onSetTabHidden: (id: TabId, hidden: boolean) => void;
}

export function SettingsModal({ isOpen, onClose, columns, onSave, hiddenTabs, onSetTabHidden }: SettingsModalProps) {
  const [cols, setCols] = useState<Column[]>(columns);
  const closeableTabs = TAB_META.filter(t => t.closeable);

  // Global agent defaults: max concurrent agents per project ('' = unset → 0/unlimited),
  // and whether agents may skip Claude's permission prompts.
  const [agentMaxConc, setAgentMaxConc] = useState<string>('');
  const [skipPerms, setSkipPerms] = useState(true);
  useEffect(() => {
    if (!isOpen) return;
    fetch(`${API_BASE}/agent-defaults`).then(r => r.json())
      .then(d => {
        setAgentMaxConc(d?.maxConcurrency ? String(d.maxConcurrency) : '0');
        setSkipPerms(d?.skipPermissions !== false);
      })
      .catch(() => {});
  }, [isOpen]);

  const handleSave = () => {
    fetch(`${API_BASE}/agent-defaults`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        maxConcurrency: Math.max(0, Math.floor(Number(agentMaxConc) || 0)),
        skipPermissions: skipPerms,
      }),
    }).catch(() => {});
    onSave(cols);
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Settings"
      subtitle="Show or hide tabs and edit board lanes"
      icon={<Settings className="w-5 h-5 text-accent-600" />}
      maxW="sm:max-w-2xl"
      featureId="settings-modal"
      footer={
        <div className="flex items-center justify-between w-full">
          <Tooltip label="Reset to default lanes"><button
            onClick={() => setCols(DEFAULT_COLUMNS)}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-slate-500 hover:text-slate-900 transition-all"
          >
            <RotateCcw size={14} /> Reset
          </button></Tooltip>
          <div className="flex items-center gap-3">
            <button onClick={onClose} className="px-6 py-2 text-sm font-bold text-slate-600 hover:text-slate-900 transition-all">Cancel</button>
            <button
              onClick={handleSave}
              disabled={cols.length === 0}
              className="px-6 py-2 bg-slate-900 text-white rounded-xl text-sm font-bold hover:bg-slate-800 transition-all disabled:bg-slate-900/50 disabled:cursor-not-allowed"
            >
              Save Changes
            </button>
          </div>
        </div>
      }
    >
      {/* Visible tabs — toggle closeable tabs back on after they've been hidden. */}
      <div className="mb-6">
        <h3 className="eyebrow mb-2.5">Visible Tabs</h3>
        <div className="flex flex-col gap-1.5">
          {closeableTabs.map(t => {
            const Icon = t.icon;
            const hidden = hiddenTabs.has(t.id);
            return (
              <label
                key={t.id}
                data-feature-id={`settings-tab-toggle-${t.id}`}
                className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 cursor-pointer transition-colors"
              >
                <span className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                  <Icon size={15} className="text-slate-500" /> {t.label}
                </span>
                <span className="eyebrow flex items-center gap-2">
                  {hidden ? <><EyeOff size={13} /> Hidden</> : <><Eye size={13} className="text-accent-500" /> Shown</>}
                  <input
                    type="checkbox"
                    checked={!hidden}
                    onChange={e => onSetTabHidden(t.id, !e.target.checked)}
                    className="w-5 h-5 accent-accent-600"
                  />
                </span>
              </label>
            );
          })}
        </div>
        <p className="text-micro text-slate-500 mt-2">The Board tab is always visible. Hidden tabs can be re-enabled here anytime.</p>
      </div>

      {/* Agent defaults — the global fallback every project inherits (each project can override). */}
      <div className="mb-6">
        <h3 className="eyebrow mb-2.5">Agent Defaults</h3>
        <label className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border border-slate-200 bg-slate-50">
          <span className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <Cpu size={15} className="text-slate-500" /> Max concurrent agents
          </span>
          <input
            type="text"
            inputMode="numeric"
            value={agentMaxConc}
            onChange={e => setAgentMaxConc(e.target.value.replace(/[^\d]/g, ''))}
            data-feature-id="settings-agent-maxconc"
            className="w-24 px-2 py-1.5 text-sm text-right font-mono bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-accent-500"
          />
        </label>
        <p className="text-micro text-slate-500 mt-2">Default cap on how many agents run at once <span className="font-semibold">per project</span> — <span className="font-mono">0 = unlimited</span> (still bounded by CPU/RAM). A project can override this in its editor.</p>
      </div>

      {/* Agent safety — the single most dangerous setting in the product. It used to be a
          silent env-var default with no UI at all. Surfaced so the user OWNS it. */}
      <div className="mb-6">
        <h3 className="eyebrow mb-2.5">Agent Safety</h3>
        <label
          data-feature-id="settings-skip-perms"
          className={`flex items-start justify-between gap-3 px-3 py-3 rounded-lg border cursor-pointer transition-colors ${
            skipPerms ? 'border-rose-300 bg-rose-50' : 'border-slate-200 bg-slate-50'
          }`}
        >
          <span className="flex items-start gap-2.5 min-w-0">
            <ShieldAlert size={16} className={`mt-0.5 shrink-0 ${skipPerms ? 'text-rose-600' : 'text-slate-400'}`} />
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-slate-900">
                Skip permission prompts
                {skipPerms && <span className="ml-2 align-middle text-micro font-black uppercase tracking-wider text-rose-700">Dangerous</span>}
              </span>
              <span className="block text-2xs text-slate-600 mt-1 leading-relaxed">
                Agents edit, delete and commit files without asking. Required for unattended runs —
                turn it off and an agent will stop at its first file write instead.
              </span>
            </span>
          </span>
          <input
            type="checkbox"
            checked={skipPerms}
            onChange={e => setSkipPerms(e.target.checked)}
            className="w-5 h-5 shrink-0 mt-0.5 accent-rose-600"
          />
        </label>
        <p className="text-micro text-slate-500 mt-2">
          Passes <span className="font-mono">--dangerously-skip-permissions</span> to each agent. Setting the
          <span className="font-mono"> CLAUDE_FLAGS</span> environment variable overrides this entirely.
        </p>
      </div>

      <BoardColumnsEditor columns={cols} onChange={setCols} />
    </Modal>
  );
}
