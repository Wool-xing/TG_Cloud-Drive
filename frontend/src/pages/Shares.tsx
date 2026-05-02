import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Share2,
  Copy,
  Trash2,
  Loader2,
  AlertTriangle,
  CheckCircle,
  Clock,
  Lock,
  Download,
  XCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';

import { sharesApi } from '../api/client';
import { Share } from '../types';

function formatDate(dateStr?: string): string {
  if (!dateStr) return '永不过期';
  return new Date(dateStr).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function isExpired(expireAt?: string): boolean {
  if (!expireAt) return false;
  return new Date(expireAt) < new Date();
}

function ConfirmModal({
  shareName,
  onConfirm,
  onClose,
}: {
  shareName: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
            <AlertTriangle className="w-5 h-5 text-red-600" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900">删除分享链接</h3>
        </div>
        <p className="text-sm text-gray-600 mb-6">
          确定要删除 <strong className="text-gray-800">"{shareName}"</strong> 的分享链接吗？删除后该链接将立即失效。
        </p>
        <div className="flex gap-3 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
          >
            确认删除
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Shares() {
  const queryClient = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState<Share | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const { data: shares = [], isLoading, error } = useQuery<Share[]>({
    queryKey: ['shares', 'my'],
    queryFn: async () => {
      const res = await sharesApi.list();
      return (res as any)?.shares ?? (res as any) ?? [];
    },
    staleTime: 30_000,
  });

  const handleCopyLink = (share: Share) => {
    const url = `${window.location.origin}/s/${share.token}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopiedId(share.id);
      toast.success('链接已复制到剪贴板');
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  const handleDelete = async (share: Share) => {
    try {
      await sharesApi.delete(share.id);
      queryClient.invalidateQueries({ queryKey: ['shares'] });
      toast.success('分享链接已删除');
    } catch {
      // handled by interceptor
    } finally {
      setDeleteTarget(null);
    }
  };

  const getStatusBadge = (share: Share) => {
    if (!share.isActive) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-600">
          <XCircle className="w-3 h-3" />
          已禁用
        </span>
      );
    }
    if (isExpired(share.expireAt)) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-red-100 text-red-600">
          <Clock className="w-3 h-3" />
          已过期
        </span>
      );
    }
    if (share.maxDownloads && share.downloadCount >= share.maxDownloads) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-orange-100 text-orange-600">
          <Download className="w-3 h-3" />
          已达上限
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-green-100 text-green-700">
        <CheckCircle className="w-3 h-3" />
        有效
      </span>
    );
  };

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-red-500 gap-2">
        <AlertTriangle className="w-10 h-10" />
        <p>加载失败，请刷新重试</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 bg-white">
        <Share2 className="w-5 h-5 text-blue-500" />
        <span className="text-sm font-medium text-gray-700">
          我的分享
          {shares.length > 0 && (
            <span className="ml-1.5 text-xs text-gray-400">({shares.length} 个链接)</span>
          )}
        </span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
          </div>
        ) : shares.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4 text-gray-400">
            <div className="w-20 h-20 rounded-full bg-blue-50 flex items-center justify-center">
              <Share2 className="w-10 h-10 text-blue-200" />
            </div>
            <p className="text-lg font-medium text-gray-500">暂无分享</p>
            <p className="text-sm text-center max-w-xs">右键点击文件，选择"分享"来创建分享链接</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">文件名</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden md:table-cell">分享链接</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden lg:table-cell">过期时间</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden sm:table-cell">下载次数</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden lg:table-cell">密码</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden xl:table-cell">创建时间</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">状态</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {shares.map(share => (
                  <tr key={share.id} className="hover:bg-gray-50 transition-colors">
                    {/* File name */}
                    <td className="px-4 py-3">
                      <span className="font-medium text-gray-800 truncate max-w-[160px] block">
                        {share.node?.name ?? '未知文件'}
                      </span>
                    </td>

                    {/* Link */}
                    <td className="px-4 py-3 hidden md:table-cell">
                      <code className="text-xs text-gray-500 font-mono bg-gray-100 px-2 py-1 rounded truncate max-w-[180px] block">
                        /s/{share.token}
                      </code>
                    </td>

                    {/* Expiry */}
                    <td className="px-4 py-3 text-gray-500 text-xs hidden lg:table-cell">
                      <span className={isExpired(share.expireAt) ? 'text-red-500' : ''}>
                        {formatDate(share.expireAt)}
                      </span>
                    </td>

                    {/* Download count */}
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <div className="flex items-center gap-1 text-xs text-gray-600">
                        <Download className="w-3 h-3" />
                        <span>{share.downloadCount}</span>
                        {share.maxDownloads && (
                          <span className="text-gray-400">/ {share.maxDownloads}</span>
                        )}
                      </div>
                    </td>

                    {/* Password */}
                    <td className="px-4 py-3 hidden lg:table-cell">
                      {share.hasPassword ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-amber-100 text-amber-700">
                          <Lock className="w-3 h-3" />
                          有密码
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">无</span>
                      )}
                    </td>

                    {/* Created */}
                    <td className="px-4 py-3 text-gray-500 text-xs hidden xl:table-cell">
                      {formatDate(share.createdAt)}
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3">
                      {getStatusBadge(share)}
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => handleCopyLink(share)}
                          className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-50 transition-colors"
                          title="复制链接"
                        >
                          {copiedId === share.id ? (
                            <CheckCircle className="w-4 h-4 text-green-600" />
                          ) : (
                            <Copy className="w-4 h-4" />
                          )}
                        </button>
                        <button
                          onClick={() => setDeleteTarget(share)}
                          className="p-1.5 rounded-lg text-red-600 hover:bg-red-50 transition-colors"
                          title="删除分享"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Delete confirm modal */}
      {deleteTarget && (
        <ConfirmModal
          shareName={deleteTarget.node?.name ?? '未知文件'}
          onConfirm={() => handleDelete(deleteTarget)}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
