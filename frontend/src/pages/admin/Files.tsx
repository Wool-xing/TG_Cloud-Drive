import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { t } from '../../i18n/translations';
import {
  Search,
  Trash2,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  File,
  Folder,
  Image,
  Video,
  Music,
  FileText,
  Archive,
  Shield,
} from 'lucide-react';
import toast from 'react-hot-toast';

import { adminApi } from '../../api/client';
import { Node } from '../../types';
import { formatBytes } from '../../utils/crypto';
import ConfirmPasswordDialog from '../../components/dialogs/ConfirmPasswordDialog';

const PAGE_SIZE = 20;

const TYPE_TABS = [
  { key: '', labelKey: 'admin.files.filterAll' },
  { key: 'folder', labelKey: 'admin.files.filterFolder' },
  { key: 'image', labelKey: 'admin.files.filterImage' },
  { key: 'video', labelKey: 'admin.files.filterVideo' },
  { key: 'audio', labelKey: 'admin.files.filterAudio' },
  { key: 'document', labelKey: 'admin.files.filterDocument' },
  { key: 'archive', labelKey: 'admin.files.filterArchive' },
  { key: 'other', labelKey: 'admin.files.filterOther' },
] as const;

function getTypeCategory(node: { type: string; mimeType?: string }): string {
  if (node.type === 'folder') return 'folder';
  const m = (node.mimeType || '').toLowerCase();
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('audio/')) return 'audio';
  if (m.startsWith('text/') || m.includes('pdf') || m.includes('document') || m.includes('msword') || m.includes('spreadsheet') || m.includes('presentation')) return 'document';
  if (m.includes('zip') || m.includes('rar') || m.includes('tar') || m.includes('gz') || m.includes('7z') || m.includes('compress')) return 'archive';
  return 'other';
}

function typeIcon(type: string) {
  const cls = 'w-4 h-4';
  switch (type) {
    case 'folder': return <Folder className={`${cls} text-yellow-600 dark:text-yellow-400`} />;
    case 'image': return <Image className={`${cls} text-green-600 dark:text-green-400`} />;
    case 'video': return <Video className={`${cls} text-purple-600 dark:text-purple-400`} />;
    case 'audio': return <Music className={`${cls} text-pink-600 dark:text-pink-400`} />;
    case 'document': return <FileText className={`${cls} text-blue-600 dark:text-blue-400`} />;
    case 'archive': return <Archive className={`${cls} text-orange-600 dark:text-orange-400`} />;
    default: return <File className={`${cls} text-gray-600 dark:text-gray-400`} />;
  }
}

function typeLabel(type: string): string {
  switch (type) {
    case 'folder': return t('admin.files.filterFolder');
    case 'image': return t('admin.files.filterImage');
    case 'video': return t('admin.files.filterVideo');
    case 'audio': return t('admin.files.filterAudio');
    case 'document': return t('admin.files.filterDocument');
    case 'archive': return t('admin.files.filterArchive');
    default: return t('admin.files.filterOther');
  }
}

interface AdminNode extends Node {
  username?: string;
}

