import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { TextStyle } from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import TextAlign from '@tiptap/extension-text-align';
import Underline from '@tiptap/extension-underline';
import HorizontalRule from '@tiptap/extension-horizontal-rule';
import {
  Bold, Italic, Strikethrough, Code, List, ListOrdered, Heading1, Heading2,
  Heading3, Quote, Undo, Redo, Underline as UnderlineIcon, AlignLeft,
  AlignCenter, AlignRight, AlignJustify, Link as LinkIcon, ImageIcon,
  Table as TableIcon, Minus, Palette, Highlighter,
} from 'lucide-react';

const COLORS = ['#000000', '#434343', '#666666', '#999999', '#b7b7b7', '#cc0000', '#e06666', '#f6b26b', '#ffd966', '#93c47d', '#6d9eeb', '#8e7cc3', '#ffffff', '#efefef', '#f4cccc', '#fce5cd', '#fff2cc', '#d9ead3', '#c9daf8', '#d9d2e9'];

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
      Table.configure({ resizable: true }),
      TableRow, TableCell, TableHeader,
      TextStyle, Color, Highlight.configure({ multicolor: true }),
      Underline, Link.configure({ openOnClick: false }), Image,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      HorizontalRule,
    ],
    content,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: {
      attributes: {
        class: 'prose prose-sm dark:prose-invert max-w-none outline-none min-h-[300px] px-8 py-6 text-gray-900 dark:text-gray-100',
      },
    },
    autofocus: true,
  });

  if (!editor) return null;

  const Btn = ({ onClick, active, children, title }: { onClick: () => void; active: boolean; children: React.ReactNode; title?: string }) => (
    <button type="button" onClick={onClick} title={title}
      className={`p-1.5 rounded transition-colors ${active ? 'bg-white/15 text-white' : 'text-white/60 hover:text-white hover:bg-white/10'}`}>
      {children}
    </button>
  );

  const setColor = (color: string) => editor.chain().focus().setColor(color).run();
  const setHighlight = (color: string) => editor.chain().focus().toggleHighlight({ color }).run();
  const addTable = () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
  const addLink = () => {
    const url = window.prompt('输入链接地址');
    if (url) editor.chain().focus().setLink({ href: url }).run();
  };
  const addImage = () => {
    const url = window.prompt('输入图片地址');
    if (url) editor.chain().focus().setImage({ src: url }).run();
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-0.5 px-3 py-1.5 bg-white/5 border-b border-white/10 flex-shrink-0 overflow-x-auto flex-wrap">
        <Btn onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="加粗"><Bold className="w-3.5 h-3.5" /></Btn>
        <Btn onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="斜体"><Italic className="w-3.5 h-3.5" /></Btn>
        <Btn onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive('underline')} title="下划线"><UnderlineIcon className="w-3.5 h-3.5" /></Btn>
        <Btn onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive('strike')} title="删除线"><Strikethrough className="w-3.5 h-3.5" /></Btn>
        <span className="w-px h-5 bg-white/10 mx-1" />
        <Btn onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} active={editor.isActive('heading', { level: 1 })} title="标题1"><Heading1 className="w-3.5 h-3.5" /></Btn>
        <Btn onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive('heading', { level: 2 })} title="标题2"><Heading2 className="w-3.5 h-3.5" /></Btn>
        <Btn onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive('heading', { level: 3 })} title="标题3"><Heading3 className="w-3.5 h-3.5" /></Btn>
        <span className="w-px h-5 bg-white/10 mx-1" />
        <Btn onClick={() => editor.chain().focus().setTextAlign('left').run()} active={editor.isActive({ textAlign: 'left' })} title="左对齐"><AlignLeft className="w-3.5 h-3.5" /></Btn>
        <Btn onClick={() => editor.chain().focus().setTextAlign('center').run()} active={editor.isActive({ textAlign: 'center' })} title="居中"><AlignCenter className="w-3.5 h-3.5" /></Btn>
        <Btn onClick={() => editor.chain().focus().setTextAlign('right').run()} active={editor.isActive({ textAlign: 'right' })} title="右对齐"><AlignRight className="w-3.5 h-3.5" /></Btn>
        <Btn onClick={() => editor.chain().focus().setTextAlign('justify').run()} active={editor.isActive({ textAlign: 'justify' })} title="两端对齐"><AlignJustify className="w-3.5 h-3.5" /></Btn>
        <span className="w-px h-5 bg-white/10 mx-1" />
        <Btn onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title="无序列表"><List className="w-3.5 h-3.5" /></Btn>
        <Btn onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="有序列表"><ListOrdered className="w-3.5 h-3.5" /></Btn>
        <Btn onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive('blockquote')} title="引用"><Quote className="w-3.5 h-3.5" /></Btn>
        <Btn onClick={() => editor.chain().focus().toggleCodeBlock().run()} active={editor.isActive('codeBlock')} title="代码块"><Code className="w-3.5 h-3.5" /></Btn>
        <span className="w-px h-5 bg-white/10 mx-1" />
        <Btn onClick={addTable} active={editor.isActive('table')} title="插入表格"><TableIcon className="w-3.5 h-3.5" /></Btn>
        <Btn onClick={addLink} active={editor.isActive('link')} title="插入链接"><LinkIcon className="w-3.5 h-3.5" /></Btn>
        <Btn onClick={addImage} active={false} title="插入图片"><ImageIcon className="w-3.5 h-3.5" /></Btn>
        <Btn onClick={() => editor.chain().focus().setHorizontalRule().run()} active={false} title="分割线"><Minus className="w-3.5 h-3.5" /></Btn>
        <span className="w-px h-5 bg-white/10 mx-1" />
        <div className="relative group">
          <button type="button" className="p-1.5 rounded text-white/60 hover:text-white hover:bg-white/10 transition-colors"><Palette className="w-3.5 h-3.5" /></button>
          <div className="absolute top-full left-0 mt-1 bg-gray-800 border border-white/10 rounded-lg p-2 grid grid-cols-10 gap-0.5 hidden group-hover:grid z-50 shadow-xl">
            {COLORS.map(c => (
              <button key={c} type="button" onClick={() => setColor(c)} className="w-4 h-4 rounded-sm border border-white/10" style={{ backgroundColor: c }} title={c} />
            ))}
          </div>
        </div>
        <div className="relative group">
          <button type="button" className="p-1.5 rounded text-white/60 hover:text-white hover:bg-white/10 transition-colors"><Highlighter className="w-3.5 h-3.5" /></button>
          <div className="absolute top-full left-0 mt-1 bg-gray-800 border border-white/10 rounded-lg p-2 grid grid-cols-10 gap-0.5 hidden group-hover:grid z-50 shadow-xl">
            {COLORS.slice(0, 10).map(c => (
              <button key={c} type="button" onClick={() => setHighlight(c)} className="w-4 h-4 rounded-sm border border-white/10" style={{ backgroundColor: c }} title={c} />
            ))}
          </div>
        </div>
        <span className="flex-1" />
        <Btn onClick={() => editor.chain().focus().undo().run()} active={false} title="撤销"><Undo className="w-3.5 h-3.5" /></Btn>
        <Btn onClick={() => editor.chain().focus().redo().run()} active={false} title="重做"><Redo className="w-3.5 h-3.5" /></Btn>
      </div>
      {/* Content */}
      <div className="flex-1 overflow-auto bg-gray-950">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
