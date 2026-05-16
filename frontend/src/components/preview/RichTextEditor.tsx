import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import {
  Bold, Italic, Strikethrough, Code, List, ListOrdered,
  Heading1, Heading2, Quote, Undo, Redo,
} from 'lucide-react';

interface Props {
  content: string;
  onChange: (html: string) => void;
  placeholder?: string;
}

export default function RichTextEditor({ content, onChange, placeholder }: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Placeholder.configure({ placeholder: placeholder || '开始输入…' }),
    ],
    content,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: {
      attributes: {
        class: 'prose prose-sm dark:prose-invert max-w-none outline-none min-h-[300px] px-6 py-4 text-gray-900 dark:text-gray-100',
      },
    },
    autofocus: true,
  });

  if (!editor) return null;

  const Btn = ({ onClick, active, children }: { onClick: () => void; active: boolean; children: React.ReactNode }) => (
    <button
      type="button"
      onClick={onClick}
      className={`p-1.5 rounded transition-colors ${active ? 'bg-white/15 text-white' : 'text-white/60 hover:text-white hover:bg-white/10'}`}
    >
      {children}
    </button>
  );

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-0.5 px-3 py-1.5 bg-white/5 border-b border-white/10 flex-shrink-0 overflow-x-auto">
        <Btn onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')}><Bold className="w-3.5 h-3.5" /></Btn>
        <Btn onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')}><Italic className="w-3.5 h-3.5" /></Btn>
        <Btn onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive('strike')}><Strikethrough className="w-3.5 h-3.5" /></Btn>
        <span className="w-px h-5 bg-white/10 mx-1" />
        <Btn onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} active={editor.isActive('heading', { level: 1 })}><Heading1 className="w-3.5 h-3.5" /></Btn>
        <Btn onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive('heading', { level: 2 })}><Heading2 className="w-3.5 h-3.5" /></Btn>
        <span className="w-px h-5 bg-white/10 mx-1" />
        <Btn onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')}><List className="w-3.5 h-3.5" /></Btn>
        <Btn onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')}><ListOrdered className="w-3.5 h-3.5" /></Btn>
        <Btn onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive('blockquote')}><Quote className="w-3.5 h-3.5" /></Btn>
        <Btn onClick={() => editor.chain().focus().toggleCodeBlock().run()} active={editor.isActive('codeBlock')}><Code className="w-3.5 h-3.5" /></Btn>
        <span className="flex-1" />
        <Btn onClick={() => editor.chain().focus().undo().run()} active={false}><Undo className="w-3.5 h-3.5" /></Btn>
        <Btn onClick={() => editor.chain().focus().redo().run()} active={false}><Redo className="w-3.5 h-3.5" /></Btn>
      </div>
      {/* Content */}
      <div className="flex-1 overflow-auto bg-gray-950">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
