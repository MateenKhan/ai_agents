import React, { useState, useCallback } from 'react';
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  Edge,
  Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Code, RefreshCw, Loader2 } from 'lucide-react';
import { nodeTypes } from './components/CustomNodes';
import { InspectorPanel } from './components/InspectorPanel';
import { NodePalette, PaletteItem } from './components/NodePalette';
import { TrafficFlowEdge } from './components/TrafficFlowEdge';
import { EdgeInspector } from './components/EdgeInspector';
import { CatalogInspector, hasCatalogForNodeType } from './components/CatalogInspector';
import { ControlFlowInspector, isControlFlowNodeType } from './components/ControlFlowInspector';
import { StudioNavbar } from '../../components/navigation/StudioNavbar';

const edgeTypes = {
  trafficFlow: TrafficFlowEdge,
  default: TrafficFlowEdge,
};

const initialNodes: Node[] = [
  { id: '1', type: 'gateway', position: { x: 250, y: 50 }, data: { label: 'API Gateway' } },
  { id: '2', type: 'springBoot', position: { x: 100, y: 220 }, data: { label: 'Auth Service', hasRedis: true } },
  { id: '3', type: 'springBoot', position: { x: 420, y: 220 }, data: { label: 'Payment Service' } },
  { id: '4', type: 'database', position: { x: 100, y: 420 }, data: { label: 'Auth DB' } },
];

const initialEdges: Edge[] = [
  {
    id: 'e1-2',
    source: '1',
    target: '2',
    type: 'trafficFlow',
    data: { label: 'HTTPS / REST', color: '#3b82f6', speed: 'normal', strokeStyle: 'solid', animatedPackets: true },
  },
  {
    id: 'e1-3',
    source: '1',
    target: '3',
    type: 'trafficFlow',
    data: { label: 'gRPC Stream', color: '#10b981', speed: 'fast', strokeStyle: 'dashed', animatedPackets: true },
  },
  {
    id: 'e2-4',
    source: '2',
    target: '4',
    type: 'trafficFlow',
    data: { label: 'SQL Query', color: '#8b5cf6', speed: 'normal', strokeStyle: 'solid', animatedPackets: true },
  },
];

