import React, { useState, useCallback } from 'react';
import { ReactFlow, MiniMap, Controls, Background, useNodesState, useEdgesState, addEdge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Link } from 'react-router-dom';
import { ChevronLeft, Save, Code, RefreshCw, Loader2 } from 'lucide-react';
import { nodeTypes } from './components/CustomNodes';
import { InspectorPanel } from './components/InspectorPanel';

const initialNodes = [
  { id: '1', type: 'gateway', position: { x: 250, y: 50 }, data: { label: 'API Gateway' } },
  { id: '2', type: 'springBoot', position: { x: 100, y: 200 }, data: { label: 'Auth Service', hasRedis: true } },
  { id: '3', type: 'springBoot', position: { x: 400, y: 200 }, data: { label: 'Payment Service' } },
  { id: '4', type: 'database', position: { x: 100, y: 400 }, data: { label: 'Auth DB' } },
];

const initialEdges = [
  { id: 'e1-2', source: '1', target: '2' },
  { id: 'e1-3', source: '1', target: '3' },
  { id: 'e2-4', source: '2', target: '4' },
];

const CanvasPage = () => {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  const handleGenerateCode = async () => {
    setIsGenerating(true);
    // Simulate sending canvas JSON to backend parser
    await new Promise(resolve => setTimeout(resolve, 1500));
    setIsGenerating(false);
    alert('Code generation triggered successfully!');
  };

  const handleSyncRepo = async () => {
    setIsSyncing(true);
    // Simulate fetching JSON from backend scanner
    await new Promise(resolve => setTimeout(resolve, 1500));
    setIsSyncing(false);
    alert('Canvas synced with repository successfully!');
  };

  const onConnect = useCallback((params: any) => setEdges((eds) => addEdge(params, eds)), [setEdges]);

  const onNodeClick = useCallback((_: any, node: any) => {
    setSelectedNodeId(node.id);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
  }, []);

  const updateNodeData = useCallback((id: string, data: any) => {
    setNodes((nds) => nds.map((node) => {
      if (node.id === id) {
        return { ...node, data };
      }
      return node;
    }));
  }, [setNodes]);

  const selectedNode = nodes.find(n => n.id === selectedNodeId);

  return (
    <div className="h-dvh flex flex-col bg-slate-100">
      <div className="h-14 shrink-0 bg-white border-b flex items-center justify-between px-4">
        <Link to="/tasks" className="flex items-center text-sm font-bold text-slate-600 hover:text-slate-900">
          <ChevronLeft size={16} className="mr-1" /> Back to Tasks Board
        </Link>
        <div className="text-sm font-bold text-slate-800">Architecture Canvas</div>
        <div className="flex items-center gap-2">
          <button 
            onClick={handleSyncRepo}
            disabled={isSyncing}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-300 text-slate-700 text-xs font-bold rounded shadow-sm hover:bg-slate-50 disabled:opacity-50 transition-colors"
          >
            {isSyncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Sync from Repository
          </button>
          <button 
            onClick={handleGenerateCode}
            disabled={isGenerating}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white text-xs font-bold rounded shadow-sm hover:bg-emerald-500 disabled:opacity-50 transition-colors"
          >
            {isGenerating ? <Loader2 size={14} className="animate-spin" /> : <Code size={14} />}
            Generate Code
          </button>
          <button className="flex items-center gap-1.5 px-3 py-1.5 bg-accent-600 text-white text-xs font-bold rounded shadow-sm hover:bg-accent-500 transition-colors">
            <Save size={14} /> Build / Verify
          </button>
        </div>
      </div>
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 relative">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            nodeTypes={nodeTypes}
            fitView
          >
            <Controls />
            <MiniMap />
            <Background gap={12} size={1} />
          </ReactFlow>
        </div>
        <InspectorPanel 
          selectedNode={selectedNode} 
          onUpdateNode={updateNodeData} 
        />
      </div>
    </div>
  );
};

export default CanvasPage;
