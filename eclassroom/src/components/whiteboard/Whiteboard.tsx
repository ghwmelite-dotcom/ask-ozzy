import { Tldraw } from 'tldraw';
import type { Editor } from 'tldraw';
import 'tldraw/tldraw.css';
import { useCallback } from 'react';

interface WhiteboardProps {
  onEditorReady: (editor: Editor) => void;
  readOnly?: boolean;
}

export function Whiteboard({ onEditorReady, readOnly = false }: WhiteboardProps) {
  const handleMount = useCallback((editor: Editor) => {
    editor.user.updateUserPreferences({ colorScheme: 'dark' });
    onEditorReady(editor);
  }, [onEditorReady]);

  return (
    <div className="w-full h-full" style={{ background: '#1a2332' }}>
      <Tldraw
        onMount={handleMount}
        hideUi={readOnly}
        inferDarkMode
      />
    </div>
  );
}
