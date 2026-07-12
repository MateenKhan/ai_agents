import React from 'react';
import { VisualTweaks } from '../types';
import { RotateCcw, Sliders, Type, Palette, Square } from 'lucide-react';

interface TweaksSidebarProps {
  tweaks: VisualTweaks;
  onChange: (tweaks: VisualTweaks) => void;
  onReset: () => void;
}

export const TweaksSidebar: React.FC<TweaksSidebarProps> = ({
  tweaks,
  onChange,
  onReset,
}) => {
  const updateField = <K extends keyof VisualTweaks>(field: K, value: VisualTweaks[K]) => {
    onChange({ ...tweaks, [field]: value });
  };

  return (
    <aside
      data-testid="tweaks-sidebar"
      className="w-72 shrink-0 border-r border-slate-800 bg-slate-900 text-slate-100 flex flex-col h-full overflow-y-auto custom-scrollbar"
   >
      <div className="p-4 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2 font-bold text-sm text-white">
          <Sliders size={16} className="text-indigo-400" />
          <span>Visual Inspector</span>
        </div>
        <button
          onClick={onReset}
          data-testid="tweaks-reset"
          className="text-2xs font-semibold px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors flex items-center gap-1"
          title="Reset to default tweaks"
       >
          <RotateCcw size={12} />
          Reset
        </button>
      </div>

      <div className="p-4 space-y-6">
        {/* Typography Section */}
        <div className="space-y-3">
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-400 uppercase tracking-wider">
            <Type size={14} className="text-indigo-400" />
            <span>Typography</span>
          </div>

          <div>
            <label className="block text-2xs font-medium text-slate-400 mb-1">Font Family</label>
            <select
              data-testid="tweak-font-family"
              value={tweaks.fontFamily}
              onChange={(e) => updateField('fontFamily', e.target.value)}
              className="w-full text-xs bg-slate-800 border border-slate-700 rounded px-2.5 py-1.5 text-slate-200 focus:outline-none focus:border-indigo-500"
            >
              <option value="Inter">Inter (Modern Sans)</option>
              <option value="Roboto">Roboto</option>
              <option value="Outfit">Outfit</option>
              <option value="system-ui">System UI</option>
              <option value="monospace">Monospace</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-2xs font-medium text-slate-400 mb-1">Font Size</label>
              <select
                data-testid="tweak-font-size"
                value={tweaks.fontSize}
                onChange={(e) => updateField('fontSize', e.target.value)}
                className="w-full text-xs bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-slate-200 focus:outline-none focus:border-indigo-500"
              >
                <option value="14px">14px</option>
                <option value="15px">15px</option>
                <option value="16px">16px</option>
                <option value="18px">18px</option>
                <option value="20px">20px</option>
              </select>
            </div>

            <div>
              <label className="block text-2xs font-medium text-slate-400 mb-1">Weight</label>
              <select
                data-testid="tweak-font-weight"
                value={tweaks.fontWeight}
                onChange={(e) => updateField('fontWeight', e.target.value)}
                className="w-full text-xs bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-slate-200 focus:outline-none focus:border-indigo-500"
              >
                <option value="300">300 Light</option>
                <option value="400">400 Regular</option>
                <option value="500">500 Medium</option>
                <option value="600">600 SemiBold</option>
                <option value="700">700 Bold</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-2xs font-medium text-slate-400 mb-1">Line Height</label>
            <select
              data-testid="tweak-line-height"
              value={tweaks.lineHeight}
              onChange={(e) => updateField('lineHeight', e.target.value)}
              className="w-full text-xs bg-slate-800 border border-slate-700 rounded px-2.5 py-1.5 text-slate-200 focus:outline-none focus:border-indigo-500"
            >
              <option value="1.4">1.4 Compact</option>
              <option value="1.5">1.5 Normal</option>
              <option value="1.6">1.6 Relaxed</option>
              <option value="1.8">1.8 Spacious</option>
            </select>
          </div>
        </div>

        {/* Colors Section */}
        <div className="space-y-3">
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-400 uppercase tracking-wider">
            <Palette size={14} className="text-pink-400" />
            <span>Colors</span>
          </div>

          <div className="space-y-2">
            <div>
              <label className="block text-2xs font-medium text-slate-400 mb-1">Background Color</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  data-testid="tweak-bg-color-picker"
                  value={tweaks.bgColor}
                  onChange={(e) => updateField('bgColor', e.target.value)}
                  className="w-8 h-7 rounded border border-slate-700 bg-transparent custom-pointer cursor-pointer"
               />
                <input
                  type="text"
                  data-testid="tweak-bg-color"
                  value={tweaks.bgColor}
                  onChange={(e) => updateField('bgColor', e.target.value)}
                  className="flex-1 text-xs bg-slate-800 border border-slate-700 rounded px-2.5 py-1.5 text-slate-200 font-mono"
               />
              </div>
            </div>

            <div>
              <label className="block text-2xs font-medium text-slate-400 mb-1">Text Color</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  data-testid="tweak-text-color-picker"
                  value={tweaks.textColor}
                  onChange={(e) => updateField('textColor', e.target.value)}
                  className="w-8 h-7 rounded border border-slate-700 bg-transparent custom-pointer cursor-pointer"
               />
                <input
                  type="text"
                  data-testid="tweak-text-color"
                  value={tweaks.textColor}
                  onChange={(e) => updateField('textColor', e.target.value)}
                  className="flex-1 text-xs bg-slate-800 border border-slate-700 rounded px-2.5 py-1.5 text-slate-200 font-mono"
               />
              </div>
            </div>

            <div>
              <label className="block text-2xs font-medium text-slate-400 mb-1">Accent Color</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  data-testid="tweak-accent-color-picker"
                  value={tweaks.accentColor}
                  onChange={(e) => updateField('accentColor', e.target.value)}
                  className="w-8 h-7 rounded border border-slate-700 bg-transparent custom-pointer cursor-pointer"
               />
                <input
                  type="text"
                  data-testid="tweak-accent-color"
                  value={tweaks.accentColor}
                  onChange={(e) => updateField('accentColor', e.target.value)}
                  className="flex-1 text-xs bg-slate-800 border border-slate-700 rounded px-2.5 py-1.5 text-slate-200 font-mono"
               />
              </div>
            </div>
          </div>
        </div>

        {/* Borders & Radius Section */}
        <div className="space-y-3">
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-400 uppercase tracking-wider">
            <Square size={14} className="text-emerald-400" />
            <span>Borders & Shape</span>
          </div>

          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="text-2xs font-medium text-slate-400">Border Radius</label>
              <span className="text-2xs font-mono text-slate-300">{tweaks.borderRadius}px</span>
            </div>
            <input
              type="range"
              min="0"
              max="32"
              data-testid="tweak-border-radius"
              value={tweaks.borderRadius}
              onChange={(e) => updateField('borderRadius', Number(e.target.value))}
              className="w-full accent-indigo-500 custom-pointer cursor-pointer"
            />
          </div>

          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="text-2xs font-medium text-slate-400">Border Width</label>
              <span className="text-2xs font-mono text-slate-300">{tweaks.borderWidth}px</span>
            </div>
            <input
              type="range"
              min="0"
              max="8"
              data-testid="tweak-border-width"
              value={tweaks.borderWidth}
              onChange={(e) => updateField('borderWidth', Number(e.target.value))}
              className="w-full accent-indigo-500 custom-pointer cursor-pointer"
            />
          </div>
        </div>
      </div>
    </aside>
  );
};
