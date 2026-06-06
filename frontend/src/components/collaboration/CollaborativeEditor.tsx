import { useEffect, useState, useMemo } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import Collaboration from '@tiptap/extension-collaboration';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { Loader2, Users } from 'lucide-react';

interface Props {
  docId: string;
  token: string;
  serverUrl: string;
  userName?: string;
}

export default function CollaborativeEditor({ docId, token, serverUrl, userName }: Props) {
  const [connected, setConnected] = useState(false);
  const [peers, setPeers] = useState(0);
  const [error, setError] = useState('');

  const ydoc = useMemo(() => new Y.Doc(), [docId]);

  const provider = useMemo(() => {
    const safeUrl = /^https?:\/\/[^\s]+$/.test(serverUrl) ? serverUrl : window.location.origin;
    const wsUrl = safeUrl.replace(/^http/, 'ws') + '/api/collab';
    const p = new WebsocketProvider(wsUrl, docId, ydoc, {
      params: { token },
      connect: true,
    });
    p.on('status', (e: { status: string }) => {
      setConnected(e.status === 'connected');
    });
    p.on('sync', () => setConnected(true));
    p.on('connection-error', () => setError('Connection failed'));
    const safeName = String(userName || 'Anonymous').replace(/<[^>]*>/g, '').slice(0, 50) || 'Anonymous';
    p.awareness.setLocalState({ name: safeName, color: randomColor() });
    p.awareness.on('change', () => {
      setPeers(p.awareness.getStates().size - 1); // exclude self
    });
    return p;
  }, [docId, serverUrl, token, ydoc, userName]);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder: 'Start typing…' }),
      Collaboration.configure({ document: ydoc }),
    ],
    editorProps: {
      attributes: { class: 'prose prose-sm max-w-none focus:outline-none min-h-[300px] px-4 py-3' },
    },
  });

  useEffect(() => {
    return () => {
      provider.destroy();
      ydoc.destroy();
    };
  }, [provider, ydoc]);

  if (error) {
    return <div className="flex items-center justify-center h-64 text-red-500">{error}</div>;
  }

  return (
    <div className="collaborative-editor border rounded-xl bg-white dark:bg-gray-800 dark:border-gray-700">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2 flex-1">
          <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {connected ? `${peers} peer(s) connected` : 'Connecting…'}
          </span>
          {!connected && <Loader2 className="w-3 h-3 animate-spin text-gray-400" />}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => editor?.chain().focus().toggleBold().run()}
            className={`p-1.5 rounded ${editor?.isActive('bold') ? 'bg-gray-200 dark:bg-gray-600' : 'hover:bg-gray-100 dark:hover:bg-gray-700'}`}>
            <strong>B</strong>
          </button>
          <button onClick={() => editor?.chain().focus().toggleItalic().run()}
            className={`p-1.5 rounded ${editor?.isActive('italic') ? 'bg-gray-200 dark:bg-gray-600' : 'hover:bg-gray-100 dark:hover:bg-gray-700'}`}>
            <em>I</em>
          </button>
          <button onClick={() => editor?.chain().focus().toggleUnderline().run()}
            className={`p-1.5 rounded ${editor?.isActive('underline') ? 'bg-gray-200 dark:bg-gray-600' : 'hover:bg-gray-100 dark:hover:bg-gray-700'}`}>
            <u>U</u>
          </button>
          <button onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
            className={`p-1.5 rounded ${editor?.isActive('heading') ? 'bg-gray-200 dark:bg-gray-600' : 'hover:bg-gray-100 dark:hover:bg-gray-700'}`}>
            H2
          </button>
          <button onClick={() => editor?.chain().focus().toggleBulletList().run()}
            className={`p-1.5 rounded ${editor?.isActive('bulletList') ? 'bg-gray-200 dark:bg-gray-600' : 'hover:bg-gray-100 dark:hover:bg-gray-700'}`}>
            • List
          </button>
        </div>
        <div className="flex items-center gap-1 ml-2 text-gray-400">
          <Users className="w-3.5 h-3.5" />
          <span className="text-xs">{peers + 1}</span>
        </div>
      </div>

      {/* Editor */}
      <EditorContent editor={editor} className="min-h-[300px]" />
    </div>
  );
}

const COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4'];
function randomColor() { return COLORS[Math.floor(Math.random() * COLORS.length)]; }
