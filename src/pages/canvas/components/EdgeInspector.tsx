import React from 'react';
import { Edge } from '@xyflow/react';
import {
  Activity,
  Palette,
  Zap,
  Minus,
  ArrowRight,
  Trash2,
  X,
  Tag,
  Sliders,
  Check
} from 'lucide-react';

interface EdgeInspectorProps {
  selectedEdge: Edge | null;
  onUpdateEdge: (edgeId: string, updatedData: Record<string, unknown>) => void;
  onDeleteEdge?: (edgeId: string) => void;
  onClose?: () => void;
}

const PRESET_COLORS = [
  { name: 'Blue', hex: '#3b82f6' },
  { name: 'Emerald', hex: '#10b981' },
  { name: 'Amber', hex: '#f97316' },
  { name: 'Purple', hex: '#8b5cf6' },
  { name: 'Rose', hex: '#ef4444' },
  { name: 'Cyan', hex: '#06b6d4' },
  { name: 'Slate', hex: '#64748b' },
];

export const EdgeInspector: React.FC<EdgeInspectorProps> = ({
  selectedEdge,
  onUpdateEdge,
  onDeleteEdge,
  onClose,
}) => {
  if (!selectedEdge) return null;

  const edgeData = selectedEdge.data || {};
  const currentColor = (edgeData.color as string) || '#3b82f6';
  const currentSpeed = (edgeData.speed as 'fast' | 'normal' | 'slow') || 'normal';
  const currentStrokeStyle = (edgeData.strokeStyle as 'solid' | 'dashed') || 'solid';
  const currentArrowhead = (edgeData.arrowhead as 'arrow' | 'none' | 'dot') || 'arrow';
  const currentLabel = (edgeData.label as string) || '';
  const animatedPackets = edgeData.animatedPackets !== false;

  const handleDataChange = (key: string, value: unknown) => {
    onUpdateEdge(selectedEdge.id, {
      ...edgeData,
      [key]: value,
    });
  };

  return (
    <div className="w-72 bg-white border-l border-slate-200 flex flex-col h-full shrink-0 select-none shadow-sm overflow-y-auto">
      {/* Header */}
      <div className="p-3.5 border-b border-slate-200 bg-slate-50/80 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-blue-100 text-blue-600 flex items-center justify-center">
            <Activity size={14} />
          </div>
          <div>
            <h3 className="text-xs font-bold text-slate-800">Edge Inspector</h3>
            <p className="text-[10px] text-slate-500 font-mono">ID: {selectedEdge.id}</p>
          </div>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X size={14} />
          </button>
        )}
      </div>

      <div className="p-4 space-y-5 flex-1">
        {/* Protocol / Label */}
        <div>
          <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
            <Tag size={13} className="text-slate-500" />
            Connection Label
          </label>
          <input
            type="text"
            placeholder="e.g. HTTPS / REST, gRPC, SQL Query..."
            value={currentLabel}
            onChange={(e) => handleDataChange('label', e.target.value)}
            className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-800 placeholder:text-slate-400"
          />
        </div>

        {/* Edge Color Picker */}
        <div>
          <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Palette size={13} className="text-slate-500" />
            Edge Color
          </label>
          <div className="grid grid-cols-7 gap-1.5 mb-2">
            {PRESET_COLORS.map((c) => (
              <button
                key={c.hex}
                type="button"
                onClick={() => handleDataChange('color', c.hex)}
                className="w-7 h-7 rounded-full border border-slate-200 flex items-center justify-center transition-transform hover:scale-110 relative"
                style={{ backgroundColor: c.hex }}
                title={c.name}
              >
                {currentColor === c.hex && (
                  <Check size={12} className="text-white drop-shadow" />
                )}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={currentColor}
              onChange={(e) => handleDataChange('color', e.target.value)}
              className="w-6 h-6 rounded border border-slate-200 cursor-pointer"
            />
            <input
              type="text"
              value={currentColor}
              onChange={(e) => handleDataChange('color', e.target.value)}
              className="flex-1 px-2.5 py-1 text-xs font-mono border border-slate-200 rounded text-slate-700"
            />
          </div>
        </div>

        {/* Animation Speed */}
        <div>
          <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Zap size={13} className="text-slate-500" />
            Packet Speed
          </label>
          <div className="grid grid-cols-3 gap-1.5 bg-slate-100 p-1 rounded-lg border border-slate-200/80">
            {(['fast', 'normal', 'slow'] as const).map((speedOption) => (
              <button
                key={speedOption}
                type="button"
                onClick={() => handleDataChange('speed', speedOption)}
                className={`py-1.5 px-2 rounded-md text-xs font-semibold capitalize transition-all ${
                  currentSpeed === speedOption
                    ? 'bg-white text-blue-700 shadow-sm font-bold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {speedOption}
              </button>
            ))}
          </div>
        </div>

        {/* Stroke Style */}
        <div>
          <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Minus size={13} className="text-slate-500" />
            Stroke Style
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => handleDataChange('strokeStyle', 'solid')}
              className={`flex items-center justify-center gap-2 py-2 rounded-md text-xs font-semibold border transition-all ${
                currentStrokeStyle === 'solid'
                  ? 'border-blue-500 bg-blue-50/50 text-blue-700'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              <span className="w-8 h-0.5 bg-current rounded-full" />
              Solid
            </button>
            <button
              type="button"
              onClick={() => handleDataChange('strokeStyle', 'dashed')}
              className={`flex items-center justify-center gap-2 py-2 rounded-md text-xs font-semibold border transition-all ${
                currentStrokeStyle === 'dashed'
                  ? 'border-blue-500 bg-blue-50/50 text-blue-700'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              <span className="w-8 border-t-2 border-dashed border-current" />
              Dashed
            </button>
          </div>
        </div>

        {/* Arrowhead */}
        <div>
          <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <ArrowRight size={13} className="text-slate-500" />
            Arrowhead Style
          </label>
          <div className="grid grid-cols-3 gap-1.5">
            {(['arrow', 'dot', 'none'] as const).map((arrowOption) => (
              <button
                key={arrowOption}
                type="button"
                onClick={() => handleDataChange('arrowhead', arrowOption)}
                className={`py-1.5 px-2 rounded-md text-xs font-semibold capitalize border transition-all ${
                  currentArrowhead === arrowOption
                    ? 'border-blue-500 bg-blue-50/50 text-blue-700'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                {arrowOption}
              </button>
            ))}
          </div>
        </div>

        {/* Animated Packets Toggle */}
        <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Sliders size={13} className="text-slate-500" />
            <span className="text-xs font-semibold text-slate-700">Animate Packets</span>
          </div>
          <button
            type="button"
            onClick={() => handleDataChange('animatedPackets', !animatedPackets)}
            className={`w-9 h-5 rounded-full transition-colors relative flex items-center px-0.5 ${
              animatedPackets ? 'bg-blue-600' : 'bg-slate-300'
            }`}
          >
            <span
              className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${
                animatedPackets ? 'translate-x-4' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      </div>

      {/* Footer / Actions */}
      {onDeleteEdge && (
        <div className="p-3.5 border-t border-slate-200 bg-slate-50">
          <button
            type="button"
            onClick={() => onDeleteEdge(selectedEdge.id)}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-md bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold hover:bg-rose-100 transition-colors"
          >
            <Trash2 size={14} />
            Delete Edge
          </button>
        </div>
      )}
    </div>
  );
};
