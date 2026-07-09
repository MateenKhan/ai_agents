import React from 'react';
import { Copy, Check, Sparkles, Terminal } from 'lucide-react';
import { Modal } from './Modal';

interface PromptModalProps {
  isOpen: boolean;
  onClose: () => void;
  prompt: string;
  taskTitle: string;
  copied: boolean;
  onCopy: () => void;
}

export function PromptModal({ isOpen, onClose, prompt, taskTitle, copied, onCopy }: PromptModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Task launched"
      subtitle={taskTitle}
      icon={<Sparkles className="w-5 h-5 text-accent-600" />}
      maxW="sm:max-w-2xl"
      featureId="prompt-modal"
      footer={
        <button
          onClick={onClose}
          className="mx-auto text-xs font-bold text-slate-500 hover:text-slate-800 uppercase tracking-widest transition-all"
        >
          Done
        </button>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600 leading-relaxed">
          The swarm picked this up — nothing to paste. This is the prompt your agent received; it
          updates the task status itself as it works.
        </p>

        <div className="relative group">
          <textarea
            readOnly
            value={prompt}
            className="w-full bg-surface-console border border-surface-border rounded-xl p-5 text-xs font-mono text-slate-300 leading-relaxed h-48 focus:outline-none custom-scrollbar"
          />
          <button
            onClick={onCopy}
            className={`absolute top-4 right-4 flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all shadow-lg ${
              copied
              ? 'bg-emerald-500 text-white'
              : 'bg-slate-900 hover:bg-slate-800 text-white group-hover:scale-105'
            }`}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? 'Copied' : 'Copy prompt'}
          </button>
        </div>

        <div className="flex items-center gap-3 p-4 bg-slate-50 rounded-xl border border-slate-200">
          <div className="p-2 bg-amber-50 rounded-lg">
            <Terminal className="w-4 h-4 text-amber-600" />
          </div>
          <p className="text-micro text-slate-500 leading-tight">
            <span className="text-amber-600 font-bold block mb-0.5">Tip</span>
            Watch it work in the <span className="text-slate-700 font-semibold">Logs</span> tab.
          </p>
        </div>
      </div>
    </Modal>
  );
}
