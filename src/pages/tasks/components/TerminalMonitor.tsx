import React from 'react';
import { X, Minus, Square, Terminal, Activity, ChevronRight, Maximize2 } from 'lucide-react';
import { motion, AnimatePresence, useDragControls } from 'framer-motion';
import { LogConsole } from './LogConsole';

interface TerminalMonitorProps {
  isOpen: boolean;
  minimized: boolean;
  onClose: () => void;
  onMinimize: () => void;
  onMaximize: () => void;
  output: string;
  agentName: string | null;
  taskId: string | null;
  bodyRef: React.RefObject<HTMLDivElement | null>;
}

export function TerminalMonitor({
  isOpen,
  minimized,
  onClose,
  onMinimize,
  onMaximize,
  output,
  agentName,
  taskId,
  bodyRef
}: TerminalMonitorProps) {
  const dragControls = useDragControls();

  if (!isOpen) return null;

  return (
    <div className={`fixed z-[100] transition-all duration-300 ease-in-out ${minimized ? 'bottom-6 right-6' : 'bottom-6 right-6 w-full max-w-2xl'}`} style={{ pointerEvents: 'none' }}>
      <motion.div
        layout
        drag
        dragControls={dragControls}
        dragListener={false}
        dragMomentum={false}
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        style={{ pointerEvents: 'auto' }}
        className="bg-[#0f172a] border border-[#1e2d45] rounded-2xl shadow-2xl overflow-hidden flex flex-col"
      >
        {/* Terminal Header */}
        <div 
          className="flex items-center justify-between px-4 py-3 bg-white/5 border-b border-[#1e2d45] cursor-move select-none"
          onPointerDown={(e) => dragControls.start(e)}
        >
          <div className="flex items-center gap-3">
            <div className="flex gap-1.5" onPointerDown={(e) => e.stopPropagation()}>
              <button onClick={onClose} className="w-3 h-3 rounded-full bg-rose-500/80 hover:bg-rose-500 transition-colors" />
              <button onClick={onMinimize} className="w-3 h-3 rounded-full bg-amber-500/80 hover:bg-amber-500 transition-colors" />
              <button onClick={onMaximize} className="w-3 h-3 rounded-full bg-emerald-500/80 hover:bg-emerald-500 transition-colors" />
            </div>
            <div className="w-px h-4 bg-white/10 mx-1" />
            <div className="flex items-center gap-2">
              <Terminal className="w-3.5 h-3.5 text-indigo-400" />
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-300">
                Agent Monitor — {agentName || 'Initializing...'}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[9px] font-bold text-slate-500 uppercase tracking-tighter">Live Stream</span>
            </div>
          </div>
        </div>

        {/* Terminal Body */}
        {!minimized && (
          <>
            <div ref={bodyRef as any} className="h-80 flex flex-col p-3 bg-[#080e1d]">
              <div className="flex items-center gap-2 text-indigo-400 mb-2 opacity-60 shrink-0">
                <ChevronRight size={14} />
                <span>Monitoring session for agent {agentName}...</span>
              </div>
              {output ? (
                <LogConsole
                  text={output}
                  parsed
                  fill
                  searchable
                  timeToggle
                  sizeControls
                  copyable
                  empty="Waiting for signal…"
                />
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center gap-3 opacity-20">
                  <Activity size={32} className="animate-pulse" />
                  <span className="text-[10px] font-bold uppercase tracking-widest">Waiting for signal...</span>
                </div>
              )}
            </div>

            {/* Footer / Status */}
            <div className="px-4 py-1.5 bg-black/40 border-t border-[#1e2d45] flex items-center justify-between">
              <span className="text-[9px] font-bold text-slate-600 uppercase tracking-widest">
                Task ID: {taskId?.slice(-8) || 'N/A'}
              </span>
              <div className="flex items-center gap-3">
                <span className="text-[9px] font-bold text-slate-600 uppercase tracking-widest">
                  Buffers: Syncing
                </span>
              </div>
            </div>
          </>
        )}
      </motion.div>
    </div>
  );
}
