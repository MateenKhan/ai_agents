import React, { useEffect, useState } from 'react';
import { Tooltip } from './Tooltip';
import { Settings, RotateCcw, Eye, EyeOff, Cpu, ShieldAlert } from 'lucide-react';
import type { Column } from '../types';
import { DEFAULT_COLUMNS } from '../boardConfig';
import { TAB_META, type TabId } from '../tabsConfig';
import { BoardColumnsEditor } from './BoardColumnsEditor';
import { Modal } from './Modal';
import { useConfirm } from './ConfirmProvider';
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
  const confirm = useConfirm();

  // Global agent defaults: max concurrent agents per project ('' = unset → 0/unlimited),
  // and whether agents may skip Claude's permission prompts.
  const [agentMaxConc, setAgentMaxConc] = useState<string>('');
  const [profile, setProfile] = useState<'strict' | 'standard' | 'dangerous'>('standard');
  const [taskCap, setTaskCap] = useState<string>('2');
  const [dailyCap, setDailyCap] = useState<string>('25');

  // Activepieces Integration
  const [apUrl, setApUrl] = useState<string>('');
  const [apApiKey, setApApiKey] = useState<string>('');
  useEffect(() => {
    if (!isOpen) return;
    fetch(`${API_BASE}/agent-defaults`).then(r => r.json())
      .then(d => {
        setAgentMaxConc(d?.maxConcurrency ? String(d.maxConcurrency) : '0');
        setProfile(d?.permissionProfile || 'standard');
        setTaskCap(d?.taskCapUsd != null ? String(d.taskCapUsd) : '2');
        setDailyCap(d?.dailyCapUsd != null ? String(d.dailyCapUsd) : '25');
      })
      .catch(() => {});

    fetch(`${API_BASE}/integrations/activepieces`).then(r => r.json())
      .then(d => {
        setApUrl(d?.webhookUrl || '');
        setApApiKey(d?.apiKey || '');
      })
      .catch(() => {});
  }, [isOpen]);

  const toggleProfile = async (next: 'strict' | 'standard' | 'dangerous') => {
    if (next === 'dangerous' && profile !== 'dangerous') {
      const ok = await confirm({
        title: 'Enable dangerous mode?',
        message: 'Agents will run with full worktree access and skip permission prompts. Enable this only if you trust every agent you run.',
        confirmLabel: 'Enable',
        tone: 'danger',
        requireType: 'SKIP',
      });
      if (!ok) return;
    }
    setProfile(next);
  };

  const handleSave = () => {
    fetch(`${API_BASE}/agent-defaults`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        maxConcurrency: Math.max(0, Math.floor(Number(agentMaxConc) || 0)),
        permissionProfile: profile,
        taskCapUsd: Number(taskCap) || 0,
        dailyCapUsd: Number(dailyCap) || 0,
      }),
    }).catch(() => {});

    fetch(`${API_BASE}/integrations/activepieces`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        webhookUrl: apUrl,
        apiKey: apApiKey,
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
                  {hidden ? <><EyeOff size={13} /> Hidden</> : <><Eye size={13} className="text-emerald-500" /> Shown</>}
                  <input
                    type="checkbox"
                    checked={!hidden}
                    onChange={e => onSetTabHidden(t.id, !e.target.checked)}
                    className="w-5 h-5 accent-emerald-600"
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
          <span className="flex items-center gap-2">
            {/* Inline hint so 0 = unlimited is readable at the field, not just in the caption below. */}
            <span className={`text-2xs font-semibold ${(Number(agentMaxConc) || 0) === 0 ? 'text-emerald-600' : 'text-transparent select-none'}`}>
              unlimited
            </span>
            <input
              type="text"
              inputMode="numeric"
              value={agentMaxConc}
              onChange={e => setAgentMaxConc(e.target.value.replace(/[^\d]/g, ''))}
              data-feature-id="settings-agent-maxconc"
              className="w-24 px-2 py-1.5 text-sm text-right font-mono bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-accent-500"
            />
          </span>
        </label>
        <p className="text-micro text-slate-500 mt-2">Default cap on how many agents run at once <span className="font-semibold">per project</span> — <span className="font-mono">0 = unlimited</span> (still bounded by CPU/RAM). A project can override this in its editor.</p>
      </div>

      <div className="mb-6">
        <h3 className="eyebrow mb-2.5">Agent Budgets (USD)</h3>
        <div className="flex flex-col gap-2">
          <label className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border border-slate-200 bg-slate-50">
            <span className="text-sm font-semibold text-slate-700">Per-task Cap</span>
            <span className="flex items-center gap-2">
              <span className="text-sm text-slate-500">$</span>
              <input
                type="text"
                inputMode="decimal"
                value={taskCap}
                onChange={e => setTaskCap(e.target.value.replace(/[^\d.]/g, ''))}
                className="w-24 px-2 py-1.5 text-sm text-right font-mono bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-accent-500"
              />
            </span>
          </label>
          <label className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border border-slate-200 bg-slate-50">
            <span className="text-sm font-semibold text-slate-700">Daily Project Cap</span>
            <span className="flex items-center gap-2">
              <span className="text-sm text-slate-500">$</span>
              <input
                type="text"
                inputMode="decimal"
                value={dailyCap}
                onChange={e => setDailyCap(e.target.value.replace(/[^\d.]/g, ''))}
                className="w-24 px-2 py-1.5 text-sm text-right font-mono bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-accent-500"
              />
            </span>
          </label>
        </div>
        <p className="text-micro text-slate-500 mt-2">Tasks exceeding their cap are paused. If a project hits the daily cap, all agents stop.</p>
      </div>

      <div className="mb-6">
        <h3 className="eyebrow mb-2.5">Agent Safety</h3>
        <label
          data-feature-id="settings-skip-perms"
          className={`flex items-center justify-between gap-3 px-3 py-3 rounded-lg border transition-colors ${
            profile === 'dangerous' ? 'border-rose-300 bg-rose-50' : 'border-slate-200 bg-slate-50'
          }`}
        >
          <span className="flex items-start gap-2.5 min-w-0">
            <ShieldAlert size={16} className={`mt-0.5 shrink-0 ${profile === 'dangerous' ? 'text-rose-600' : 'text-slate-400'}`} />
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-slate-900">
                Permission Profile
                {profile === 'dangerous' && <span className="ml-2 align-middle text-micro font-bold uppercase tracking-wider text-rose-700">Dangerous</span>}
              </span>
              <span className="block text-2xs text-slate-600 mt-1 leading-relaxed">
                Controls the sandbox strictness for headless agents. Strict: halts and prompts on write. Standard: allows scoped file writes, blocks commands like curl. Dangerous: allows anything, skips all prompts.
              </span>
            </span>
          </span>
          <select
            value={profile}
            onChange={e => toggleProfile(e.target.value as 'strict' | 'standard' | 'dangerous')}
            className="px-2 py-1.5 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-accent-500 cursor-pointer"
          >
            <option value="strict">Strict</option>
            <option value="standard">Standard (Default)</option>
            <option value="dangerous">Dangerous</option>
          </select>
        </label>
        <p className="text-micro text-slate-500 mt-2">
          Passes <span className="font-mono">--permission-mode</span> and a tailored <span className="font-mono">settings.json</span> to each agent.
        </p>
      </div>

      <div className="mb-6">
        <h3 className="eyebrow mb-2.5">Integrations</h3>
        <div className="flex flex-col gap-2">
          <label className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border border-slate-200 bg-slate-50">
            <span className="text-sm font-semibold text-slate-700">Activepieces Webhook URL</span>
            <input
              type="text"
              value={apUrl}
              onChange={e => setApUrl(e.target.value)}
              className="w-64 px-2 py-1.5 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-accent-500"
              placeholder="https://..."
            />
          </label>
          <label className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border border-slate-200 bg-slate-50">
            <span className="text-sm font-semibold text-slate-700">Activepieces API Key</span>
            <input
              type="password"
              value={apApiKey}
              onChange={e => setApApiKey(e.target.value)}
              className="w-64 px-2 py-1.5 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-accent-500"
              placeholder="sk-..."
            />
          </label>
        </div>
        <p className="text-micro text-slate-500 mt-2">Configure your Activepieces connection to enable webhook tools for your agents.</p>
      </div>

      <BoardColumnsEditor columns={cols} onChange={setCols} />
    </Modal>
  );
}
