import React from 'react';

interface InspectorPanelProps {
  selectedNode: any;
  onUpdateNode: (id: string, data: any) => void;
}

export const InspectorPanel = ({ selectedNode, onUpdateNode }: InspectorPanelProps) => {
  if (!selectedNode) {
    return (
      <div className="w-64 bg-slate-50 border-l border-slate-200 p-4 shrink-0 overflow-y-auto">
        <h3 className="text-sm font-bold text-slate-700 mb-2">Inspector</h3>
        <p className="text-xs text-slate-500">Select a node to inspect</p>
      </div>
    );
  }

  const { id, type, data } = selectedNode;

  return (
    <div className="w-64 bg-slate-50 border-l border-slate-200 p-4 shrink-0 overflow-y-auto">
      <h3 className="text-sm font-bold text-slate-700 mb-4">Inspector: {type}</h3>
      
      <div className="mb-4">
        <label className="block text-xs font-bold text-slate-600 mb-1">Label</label>
        <input 
          type="text" 
          value={data.label || ''} 
          onChange={(e) => onUpdateNode(id, { ...data, label: e.target.value })}
          className="w-full text-sm border border-slate-300 rounded px-2 py-1"
        />
      </div>

      {type === 'springBoot' && (
        <div className="space-y-2">
          <label className="flex items-center text-xs text-slate-700">
            <input 
              type="checkbox" 
              checked={data.hasConfigServer || false} 
              onChange={(e) => onUpdateNode(id, { ...data, hasConfigServer: e.target.checked })}
              className="mr-2"
            />
            ConfigServer
          </label>
          <label className="flex items-center text-xs text-slate-700">
            <input 
              type="checkbox" 
              checked={data.hasRedis || false} 
              onChange={(e) => onUpdateNode(id, { ...data, hasRedis: e.target.checked })}
              className="mr-2"
            />
            Redis
          </label>
          <label className="flex items-center text-xs text-slate-700">
            <input 
              type="checkbox" 
              checked={data.hasKafka || false} 
              onChange={(e) => onUpdateNode(id, { ...data, hasKafka: e.target.checked })}
              className="mr-2"
            />
            Kafka
          </label>
        </div>
      )}
    </div>
  );
};
