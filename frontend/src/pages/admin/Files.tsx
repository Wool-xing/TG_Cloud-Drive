import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Search,
  Loader2,
  Trash2,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  File,
  Folder,
} from 'lucide-react';
import toast from 'react-hot-toast';

import { adminApi } from '../../api/client';
import { Node } from '../../types';
import { formatBytes } from '../../utils/crypto';

const PAGE_SIZE = 20;

interface AdminNode extends Node {
  username?: string;
}

function DeleteModal({
  name,
  onConfirm,
  onClose,
}: {
  name: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/40 flex items-center justify-center">
            <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">删除文件</h3>
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
          确定要永久删除 <strong>"{name}"</strong> 吗？此操作无法撤销。
        </p>
        <div className="flex gap-3 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg">取消</button>
          <button onClick={onConfirm} className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg">确认删除</button>
        </div>
      </div>
    </div>
  );
}

export default function AdminFiles() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [deleteTarget, setDeleteTarget] = useState<AdminNode | null>(null);

  const { data, isLoading } = useQuery<{ files: AdminNode[]; total: number }>({
    queryKey: ['admin', 'files', search, page],
    queryFn: async () => {
      const res = await adminApi.files({ search, page, limit: PAGE_SIZE }) as any;
      return { files: res?.files ?? res ?? [], total: res?.total ?? 0 };
    },
    staleTime: 30_000,
  });

  const files = data?.files ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin', 'files'] });

  const handleDelete = async (node: AdminNode) => {
    try {
      await adminApi.deleteFile(node.id);
      invalidate();
      toast.success('文件已删除');
    } catch {
      // interceptor handles error toast
    } finally {
      setDeleteTarget(null);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">文件管理</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">共 {total} 个文件</p>
      </div>

      {/* Search */}
      <div className="relative max-w-xs">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
          placeholder="搜索文件名..."
          className="w-full pl-9 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">文件名</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase hidden md:table-cell">所有者</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase hidden lg:table-cell">大小</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase hidden xl:table-cell">上传时间</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {isLoading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="animate-pulse">
                      {Array.from({ length: 5 }).map((_, j) => (
                        <td key={j} className="px-4 py-3">
                          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-24" />
                        </td>
                      ))}
                    </tr>
                  ))
                : files.map(node => (
                    <tr key={node.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      {/* Name */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
                            node.type === 'folder'
                              ? 'bg-yellow-100 dark:bg-yellow-900/40'
                              : 'bg-blue-100 dark:bg-blue-900/40'
                          }`}>
                            {node.type === 'folder'
                              ? <Folder className="w-4 h-4 text-yellow-600 dark:text-yellow-400" />
                              : <File className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                            }
                          </div>
                          <span className="font-medium text-gray-800 dark:text-gray-200 truncate max-w-[200px]">{node.name}</span>
                        </div>
                      </td>

                      {/* Owner */}
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400 text-xs hidden md:table-cell">
                        {node.username ?? node.userId}
                      </td>

                      {/* Size */}
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs hidden lg:table-cell">
                        {node.type === 'file' ? formatBytes(node.size) : '—'}
                      </td>

                      {/* Date */}
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs hidden xl:table-cell">
                        {new Date(node.createdAt).toLocaleDateString('zh-CN')}
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end">
                          <button
                            onClick={() => setDeleteTarget(node)}
                            className="p-1.5 rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
                            title="删除"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
              {!isLoading && files.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center py-8 text-gray-400 dark:text-gray-600 text-sm">暂无文件</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/30">
            <p className="text-xs text-gray-500 dark:text-gray-400">共 {total} 条，第 {page} / {totalPages} 页</p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="p-1.5 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-40 transition-colors text-gray-600 dark:text-gray-400"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="p-1.5 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-40 transition-colors text-gray-600 dark:text-gray-400"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {deleteTarget && (
        <DeleteModal
          name={deleteTarget.name}
          onConfirm={() => handleDelete(deleteTarget)}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
