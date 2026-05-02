import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  X,
  Folder,
  ChevronRight,
  Home,
  Loader2,
  ArrowRight,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { filesApi } from '../../api/client';
import { Node } from '../../types';

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
  const [browsePath, setBrowsePath] = useState<BreadcrumbItem[]>([{ id: null, name: '我的文件' }]);
  const [selectedFolder, setSelectedFolder] = useState<{ id: string; name: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const currentBrowseId = browsePath[browsePath.length - 1]?.id ?? null;

  // Reset selection when navigating
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
    setBrowsePath((prev) => [...prev, { id: folder.id, name: folder.name }]);
  };

  const navigateTo = (index: number) => {
    setBrowsePath((prev) => prev.slice(0, index + 1));
  };

  const isDisabled = (folder: Node): boolean => nodeIds.includes(folder.id);

  // Target: selected folder, or current browse location
  const targetId = selectedFolder?.id ?? currentBrowseId;
  const targetName = selectedFolder?.name ?? browsePath[browsePath.length - 1]?.name;

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const promises = nodeIds.map((nodeId) =>
        mode === 'move'
          ? filesApi.move(nodeId, targetId ?? '')
          : filesApi.copy(nodeId, targetId ?? ''),
      );
      await Promise.all(promises);
      toast.success(
        mode === 'move'
          ? `已移动 ${nodeIds.length} 个项目`
          : `已复制 ${nodeIds.length} 个项目`,
      );
      onSuccess();
    } catch {
      // handled by interceptor
    } finally {
      setSubmitting(false);
    }
  };

  const title = mode === 'move' ? '移动到' : '复制到';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <h2 className="text-lg font-semibold text-gray-800">{title}</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Breadcrumb */}
        <div className="flex items-center gap-1 px-6 py-3 border-b border-gray-100 flex-shrink-0 bg-gray-50 flex-wrap">
          {browsePath.map((item, idx) => (
            <span key={idx} className="flex items-center gap-1">
              {idx > 0 && <ChevronRight className="w-3.5 h-3.5 text-gray-400" />}
              <button
                onClick={() => navigateTo(idx)}
                className={`text-sm px-2 py-0.5 rounded-lg transition-colors ${
                  idx === browsePath.length - 1
                    ? 'text-gray-800 font-medium bg-white shadow-sm border border-gray-200'
                    : 'text-blue-600 hover:bg-blue-50'
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

        {/* Hint */}
        <div className="px-6 pt-2 pb-1 text-xs text-gray-400">
          单击选择目标文件夹，点击 <ArrowRight className="w-3 h-3 inline" /> 进入子目录
        </div>

        {/* Folder list */}
        <div className="flex-1 overflow-y-auto px-4 py-2 min-h-[200px]">
          {isLoading ? (
            <div className="flex items-center justify-center h-24 text-gray-400">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              <span className="text-sm">加载中…</span>
            </div>
          ) : folders.length === 0 ? (
            <div className="flex items-center justify-center h-24 text-gray-400 text-sm">
              此文件夹没有子文件夹
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
                        ? 'opacity-40 cursor-not-allowed text-gray-500'
                        : isSelected
                        ? 'bg-blue-100 text-blue-800'
                        : 'hover:bg-gray-50 text-gray-700 cursor-pointer'
                    }`}
                    onClick={() => {
                      if (disabled) return;
                      setSelectedFolder(isSelected ? null : { id: folder.id, name: folder.name });
                    }}
                  >
                    <Folder className="w-5 h-5 text-yellow-400 fill-yellow-300 flex-shrink-0" />
                    <span className="text-sm font-medium truncate flex-1">{folder.name}</span>
                    {/* Navigate-into button */}
                    {!disabled && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          navigateInto(folder);
                        }}
                        title="进入子目录"
                        className="p-1 rounded-lg hover:bg-blue-200 text-gray-400 hover:text-blue-700 transition-colors"
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

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between flex-shrink-0 bg-gray-50">
          <div className="text-sm text-gray-500">
            目标：
            <span className="font-medium text-gray-800 ml-1">{targetName}</span>
          </div>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-100 border border-gray-200 transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="px-5 py-2 rounded-xl text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-sm"
            >
              {submitting ? '处理中…' : mode === 'move' ? '移动到此处' : '复制到此处'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
