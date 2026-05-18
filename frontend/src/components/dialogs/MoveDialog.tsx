import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, Folder, ChevronRight, Home, Loader2, ArrowRight } from 'lucide-react';
import toast from 'react-hot-toast';
import { filesApi } from '../../api/client';
import { Node } from '../../types';
import { t } from '../../i18n/translations';

interface MoveDialogProps {
  nodeIds: string[];
  mode: 'move' | 'copy';
  onClose: () => void;
  onSuccess: () => void;
}

interface BreadcrumbItem {
  id: string | null;
  name: string;
}

export default function MoveDialog({ nodeIds, mode, onClose, onSuccess }: MoveDialogProps) {
  const [browsePath, setBrowsePath] = useState<BreadcrumbItem[]>([{ id: null, name: t('move.myFiles') }]);
  const [selectedFolder, setSelectedFolder] = useState<{ id: string; name: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const currentBrowseId = browsePath[browsePath.length - 1]?.id ?? null;

  useEffect(() => {
    setSelectedFolder(null);
  }, [currentBrowseId]);

  const { data: folderData, isLoading } = useQuery({
    queryKey: ['move-dialog-folders', currentBrowseId],
    queryFn: async () => {
      const res = await filesApi.list({ parentId: currentBrowseId ?? '', sort: 'name', order: 'ASC' });
      const nodes: Node[] = (res as any)?.nodes ?? (res as any) ?? [];
      return nodes.filter((n) => n.type === 'folder');
    },
    staleTime: 15_000,
  });

  const folders = folderData ?? [];

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const navigateInto = (folder: Node) => {
    if (submitting) return;
    setBrowsePath((prev) => [...prev, { id: folder.id, name: folder.name }]);
  };

  const navigateTo = (index: number) => {
    setBrowsePath((prev) => prev.slice(0, index + 1));
  };

  const isDisabled = (folder: Node): boolean => nodeIds.includes(folder.id);

  const targetId = selectedFolder?.id ?? currentBrowseId;
  const targetName = selectedFolder?.name ?? browsePath[browsePath.length - 1]?.name;

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const results = await Promise.allSettled(
        nodeIds.map((nodeId) =>
          mode === 'move'
            ? filesApi.move(nodeId, targetId ?? '')
            : filesApi.copy(nodeId, targetId ?? ''),
        ),
      );
      const ok = results.filter((r) => r.status === 'fulfilled').length;
      const failed = results.length - ok;
      const verb = mode === 'move' ? t('toolbar.move') : t('toolbar.copy');
      if (failed === 0) {
        toast.success(t('move.success', { verb, n: ok }));
      } else if (ok === 0) {
        toast.error(t('move.fail', { verb, n: failed }));
      } else {
        toast.error(t('move.partial', { verb, ok, failed }));
      }
      onSuccess();
    } finally {
      setSubmitting(false);
    }
  };

  const title = mode === 'move' ? t('move.title') : t('copy.title');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden flex flex-col max-h-[80vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex-shrink-0">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">{title}</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:text-gray-200 dark:hover:bg-gray-700 transition-colors dark:text-gray-500"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex items-center gap-1 px-6 py-3 border-b border-gray-100 dark:border-gray-700 flex-shrink-0 bg-gray-50 dark:bg-gray-900/40 flex-wrap dark:bg-gray-900">
          {browsePath.map((item, idx) => (
            <span key={idx} className="flex items-center gap-1">
              {idx > 0 && <ChevronRight className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />}
              <button
                onClick={() => navigateTo(idx)}
                className={`text-sm px-2 py-0.5 rounded-lg transition-colors ${
                  idx === browsePath.length - 1
                    ? 'text-gray-800 dark:text-gray-100 font-medium bg-white dark:bg-gray-700 shadow-sm border border-gray-200 dark:border-gray-600'
                    : 'text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30'
                }`}
              >
                {idx === 0 ? (
                  <span className="flex items-center gap-1">
                    <Home className="w-3.5 h-3.5" />
                    {item.name}
                  </span>
                ) : (
                  item.name
                )}
              </button>
            </span>
          ))}
        </div>

        <div className="px-6 pt-2 pb-1 text-xs text-gray-400 dark:text-gray-500">
          {t('move.hint')}
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-2 min-h-[200px]">
          {isLoading ? (
            <div className="flex items-center justify-center h-24 text-gray-400 dark:text-gray-500">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              <span className="text-sm">{t('common.loading')}</span>
            </div>
          ) : folders.length === 0 ? (
            <div className="flex items-center justify-center h-24 text-gray-400 dark:text-gray-500 text-sm">
              {t('move.empty')}
            </div>
          ) : (
            <div className="space-y-1">
              {folders.map((folder) => {
                const disabled = isDisabled(folder);
                const isSelected = selectedFolder?.id === folder.id;
                return (
                  <div
                    key={folder.id}
                    className={`flex items-center gap-3 px-4 py-2.5 rounded-xl transition-colors ${
                      disabled
                        ? 'opacity-40 cursor-not-allowed text-gray-500 dark:text-gray-400'
                        : isSelected
                        ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-200'
                        : 'hover:bg-gray-50 dark:hover:bg-gray-700/50 text-gray-700 dark:text-gray-200 cursor-pointer'
                    }`}
                    onClick={() => {
                      if (disabled) return;
                      setSelectedFolder(isSelected ? null : { id: folder.id, name: folder.name });
                    }}
                  >
                    <Folder className="w-5 h-5 text-yellow-400 fill-yellow-300 flex-shrink-0" />
                    <span className="text-sm font-medium truncate flex-1">{folder.name}</span>
                    {!disabled && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          navigateInto(folder);
                        }}
                        title={t('move.enterDir')}
                        className="p-1 rounded-lg hover:bg-blue-200 dark:hover:bg-blue-800/50 text-gray-400 dark:text-gray-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors dark:text-gray-500"
                      >
                        <ArrowRight className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-100 dark:border-gray-700 flex items-center justify-between flex-shrink-0 bg-gray-50 dark:bg-gray-900/40 dark:bg-gray-900">
          <div className="text-sm text-gray-500 dark:text-gray-400">
            {t('move.target')}
            <span className="font-medium text-gray-800 dark:text-gray-100 ml-1">{targetName}</span>
          </div>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-600 transition-colors dark:border-gray-700"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="px-5 py-2 rounded-xl text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-sm"
            >
              {submitting ? t('move.processing') : mode === 'move' ? t('move.toHere') : t('copy.toHere')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
