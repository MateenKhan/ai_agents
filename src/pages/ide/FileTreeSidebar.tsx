import React, { useEffect, useState } from 'react';
import { API_BASE } from '../../../apiBase';
import { FileCode, Folder, ChevronRight } from 'lucide-react';

interface FileTreeSidebarProps {
  onFileSelect: (path: string) => void;
}

interface TreeNode { name: string; path: string; dir: boolean; children: TreeNode[]; }
function buildTree(paths: string[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', dir: true, children: [] };
  for (const p of paths) {
    const parts = p.split('/');
    let node = root;
    parts.forEach((part, i) => {
      const isFile = i === parts.length - 1;
      let child = node.children.find(c => c.name === part && c.dir === !isFile);
      if (!child) { child = { name: part, path: parts.slice(0, i + 1).join('/'), dir: !isFile, children: [] }; node.children.push(child); }
      node = child;
    });
  }
  const sort = (n: TreeNode) => { n.children.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1)); n.children.forEach(sort); };
  sort(root);
  return root.children;
}

export default function FileTreeSidebar({ onFileSelect }: FileTreeSidebarProps) {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch(API_BASE + '/api/fs/list')
      .then(r => r.json())
      .then(d => {
        const paths = Array.isArray(d) ? d : (d.files || []);
        setTree(buildTree(paths));
      })
      .catch(console.error);
  }, []);

  const toggle = (path: string) => {
    setExpanded(p => {
      const s = new Set(p);
      if (s.has(path)) s.delete(path); else s.add(path);
      return s;
    });
  };

  const renderNode = (n: TreeNode, depth = 0) => {
    const isOpen = expanded.has(n.path);
    if (n.dir) {
      return (
        <div key={n.path}>
          <button 
            className="flex items-center gap-1.5 w-full text-left px-2 py-1.5 hover:bg-slate-200 text-xs text-slate-700 font-semibold"
            style={{ paddingLeft: 8 + depth * 12 }}
            onClick={() => toggle(n.path)}
          >
            <ChevronRight size={12} className={	ransition-transform } />
            <Folder size={13} className="text-amber-500" />
            <span className="truncate">{n.name}</span>
          </button>
          {isOpen && n.children.map(c => renderNode(c, depth + 1))}
        </div>
      );
    }
    return (
      <button
        key={n.path}
        className="group flex items-center gap-1.5 w-full text-left px-2 py-1.5 hover:bg-slate-200 text-xs text-slate-700"
        style={{ paddingLeft: 8 + depth * 12 }}
        onClick={() => onFileSelect(n.path)}
      >
        <FileCode size={13} className="text-slate-400 shrink-0 ml-4 group-hover:text-accent-600 transition-colors" />
        <span className="truncate">{n.name}</span>
      </button>
    );
  };

  return (
    <div className="w-64 border-r border-slate-200 bg-slate-50 flex flex-col h-full shrink-0">
      <div className="p-3 font-bold text-xs text-slate-500 uppercase tracking-wider border-b border-slate-200">Explorer</div>
      <div className="py-2 overflow-y-auto custom-scrollbar flex-1">
        {tree.map(n => renderNode(n))}
      </div>
    </div>
  );
}
