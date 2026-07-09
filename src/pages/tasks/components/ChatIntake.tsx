import React, { useState, useEffect } from 'react';
import { MessagesSquare } from 'lucide-react';
import { Modal } from './Modal';
import { API_BASE } from '../../../apiBase';

const PHASES = [
  'Reading your request…',
  'Splitting it into concrete tasks…',
  'Writing GIVEN / WHEN / THEN scenarios…',
  'Sizing each task for an agent…',
  'Handing off to the orchestrator…',
];

interface Created { id: string; title: string; status: string; }

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onCreated: () => void;
}

/**
 * Chat-to-tasks intake. Describe the work in plain language; the server runs
 * `claude -p` to split it into GIVEN/WHEN/THEN scenario-tasks and creates them
 * (WORKING), so the orchestrator starts the agents immediately.
 */
export const ChatIntake: React.FC<Props> = ({ isOpen, onClose, onCreated }) => {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created[] | null>(null);
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    if (!busy) { setPhase(0); return; }
    const iv = setInterval(() => setPhase(p => (p + 1) % PHASES.length), 2200);
    return () => clearInterval(iv);
  }, [busy]);

  const submit = async () => {
    if (!message.trim() || busy) return;
    setBusy(true); setError(null); setCreated(null);
    try {
      const res = await fetch(`${API_BASE}/intake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: message.trim(), autoStart: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Intake failed');
      setCreated(data.created || []);
      setMessage('');
      onCreated();
    } catch (e: any) {
      setError(e?.message || 'Failed to create tasks');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Chat to create tasks"
      subtitle="Describe the work — it’s split into tasks the agents run."
      icon={<MessagesSquare size={20} className="text-accent-600" />}
      maxW="sm:max-w-lg"
      featureId="chat-intake"
      footer={
        <div className="flex items-center justify-end gap-2 w-full">
          <button onClick={onClose} className="px-3 py-2 text-xs font-bold text-slate-500 hover:text-slate-800">Close</button>
          <button
            onClick={submit}
            disabled={busy || !message.trim()}
            className="px-4 py-2 text-xs font-bold rounded-lg bg-slate-900 text-white disabled:opacity-50 flex items-center gap-2"
          >
            {busy && <span className="w-3 h-3 border-2 border-white/60 border-t-transparent rounded-full animate-spin" />}
            {busy ? 'Breaking it down…' : 'Create tasks'}
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <textarea
          value={message}
          onChange={e => setMessage(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(); }}
          rows={4}
          disabled={busy}
          placeholder="e.g. add a keyboard shortcut to toggle the grid, and fix the export button on mobile"
          className="w-full rounded-xl border border-slate-200 p-3 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-accent-300 resize-none disabled:bg-slate-50"
          autoFocus
        />

        {error && (
          <div className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</div>
        )}

        {created && (
          <div className="text-xs bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 space-y-1">
            <div className="font-bold text-emerald-700">Created {created.length} task{created.length !== 1 ? 's' : ''} — agents starting:</div>
            {created.map(c => <div key={c.id} className="text-emerald-800">• {c.title}</div>)}
          </div>
        )}

        {busy && (
          <div className="flex items-center gap-2 justify-center text-[12px] text-accent-600 bg-accent-50 border border-accent-100 rounded-lg px-3 py-2">
            <span className="w-3 h-3 border-2 border-accent-400 border-t-transparent rounded-full animate-spin" />
            <span>{PHASES[phase]}</span>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default ChatIntake;
