import React, { useState } from 'react';
import { Play } from 'lucide-react';
import { API_BASE } from '../../apiBase';
import { LogConsole } from '../tasks/components/LogConsole';
import FileTreeSidebar from './FileTreeSidebar';

export default function IDEPage() {
  const [openFiles, setOpenFiles] = useState<{path: string, content: string}[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [running, setRunning] = useState(false);

  const handleFileSelect = async (path: string) => {
    if (!openFiles.find(f => f.path === path)) {
      try {
        const r = await fetch(API_BASE + '/file?path=' + encodeURIComponent(path));
        const d = await r.json();
        setOpenFiles(prev => [...prev, { path, content: d.content || '' }]);
      } catch (e) {
        setOpenFiles(prev => [...prev, { path, content: 'Error loading file' }]);
      }
    }
    setActiveFile(path);
  };

  const closeFile = (path: string) => {
    const next = openFiles.filter(f => f.path !== path);
    setOpenFiles(next);
    if (activeFile === path) {
      setActiveFile(next.length ? next[next.length - 1].path : null);
    }
  };

  const handleRun = async () => {
    setRunning(true);
    setLogs([]);
    try {
      const response = await fetch(API_BASE + '/api/fs/run', { method: 'POST' });
      if (!response.body) throw new Error('No body');
      
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        const newLines = text.split('\n');
        setLogs(prev => {
          if (!prev.length) return newLines;
          const last = prev[prev.length - 1];
          const joined = last + newLines[0];
          return [...prev.slice(0, -1), joined, ...newLines.slice(1)];
        });
      }
    } catch (e: any) {
      setLogs(l => [...l, Run error: {e.message}]);
    } finally {
      setRunning(false);
    }
  };

  const activeContent = openFiles.find(f => f.path === activeFile)?.content || '';

  return (
    <div className="flex flex-col h-screen bg-white">
      <div className="flex items-center border-b border-slate-200 bg-slate-50 px-4 py-2">
        <span className="text-sm font-bold text-slate-800">IDE</span>
      </div>
      <div className="flex flex-1 min-h-0">
        <FileTreeSidebar onFileSelect={handleFileSelect} />
        <div className="flex flex-col flex-1 min-w-0 bg-white">
          <div className="flex items-center border-b border-slate-200 bg-slate-50 pt-2 px-2 shrink-0 overflow-x-auto gap-1">
            {openFiles.map(f => (
              <div 
                key={f.path} 
                className={lex items-center gap-2 px-3 py-1.5 text-xs border rounded-t-md cursor-pointer transition-colors }
                style={{ marginBottom: '-1px' }}
                onClick={() => setActiveFile(f.path)}
              >
                <span>{f.path.split('/').pop()}</span>
                <button onClick={(e) => { e.stopPropagation(); closeFile(f.path); }} className="hover:bg-slate-300 rounded p-0.5 text-slate-400 hover:text-slate-700">×</button>
              </div>
            ))}
          </div>
          <div className="flex-1 overflow-auto custom-scrollbar">
            {activeFile ? (
              <pre className="p-4 text-xs font-mono text-slate-800 whitespace-pre-wrap">{activeContent}</pre>
            ) : (
              <div className="text-slate-400 text-sm flex h-full items-center justify-center">Select a file to open</div>
            )}
          </div>
        </div>
      </div>
      <div className="h-64 border-t border-slate-200 flex flex-col shrink-0">
        <div className="flex items-center justify-between px-4 py-1.5 border-b border-slate-200 bg-slate-50">
          <span className="text-xs font-bold text-slate-600">Terminal Output</span>
          <button onClick={handleRun} disabled={running} className="flex items-center gap-1 text-xs px-3 py-1 bg-emerald-600 text-white font-bold rounded shadow-sm hover:bg-emerald-500 disabled:opacity-50 transition-colors">
            <Play size={12} /> {running ? 'Running...' : 'Run'}
          </button>
        </div>
        <div className="flex-1 min-h-0 relative bg-[#1e1e1e]">
          <LogConsole lines={logs} bare fill tailControl />
        </div>
      </div>
    </div>
  );
}
