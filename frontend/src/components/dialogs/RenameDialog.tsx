import { useState, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import toast from 'react-hot-toast';
import { filesApi } from '../../api/client';
import { Node } from '../../types';

interface RenameDialogProps {
  node: Node;
  onClose: () => void;
  onSuccess: () => void;
}

export default function RenameDialog({ node, onClose, onSuccess }: RenameDialogProps) {
  const [name, setName] = useState(node.name);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Select filename without extension on open
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    if (node.type === 'file') {
      const dotIdx = node.name.lastIndexOf('.');
      if (dotIdx > 0) {
        input.setSelectionRange(0, dotIdx);
      } else {
        input.select();
      }
    } else {
      input.select();
    }
  }, [node]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const validate = (): boolean => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('名称不能为空');
      return false;
    }
    if (trimmed.length > 500) {
      setError('名称最多 500 个字符');
      return false;
    }
    if (trimmed === node.name) {
      setError('名称未更改');
      return false;
    }
    setError('');
    return true;
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    try {
      await filesApi.rename(node.id, name.trim());
      toast.success('重命名成功');
      onSuccess();
    } catch {
      // handled by interceptor
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-800">重命名</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              {node.type === 'folder' ? '文件夹名称' : '文件名称'}
            </label>
            <input
              ref={inputRef}
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value); setError(''); }}
              className={`w-full border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 transition-shadow ${
                error
                  ? 'border-red-400 focus:ring-red-300'
                  : 'border-gray-300 focus:ring-blue-500'
              }`}
              maxLength={500}
              disabled={submitting}
            />
            {error && <p className="mt-1.5 text-xs text-red-500">{error}</p>}
            <p className="mt-1 text-xs text-gray-400 text-right">{name.length}/500</p>
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-100 border border-gray-200 transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 rounded-xl text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-sm"
            >
              {submitting ? '保存中…' : '确定'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
