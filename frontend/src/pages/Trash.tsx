import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Trash2,
  RotateCcw,
  AlertTriangle,
  Loader2,
  Info,
} from 'lucide-react';
import toast from 'react-hot-toast';

import { filesApi } from '../api/client';
import { Node } from '../types';
import { formatBytes } from '../utils/crypto';

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function ConfirmModal({
  title,
  message,
  inputLabel,
  confirmWord,
  confirmLabel,
  danger,
  onConfirm,
  onClose,
}: {
  title: string;
  message: string;
  inputLabel?: string;
  confirmWord?: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const [inputValue, setInputValue] = useState('');
  const needsInput = !!confirmWord;
  const canConfirm = !needsInput || inputValue === confirmWord;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6 dark:bg-gray-800">
        <div className="flex items-center gap-3 mb-4">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${danger ? 'bg-red-100' : 'bg-yellow-100'}`}>
            <AlertTriangle className={`w-5 h-5 ${danger ? 'text-red-600' : 'text-yellow-600'}`} />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
        </div>
        <p className="text-sm text-gray-600 mb-4 dark:text-gray-300">{message}</p>
        {needsInput && (
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-gray-300">
              {inputLabel ?? `请输入"${confirmWord}"以继续`}
            </label>
            <input
              type="text"
              value={inputValue}
              onChange={e => setInputValue(e.target.value)}
              placeholder={confirmWord}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent dark:border-gray-600"
              autoFocus
            />
          </div>
        )}
        <div className="flex gap-3 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors dark:bg-gray-700 dark:text-gray-300"
          >
            取消
          </button>
          <button
            onClick={() => { if (canConfirm) onConfirm(); }}
            disabled={!canConfirm}
            className={`px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
              danger ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

type ModalState =
  | { type: 'permanentDelete'; ids: string[] }
  | { type: 'emptyTrash' }
  | null;

export default function Trash() {
  const queryClient = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [modal, setModal] = useState<ModalState>(null);
  const [isActing, setIsActing] = useState(false);

  const { data: nodes = [], isLoading, error } = useQuery<Node[]>({
    queryKey: ['trash'],
    queryFn: async () => {
      const res = await filesApi.trash();
      return (res as any)?.nodes ?? (res as any) ?? [];
    },
    staleTime: 30_000,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['trash'] });
  };

  const allSelected = nodes.length > 0 && nodes.every(n => selectedIds.has(n.id));
  const someSelected = nodes.some(n => selectedIds.has(n.id));

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(nodes.map(n => n.id)));
    }
  };

  const handleRestore = async () => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    setIsActing(true);
    try {
      await filesApi.restore(ids);
      setSelectedIds(new Set());
      invalidate();
      toast.success(`已还原 ${ids.length} 个文件`);
    } catch {
      // handled by interceptor
    } finally {
      setIsActing(false);
    }
  };

  const handlePermanentDelete = async (ids: string[]) => {
    setIsActing(true);
    try {
      await filesApi.permanentDelete(ids);
      setSelectedIds(prev => {
        const next = new Set(prev);
        ids.forEach(id => next.delete(id));
        return next;
      });
      invalidate();
      toast.success(`已永久删除 ${ids.length} 个文件`);
    } catch {
      // handled by interceptor
    } finally {
      setIsActing(false);
      setModal(null);
    }
  };

  const handleEmptyTrash = async () => {
    await handlePermanentDelete(nodes.map(n => n.id));
  };

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-red-500 gap-2">
        <AlertTriangle className="w-10 h-10" />
        <p>加载回收站失败，请刷新重试</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Retention banner */}
      <div className="mx-4 mt-4 mb-2 flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
        <Info className="w-4 h-4 flex-shrink-0 text-amber-600" />
        <span>回收站中的文件将在 <strong>30天</strong> 后自动永久删除，请及时处理重要文件。</span>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 bg-white dark:bg-gray-800 dark:border-gray-700">
        <span className="text-sm font-medium text-gray-700 mr-2 dark:text-gray-300">
          回收站
          {nodes.length > 0 && (
            <span className="ml-1.5 text-xs text-gray-400 dark:text-gray-500">({nodes.length} 个文件)</span>
          )}
        </span>

        <div className="flex-1" />

        {someSelected && (
          <>
            <span className="text-xs text-gray-500 mr-1 dark:text-gray-400">已选 {selectedIds.size} 项</span>
            <button
              onClick={handleRestore}
              disabled={isActing}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors disabled:opacity-50"
            >
              {isActing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
              还原选中
            </button>
            <button
              onClick={() => setModal({ type: 'permanentDelete', ids: Array.from(selectedIds) })}
              disabled={isActing}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded-lg transition-colors disabled:opacity-50"
            >
              <Trash2 className="w-4 h-4" />
              永久删除选中
            </button>
          </>
        )}

        {nodes.length > 0 && (
          <button
            onClick={() => setModal({ type: 'emptyTrash' })}
            disabled={isActing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-700 border border-red-200 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
          >
            <Trash2 className="w-4 h-4" />
            清空回收站
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
          </div>
        ) : nodes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4 text-gray-400 dark:text-gray-500">
            <div className="w-20 h-20 rounded-full bg-gray-100 flex items-center justify-center dark:bg-gray-700">
              <Trash2 className="w-10 h-10 text-gray-300" />
            </div>
            <p className="text-lg font-medium text-gray-500 dark:text-gray-400">回收站为空</p>
            <p className="text-sm">已删除的文件会出现在这里</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10 dark:bg-gray-900 dark:border-gray-700">
              <tr>
                <th className="w-10 px-4 py-2">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={el => { if (el) el.indeterminate = someSelected && !allSelected; }}
                    onChange={toggleAll}
                    className="w-4 h-4 rounded border-gray-300 text-blue-600 cursor-pointer dark:border-gray-600"
                  />
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">名称</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden md:table-cell dark:text-gray-400">原始位置</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden lg:table-cell dark:text-gray-400">删除时间</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden sm:table-cell dark:text-gray-400">大小</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {nodes.map(node => {
                const isSelected = selectedIds.has(node.id);
                return (
                  <tr
                    key={node.id}
                    className={`group transition-colors ${isSelected ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                    onClick={() => toggleSelect(node.id)}
                  >
                    <td className="w-10 px-4 py-3">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => {}}
                        onClick={e => e.stopPropagation()}
                        className="w-4 h-4 rounded border-gray-300 text-blue-600 cursor-pointer dark:border-gray-600"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Trash2 className="w-4 h-4 text-gray-300 flex-shrink-0" />
                        <span className="font-medium text-gray-700 truncate max-w-[200px] dark:text-gray-300">{node.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-500 hidden md:table-cell dark:text-gray-400">
                      <span className="text-xs truncate max-w-[160px] block">
                        {node.parentId ? `/${node.parentId}` : '/根目录'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs hidden lg:table-cell dark:text-gray-400">
                      {node.deletedAt ? formatDate(node.deletedAt) : '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-500 hidden sm:table-cell dark:text-gray-400">
                      {node.type === 'folder' ? '—' : formatBytes(node.size)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                        <button
                          onClick={() => {
                            filesApi.restore([node.id]).then(() => {
                              invalidate();
                              toast.success('已还原');
                            });
                          }}
                          className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-100 transition-colors"
                          title="还原"
                        >
                          <RotateCcw className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setModal({ type: 'permanentDelete', ids: [node.id] })}
                          className="p-1.5 rounded-lg text-red-600 hover:bg-red-100 transition-colors"
                          title="永久删除"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Modals */}
      {modal?.type === 'permanentDelete' && (
        <ConfirmModal
          title="永久删除"
          message={`确定要永久删除选中的 ${modal.ids.length} 个文件吗？此操作不可撤销。`}
          confirmLabel="永久删除"
          danger
          onConfirm={() => handlePermanentDelete(modal.ids)}
          onClose={() => setModal(null)}
        />
      )}

      {modal?.type === 'emptyTrash' && (
        <ConfirmModal
          title="清空回收站"
          message={`此操作将永久删除回收站中的全部 ${nodes.length} 个文件，无法恢复。`}
          inputLabel={`请输入"确认"以继续`}
          confirmWord="确认"
          confirmLabel="清空回收站"
          danger
          onConfirm={handleEmptyTrash}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