const CanvasPage = () => {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  const handleGenerateCode = async () => {
    setIsGenerating(true);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    setIsGenerating(false);
    alert('Code generation triggered successfully!');
  };

  const handleSyncRepo = async () => {
    setIsSyncing(true);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    setIsSyncing(false);
    alert('Canvas synced with repository successfully!');
  };

  const onConnect = useCallback(
    (params: Connection) =>
      setEdges((eds) =>
        addEdge(
          {
            ...params,
            type: 'trafficFlow',
            data: {
              label: 'Data Stream',
              color: '#3b82f6',
              speed: 'normal',
              strokeStyle: 'solid',
              animatedPackets: true,
            },
          },
          eds
        )
      ),
    [setEdges]
  );

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNodeId(node.id);
    setSelectedEdgeId(null);
  }, []);

  const onEdgeClick = useCallback((_: React.MouseEvent, edge: Edge) => {
    setSelectedEdgeId(edge.id);
    setSelectedNodeId(null);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
  }, []);

  const updateNodeData = useCallback(
    (id: string, data: Record<string, unknown>) => {
      setNodes((nds) =>
        nds.map((node) => {
          if (node.id === id) {
            return { ...node, data };
          }
          return node;
        })
      );
    },
    [setNodes]
  );

  const updateEdgeData = useCallback(
    (id: string, data: Record<string, unknown>) => {
      setEdges((eds) =>
        eds.map((edge) => {
          if (edge.id === id) {
            return { ...edge, data };
          }
          return edge;
        })
      );
    },
    [setEdges]
  );

  const deleteEdge = useCallback(
    (id: string) => {
      setEdges((eds) => eds.filter((edge) => edge.id !== id));
      if (selectedEdgeId === id) {
        setSelectedEdgeId(null);
      }
    },
    [selectedEdgeId, setEdges]
  );

  const handleAddNodeFromPalette = useCallback(
    (item: PaletteItem) => {
      const newId = `${item.id}-${Date.now()}`;
      const newNode: Node = {
        id: newId,
        type: item.type || 'cloud',
        position: { x: 300 + Math.random() * 150, y: 150 + Math.random() * 150 },
        data: {
          label: item.label,
          description: item.description,
          color: item.color,
          iconType: item.iconType,
          category: item.category,
        },
      };
      setNodes((nds) => nds.concat(newNode));
      setSelectedNodeId(newId);
      setSelectedEdgeId(null);
    },
    [setNodes]
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const type = event.dataTransfer.getData('application/reactflow/type');
      const label = event.dataTransfer.getData('application/reactflow/label');
      const category = event.dataTransfer.getData('application/reactflow/category');
      const color = event.dataTransfer.getData('application/reactflow/color');
      const iconType = event.dataTransfer.getData('application/reactflow/iconType');

      if (!type || !label) return;

      const bounds = event.currentTarget.getBoundingClientRect();
      const position = {
        x: event.clientX - bounds.left - 75,
        y: event.clientY - bounds.top - 25,
      };

      const newId = `${type}-${Date.now()}`;
      const newNode: Node = {
        id: newId,
        type: type,
        position,
        data: {
          label,
          category,
          color,
          iconType,
        },
      };

      setNodes((nds) => nds.concat(newNode));
      setSelectedNodeId(newId);
      setSelectedEdgeId(null);
    },
    [setNodes]
  );

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);
  const selectedEdge = edges.find((e) => e.id === selectedEdgeId) || null;

  return (
    <div className="h-dvh flex flex-col bg-slate-100">
      <StudioNavbar />
      {/* Page toolbar — actions only. Brand, cross-studio nav, and the "Architecture Canvas"
          label all live in StudioNavbar above, so this row never repeats them. */}
      <div className="h-14 shrink-0 bg-white border-b flex items-center justify-end px-4">
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
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Context-aware left panel: the palette by default; when a node is selected it
            swaps to that node type's configuration — the exhaustive framework catalog
            for spring-boot/nestjs/nextjs/fastapi nodes, or the bespoke control-flow
            forms for gateway/saga/circuit-breaker/fork-join nodes. */}
        {selectedNode && hasCatalogForNodeType(selectedNode.type) ? (
          <CatalogInspector
            key={selectedNode.id}
            nodeId={selectedNode.id}
            nodeType={selectedNode.type!}
            nodeData={selectedNode.data as Record<string, unknown>}
            onUpdateNode={updateNodeData}
            onClose={() => setSelectedNodeId(null)}
          />
        ) : selectedNode && isControlFlowNodeType(selectedNode.type) ? (
          <ControlFlowInspector
            key={selectedNode.id}
            nodeId={selectedNode.id}
            nodeType={selectedNode.type}
            nodeData={selectedNode.data as Record<string, unknown>}
            targetNodes={nodes
              .filter((n) => n.id !== selectedNode.id)
              .map((n) => ({ id: n.id, label: (n.data.label as string) || n.id }))}
            onUpdateNode={updateNodeData}
            onClose={() => setSelectedNodeId(null)}
          />
        ) : (
          <NodePalette onAddNode={handleAddNodeFromPalette} />
        )}

        {/* Interactive ReactFlow Canvas */}
        <div
          className="flex-1 relative h-full"
          onDragOver={onDragOver}
          onDrop={onDrop}
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onEdgeClick={onEdgeClick}
            onPaneClick={onPaneClick}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            fitView
          >
            <Controls />
            <MiniMap />
            <Background gap={12} size={1} />
          </ReactFlow>
        </div>

        {/* Right Inspector Panel: the legacy generic inspector is a FALLBACK only. Node types
            that own a dedicated left-panel surface — the framework catalogs
            (spring-boot/nestjs/nextjs/fastapi) and the control-flow forms — already show their
            full configuration on the left, so rendering InspectorPanel too would be two config
            surfaces for one node. Suppress it for those; it stays for plain nodes
            (gateway/database/cloud) that have no catalog. */}
        {selectedNode
          && !hasCatalogForNodeType(selectedNode.type)
          && !isControlFlowNodeType(selectedNode.type) && (
          <InspectorPanel
            selectedNode={selectedNode}
            onUpdateNode={updateNodeData}
          />
        )}
        {selectedEdge && (
          <EdgeInspector
            selectedEdge={selectedEdge}
            onUpdateEdge={updateEdgeData}
            onDeleteEdge={deleteEdge}
            onClose={() => setSelectedEdgeId(null)}
          />
        )}
      </div>
    </div>
  );
};

export default CanvasPage;
