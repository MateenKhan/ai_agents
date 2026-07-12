import React, { useState, useRef } from 'react';
import Editor, { useMonaco, Monaco } from '@monaco-editor/react';

export interface EditorFile {
  id: string;
  name: string;
  content: string;
  language?: string;
}

interface MonacoEditorPanelProps {
  files?: EditorFile[];
  initialActiveFileId?: string;
  onContentChange?: (fileId: string, content: string) => void;
}

const defaultFiles: EditorFile[] = [
  { id: '1', name: 'example.ts', content: 'console.log("Hello World");', language: 'typescript' }
];

const languageOptions = [
  'typescript', 'javascript', 'html', 'css', 'json', 'python', 'markdown', 'plaintext'
];

export function MonacoEditorPanel({ files = defaultFiles, initialActiveFileId, onContentChange }: MonacoEditorPanelProps) {
  const [activeFileId, setActiveFileId] = useState(initialActiveFileId || files[0]?.id);
  const [localFiles, setLocalFiles] = useState<EditorFile[]>(files);
  const [languageOverrides, setLanguageOverrides] = useState<Record<string, string>>({});

  const editorRef = useRef<any>(null);

  const activeFile = localFiles.find(f => f.id === activeFileId);
  const currentLanguage = activeFile ? (languageOverrides[activeFileId] || activeFile.language || 'plaintext') : 'plaintext';
  const currentContent = activeFile ? activeFile.content : '';

  const handleEditorDidMount = (editor: any, monaco: Monaco) => {
    editorRef.current = editor;

    // Bind Alt+LeftArrow for undo
    editor.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.LeftArrow, () => {
      editor.trigger('keyboard', 'cursorUndo', null);
    });

    // Bind Alt+RightArrow for redo
    editor.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.RightArrow, () => {
      editor.trigger('keyboard', 'cursorRedo', null);
    });
  };

  const handleLanguageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (activeFileId) {
      setLanguageOverrides({ ...languageOverrides, [activeFileId]: e.target.value });
    }
  };

  const handleContentChange = (value: string | undefined) => {
    if (activeFileId) {
      setLocalFiles(prev => prev.map(f => f.id === activeFileId ? { ...f, content: value || '' } : f));
      if (onContentChange) {
        onContentChange(activeFileId, value || '');
      }
    }
  };

  if (!activeFile) return null;

  return (
    <div className="flex flex-col w-full h-full border border-gray-700 rounded-lg overflow-hidden bg-gray-900">
      {/* Tab bar and language selector */}
      <div className="flex items-center justify-between bg-gray-800 border-b border-gray-700 px-2 h-10">
        <div className="flex items-center overflow-x-auto">
          {localFiles.map(file => (
            <button
              key={file.id}
              onClick={() => setActiveFileId(file.id)}
              className={`px-4 py-1.5 text-sm font-medium border-r border-gray-700 whitespace-nowrap focus:outline-none ${
                activeFileId === file.id
                  ? 'bg-gray-700 text-white'
                  : 'bg-transparent text-gray-400 hover:text-gray-200 hover:bg-gray-750'
              }`}
            >
              {file.name}
            </button>
          ))}
        </div>
        <div className="flex items-center px-2">
          <select
            value={currentLanguage}
            onChange={handleLanguageChange}
            className="bg-gray-700 text-white text-xs rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500 border border-gray-600"
          >
            {languageOptions.map(lang => (
              <option key={lang} value={lang}>{lang}</option>
            ))}
          </select>
        </div>
      </div>
      
      {/* Editor area */}
      <div className="flex-1 relative min-h-[400px]">
        <Editor
          height="100%"
          language={currentLanguage}
          value={currentContent}
          theme="vs-dark"
          onChange={handleContentChange}
          onMount={handleEditorDidMount}
          options={{
            minimap: { enabled: false },
            fontSize: 14,
            wordWrap: 'on',
          }}
        />
      </div>
    </div>
  );
}
