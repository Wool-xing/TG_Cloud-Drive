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
import { t } from '../i18n/translations';

function formatDate(dateStr?: string): string {
  if (!dateStr) return t('shares.neverExpires');
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
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6 dark:bg-gray-800">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
            <AlertTriangle className="w-5 h-5 text-red-600" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('shares.deleteTitle')}</h3>
        </div>
        <p className="text-sm text-gray-600 mb-6 dark:text-gray-300">
          {t('shares.deleteConfirm', { name: shareName })}
        </p>
        <div className="flex gap-3 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors dark:bg-gray-700 dark:text-gray-300"
          >
            {t('shares.cancel')}
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
          >
            {t('shares.confirmDelete')}
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
      toast.success(t('shares.copied'));
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  const handleDelete = async (share: Share) => {
    try {
      await sharesApi.delete(share.id);
      queryClient.invalidateQueries({ queryKey: ['shares'] });
      toast.success(t('shares.deleted'));
    } catch {
      // handled by interceptor
    } finally {
      setDeleteTarget(null);
    }
  };

  const getStatusBadge = (share: Share) => {
    if (!share.isActive) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
          <XCircle className="w-3 h-3" />
          {t('shares.disabled')}
        </span>
      );
    }
    if (isExpired(share.expireAt)) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-red-100 text-red-600">
          <Clock className="w-3 h-3" />
          {t('shares.expired')}
        </span>
      );
    }
    if (share.maxDownloads && share.downloadCount >= share.maxDownloads) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-orange-100 text-orange-600">
          <Download className="w-3 h-3" />
          {t('shares.limitReached')}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-green-100 text-green-700">
        <CheckCircle className="w-3 h-3" />
        {t('shares.active')}
      </span>
    );
  };

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-red-500 gap-2">
        <AlertTriangle className="w-10 h-10" />
        <p>{t('shares.loadError')}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 bg-white dark:bg-gray-800 dark:border-gray-700">
        <Share2 className="w-5 h-5 text-blue-500" />
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {t('shares.title')}
          {shares.length > 0 && (
            <span className="ml-1.5 text-xs text-gray-400 dark:text-gray-500">({t('shares.count', { n: shares.length })})</span>
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
          <div className="flex flex-col items-center justify-center py-20 gap-4 text-gray-400 dark:text-gray-500">
            <div className="w-20 h-20 rounded-full bg-blue-50 dark:bg-blue-950/30 flex items-center justify-center">
              <Share2 className="w-10 h-10 text-blue-200" />
            </div>
            <p className="text-lg font-medium text-gray-500 dark:text-gray-400">{t('shares.empty')}</p>
            <p className="text-sm text-center max-w-xs">{t('shares.emptyHint')}</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm dark:bg-gray-800 dark:border-gray-700">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200 dark:bg-gray-900 dark:border-gray-700">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">{t('shares.column.name')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden md:table-cell dark:text-gray-400">{t('shares.column.link')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden lg:table-cell dark:text-gray-400">{t('shares.column.expiry')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden sm:table-cell dark:text-gray-400">{t('shares.column.downloads')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden lg:table-cell dark:text-gray-400">{t('shares.column.password')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden xl:table-cell dark:text-gray-400">{t('shares.column.created')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">{t('shares.column.status')}</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">{t('shares.column.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {shares.map(share => (
                  <tr key={share.id} className="hover:bg-gray-50 transition-colors dark:hover:bg-gray-700/50">
                    {/* File name */}
                    <td className="px-4 py-3">
                      <span className="font-medium text-gray-800 truncate max-w-[160px] block dark:text-gray-100">
                        {share.node?.name ?? t('shares.unknownFile')}
                      </span>
                    </td>

                    {/* Link */}
                    <td className="px-4 py-3 hidden md:table-cell">
                      <code className="text-xs text-gray-500 font-mono bg-gray-100 px-2 py-1 rounded truncate max-w-[180px] block dark:bg-gray-700 dark:text-gray-400">
                        /s/{share.token}
                      </code>
                    </td>

                    {/* Expiry */}
                    <td className="px-4 py-3 text-gray-500 text-xs hidden lg:table-cell dark:text-gray-400">
                      <span className={isExpired(share.expireAt) ? 'text-red-500' : ''}>
                        {formatDate(share.expireAt)}
                      </span>
                    </td>

                    {/* Download count */}
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <div className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-300">
                        <Download className="w-3 h-3" />
                        <span>{share.downloadCount}</span>
                        {share.maxDownloads && (
                          <span className="text-gray-400 dark:text-gray-500">/ {share.maxDownloads}</span>
                        )}
                      </div>
                    </td>

                    {/* Password */}
                    <td className="px-4 py-3 hidden lg:table-cell">
                      {share.hasPassword ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-amber-100 text-amber-700">
                          <Lock className="w-3 h-3" />
                          {t('shares.hasPassword')}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400 dark:text-gray-500">{t('shares.noPassword')}</span>
                      )}
                    </td>

                    {/* Created */}
                    <td className="px-4 py-3 text-gray-500 text-xs hidden xl:table-cell dark:text-gray-400">
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
                          title={t('shares.copyLink')}
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
                          title={t('shares.delete')}
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
          shareName={deleteTarget.node?.name ?? t('shares.unknownFile')}
          onConfirm={() => handleDelete(deleteTarget)}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
