import React, { useState } from 'react';
import { Sparkles, Send, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { VisualTweaks } from '../types';
import { useProjects } from '../../tasks/projectContext';
import { API_BASE } from '../../../apiBase';

interface AgentPromptBarProps {
  code: string;
  tweaks: VisualTweaks;
  onSuccess?: (message: string) => void;
}

export const AgentPromptBar: React.FC<AgentPromptBarProps> = ({
  code,
  tweaks,
  onSuccess,
}) => {
  const { activeId } = useProjects();
  const [prompt, setPrompt] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;

    setIsSending(true);
    setStatusMsg(null);

    try {
      const activeProject = activeId || 'default-project';
            const description = [
        'Visual Studio Design Request:',
        'Prompt: ' + prompt,
        '',
        'Current Visual Tweaks:',
        JSON.stringify(tweaks, null, 2),
        '',
        'Current Component Code:',
        code
      ].join('ln');

      const res = await fetch(`${API_BASE}/tasks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: `Visual Designer: ${prompt.slice(0, 50)}${prompt.length > 50 ? '...' : ''}`,
          description,
          status: 'pending',
          project: activeProject,
        }),
      });

      if (!res.ok) {
        throw new Error(`Failed to send task (${res.status})`);
      }

      setStatusMsg({
        type: 'success',
        text: 'Sent to Agent! Task queued for processing.',
      });
      setPrompt('');
      if (onSuccess) {
        onSuccess('Sent to Agent! Task queued for processing.');
      }
    } catch (err: any) {
      console.error('Error sending task to agent:', err);
      setStatusMsg({
        type: 'error',
        text: err?.message || 'Could not send task to agent.',
      });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div
      data-testid="agent-prompt-bar"
      className="border-t border-slate-800 bg-slate-900/95 backdrop-blur px-4 py-3 shrink-0"
    >
      <form onSubmit={handleSend} className="max-w-5xl mx-auto flex items-center gap-3">
        <div className="flex items-center gap-2 text-indigo-400 font-bold text-xs uppercase tracking-wider px-2 shrink-0">
          <Sparkles size={16} />
          <span className="hidden sm:inline">Agent Assist</span>
        </div>

        <div className="flex-1 relative">
          <input
            type="text"
            data-testid="agent-prompt-input"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={isSending}
            placeholder="Ask agent to modify component, layout, or design (e.g. 'Add dark mode toggle button in header')..."
            className="w-full bg-slate-800 border border-slate-700 rounded-full py-2 pl-4 pr-10 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition-colors disabled:opacity-60"
          />
        </div>

        <button
          type="submit"
          data-testid="agent-prompt-submit"
          disabled={isSending || !prompt.trim()}
          className="btn btn-primary rounded-full px-4 py-2 flex items-center gap-1.5 text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
       >
          {isSending ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              <span>Sending...</span>
            </>
          ) : (
            <>
              <span>Send to Agent</span>
              <Send size={13} />
            </>
          )}
        </button>
      </form>

      {statusMsg && (
        <div className="max-w-5xl mx-auto mt-2 flex items-center justify-end">
          <span
            data-testid="agent-prompt-status"
            className={`text-2xs flex items-center gap-1 font-medium ${
              statusMsg.type === 'success' ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {statusMsg.type === 'success' ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
            {statusMsg.text}
          </span>
        </div>
      )}
    </div>
  );
};