export default function AdminFiles() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [typeFilter, setTypeFilter] = useState('');
  const [sortField, setSortField] = useState('createdAt');
  const [sortOrder, setSortOrder] = useState<'ASC' | 'DESC'>('DESC');
  const [deleteTarget, setDeleteTarget] = useState<AdminNode | null>(null);

  const toggleSort = (field: string) => {
    if (sortField === field) setSortOrder(o => o === 'ASC' ? 'DESC' : 'ASC');
    else { setSortField(field); setSortOrder('DESC'); }
    setPage(1);
  };

  const { data, isLoading } = useQuery<{ files: AdminNode[]; total: number }>({
    queryKey: ['admin', 'files', search, page, typeFilter, sortField, sortOrder],
    queryFn: async () => {
      const params: Record<string, any> = { page, limit: PAGE_SIZE, sort: sortField, order: sortOrder };
      if (search) params.search = search;
      if (typeFilter) params.type = typeFilter;
      const res = await adminApi.files(params) as any;
      return { files: res?.files ?? res ?? [], total: res?.total ?? 0 };
    },
    staleTime: 30_000,
  });

  const files = data?.files ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const SortTh = ({ field, label, visible }: { field: string; label: string; visible: boolean | string }) => {
    const isActive = sortField === field;
    const v = visible === true ? '' : visible === false ? 'hidden' : `hidden ${visible}:table-cell`;
    return (
      <th className={`px-4 py-3 text-left text-xs font-medium uppercase select-none cursor-pointer hover:text-gray-800 dark:hover:text-gray-200 text-gray-500 dark:text-gray-400 ${v}`} onClick={() => { if (visible) toggleSort(field); }}>
        <span className="inline-flex items-center gap-1">
          {label}
          {isActive && (sortOrder === 'ASC' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
        </span>
      </th>
    );
  };

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin', 'files'] });

  const handleDelete = async (pw: string) => {
    if (!deleteTarget) return;
    await adminApi.deleteFile(deleteTarget.id, pw);
    invalidate();
    toast.success(t('admin.files.deleted'));
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">{t('admin.files.title')}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{t('admin.files.subtitle', { total })}</p>
      </div>

      <div className="space-y-3">
        <div className="relative max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
          <input
            type="text"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            placeholder={t('admin.files.searchPlaceholder')}
            className="w-full pl-9 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-gray-100"
          />
        </div>

        <div className="flex flex-wrap gap-1.5">
          {TYPE_TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => { setTypeFilter(tab.key); setPage(1); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                typeFilter === tab.key
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              {t(tab.labelKey)}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700 dark:bg-gray-900">
              <tr>
                <SortTh field="name" label={t('admin.files.colName')} visible />
                <SortTh field="type" label={t('admin.files.colType')} visible="md" />
                <SortTh field="userId" label={t('admin.files.colOwner')} visible="md" />
                <SortTh field="size" label={t('admin.files.colSize')} visible="lg" />
                <SortTh field="createdAt" label={t('admin.files.colUploadTime')} visible="xl" />
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('admin.files.colActions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {isLoading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="animate-pulse">
                      {Array.from({ length: 6 }).map((_, j) => (
                        <td key={j} className="px-4 py-3">
                          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-24" />
                        </td>
                      ))}
                    </tr>
                  ))
                : files.map(node => {
                    const cat = getTypeCategory(node);
                    return (
                      <tr key={node.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
                              cat === 'folder'
                                ? 'bg-yellow-100 dark:bg-yellow-900/40'
                                : 'bg-gray-100 dark:bg-gray-700'
                            }`}>
                              {typeIcon(cat)}
                            </div>
                            <div className="min-w-0">
                              <span className="font-medium text-gray-800 dark:text-gray-200 truncate block max-w-[180px]">{node.name}</span>
                            </div>
                            {node.isPrivate && (
                              <span title={t('admin.files.tooltipPrivate')}><Shield className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" /></span>
                            )}
                          </div>
                        </td>

                        <td className="px-4 py-3 hidden md:table-cell">
                          <span className="text-xs text-gray-500 dark:text-gray-400">{typeLabel(cat)}</span>
                        </td>

                        <td className="px-4 py-3 text-gray-600 dark:text-gray-400 text-xs hidden md:table-cell">
                          {node.username ?? node.userId?.slice(0, 8) ?? '—'}
                        </td>

                        <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs hidden lg:table-cell">
                          {node.type === 'file' ? formatBytes(node.size) : '—'}
                        </td>

                        <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs hidden xl:table-cell">
                          {new Date(node.createdAt).toLocaleDateString('zh-CN')}
                        </td>

                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end">
                            <button
                              onClick={() => setDeleteTarget(node)}
                              className="p-1.5 rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
                              title={t('admin.files.tooltipDelete')}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              {!isLoading && files.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-gray-400 dark:text-gray-600 text-sm dark:text-gray-500">{t('admin.files.empty')}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/30 dark:bg-gray-900">
            <p className="text-xs text-gray-500 dark:text-gray-400">{t('admin.files.pagination', { total, page, totalPages })}</p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="p-1.5 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-40 transition-colors text-gray-600 dark:text-gray-400 dark:text-gray-300"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="p-1.5 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-40 transition-colors text-gray-600 dark:text-gray-400 dark:text-gray-300"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {deleteTarget && (
        <ConfirmPasswordDialog
          title={t('admin.files.deleteTitle')}
          destructive
          confirmLabel={t('common.delete')}
          description={
            <>
              {t('admin.files.deleteBody', { name: deleteTarget.name })}
            </>
          }
          onConfirm={handleDelete}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
