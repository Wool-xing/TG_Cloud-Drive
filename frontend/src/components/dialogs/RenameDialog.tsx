import { useState, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import toast from 'react-hot-toast';
import { filesApi } from '../../api/client';
import { Node } from '../../types';
import { t } from '../../i18n/translations';

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
      setError(t('rename.errorEmpty'));
      return false;
    }
    if (trimmed.length > 500) {
      setError(t('rename.errorTooLong'));
      return false;
    }
    if (trimmed === node.name) {
      setError(t('rename.errorUnchanged'));
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
      toast.success(t('rename.success'));
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
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">{t('rename.title')}</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:text-gray-200 dark:hover:bg-gray-700 transition-colors dark:text-gray-500"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              {node.type === 'folder' ? t('rename.folderLabel') : t('rename.fileLabel')}
            </label>
            <input
              ref={inputRef}
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value); setError(''); }}
              className={`w-full border rounded-xl px-4 py-2.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 transition-shadow ${
                error
                  ? 'border-red-400 focus:ring-red-300'
                  : 'border-gray-300 dark:border-gray-600 focus:ring-blue-500'
              }`}
              maxLength={500}
              disabled={submitting}
            />
            {error && <p className="mt-1.5 text-xs text-red-500 dark:text-red-400">{error}</p>}
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500 text-right">{name.length}/500</p>
          </div>

          <div className="flex justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-600 transition-colors dark:border-gray-700"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 rounded-xl text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-sm"
            >
              {submitting ? t('rename.saving') : t('common.confirm')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
