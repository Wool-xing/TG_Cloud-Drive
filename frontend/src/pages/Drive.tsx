import { useEffect, useCallback, useState, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { UploadCloud, FolderUp } from 'lucide-react';
import toast from 'react-hot-toast';

import { filesApi } from '../api/client';
import { useAuthStore } from '../stores/auth.store';
import { useFileStore } from '../stores/file.store';
import { useUploadStore } from '../stores/upload.store';
import { Node } from '../types';

import FileToolbar from '../components/files/FileToolbar';
import FileList from '../components/files/FileList';
import FileGrid from '../components/files/FileGrid';
import FileContextMenu from '../components/files/FileContextMenu';
import PreviewModal from '../components/preview/PreviewModal';
import ShortcutsPanel from '../components/ShortcutsPanel';

interface DriveProps {
  isPrivate?: boolean;
}

export default function Drive({ isPrivate = false }: DriveProps) {
  const queryClient = useQueryClient();
  const user = useAuthStore(s => s.user);
  const warned80 = useRef(false);
  const warned95 = useRef(false);

  // Quota warning — toast once per session at 80% / 95% thresholds
  useEffect(() => {
    if (!user || !user.quotaBytes) return;
    const pct = (user.usedBytes / user.quotaBytes) * 100;
    if (pct >= 95 && !warned95.current) {
      warned95.current = true;
      toast.error(`存储空间已使用 ${pct.toFixed(1)}%，即将达到上限，请清理文件或联系管理员扩容`, { duration: 8000 });
    } else if (pct >= 80 && !warned80.current) {
      warned80.current = true;
      toast(`存储空间已使用 ${pct.toFixed(1)}%，建议清理不需要的文件`, { icon: '⚠️', duration: 6000 });
    }
  }, [user?.usedBytes, user?.quotaBytes]);

  const {
    currentParentId,
    isPrivate: storePrivate,
    setPrivate,
    selectedIds,
    viewMode,
    sortField,
    sortOrder,
    filterType,
    searchQuery,
    previewNode,
    contextMenuNode,
    contextMenuPos,
    clearSelection,
    selectAll,
    setContextMenu,
  } = useFileStore();

  // Drag-and-drop upload
  const { addFiles } = useUploadStore();
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);

  // Recursively collect files from dropped items (handles folders)
  const collectFiles = useCallback(async (items: DataTransferItemList): Promise<File[]> => {
    const result: File[] = [];
    const readEntry = async (entry: FileSystemEntry): Promise<void> => {
      if (entry.isFile) {
        const file = await new Promise<File>((resolve, reject) => {
          (entry as FileSystemFileEntry).file(resolve, reject);
        });
        result.push(file);
      } else if (entry.isDirectory) {
        const reader = (entry as FileSystemDirectoryEntry).createReader();
        const readAll = (): Promise<FileSystemEntry[]> => {
          return new Promise((resolve) => {
            const all: FileSystemEntry[] = [];
            const readBatch = () => {
              reader.readEntries((entries) => {
                if (entries.length === 0) { resolve(all); return; }
                all.push(...entries);
                readBatch();
              });
            };
            readBatch();
          });
        };
        const children = await readAll();
        for (const child of children) await readEntry(child);
      }
    };
    const entries: FileSystemEntry[] = [];
    for (let i = 0; i < items.length; i++) {
      const entry = items[i].webkitGetAsEntry?.();
      if (entry) entries.push(entry);
    }
    // Fallback: if no webkitGetAsEntry, use getAsFile
    if (entries.length === 0) {
      for (let i = 0; i < items.length; i++) {
        const file = items[i].getAsFile();
        if (file) result.push(file);
      }
      return result;
    }
    for (const entry of entries) await readEntry(entry);
    return result;
  }, []);

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const onDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (e.dataTransfer.types.includes('Files')) setIsDragging(true);
  };

  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setIsDragging(false);
    }
  };

  const warnDuplicates = (filenames: string[]) => {
    const existing = new Set(nodes.map(n => n.name.toLowerCase()));
    const dupes = filenames.filter(f => existing.has(f.toLowerCase()));
    if (dupes.length === 1) toast(`"${dupes[0]}" 已存在，上传后将覆盖原文件`, { icon: '⚠️', duration: 5000 });
    else if (dupes.length > 1) toast(`${dupes.length} 个文件名已存在，上传后将覆盖原文件`, { icon: '⚠️', duration: 5000 });
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounter.current = 0;
    const items = e.dataTransfer.items;
    if (!items.length) return;
    try {
      const files = await collectFiles(items);
      if (files.length) {
        warnDuplicates(files.map(f => f.name));
        addFiles(files, currentParentId, isPrivate);
        toast.success(`已添加 ${files.length} 个文件到上传队列`);
      }
    } catch (err: any) {
      toast.error('读取拖拽文件失败');
    }
  };

  // Sync isPrivate prop to store on mount / when prop changes
  useEffect(() => {
    if (isPrivate !== storePrivate) {
      setPrivate(isPrivate);
    }
  }, [isPrivate]); // eslint-disable-line react-hooks/exhaustive-deps

  // Main file list query
  const listQueryKey = ['files', currentParentId, isPrivate, sortField, sortOrder, filterType];
  const { data: listData, isLoading: listLoading, error: listError } = useQuery({
    queryKey: listQueryKey,
    queryFn: async () => {
      const params: Record<string, any> = {
        parentId: currentParentId ?? '',
        private: isPrivate,
        sort: sortField,
        order: sortOrder,
      };
      if (filterType && filterType !== 'all') params.type = filterType;
      const res = await filesApi.list(params);
      return (res as any)?.nodes ?? (res as any) ?? [];
    },
    enabled: !searchQuery,
    staleTime: 30_000,
    placeholderData: (prev: any) => prev,
  });

  // Search query
  const { data: searchData, isLoading: searchLoading } = useQuery({
    queryKey: ['files', 'search', searchQuery, isPrivate, sortField, sortOrder],
    queryFn: async () => {
      const res = await filesApi.search({
        q: searchQuery,
        private: isPrivate,
        sort: sortField,
        order: sortOrder,
      });
      return (res as any)?.nodes ?? (res as any) ?? [];
    },
    enabled: !!searchQuery,
    staleTime: 15_000,
    placeholderData: (prev: any) => prev,
  });

  const nodes: Node[] = searchQuery ? (searchData ?? []) : (listData ?? []);
  const isLoading = searchQuery ? searchLoading : listLoading;

  // Delete selected files
  const deleteSelected = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    try {
      await filesApi.delete(ids);
      queryClient.invalidateQueries({ queryKey: ['files'] });
      clearSelection();
      toast.success(`已删除 ${ids.length} 个文件`);
    } catch {
      // error toast handled by interceptor
    }
  }, [selectedIds, queryClient, clearSelection]);

  // Keyboard shortcuts
  const [showShortcuts, setShowShortcuts] = useState(false);
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        if (e.key === 'Escape') (target as HTMLInputElement).blur();
        return;
      }

      if (e.key === '?') {
        e.preventDefault();
        setShowShortcuts(v => !v);
        return;
      }
      if (e.key === 'Escape') {
        clearSelection();
        setContextMenu(null, null);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedIds.size > 0) deleteSelected();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault();
        selectAll(nodes.map((n) => n.id));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedIds, nodes, clearSelection, selectAll, deleteSelected, setContextMenu]);

  const isEmpty = !isLoading && nodes.length === 0;

  if (listError && !searchQuery) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-500 gap-3 dark:text-gray-400">
        <p className="text-red-500">加载失败，请刷新重试</p>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col h-full overflow-hidden relative"
      onDragOver={onDragOver}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <FileToolbar nodes={nodes} isLoading={isLoading} />

      <div className="flex-1 overflow-y-auto">
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-4 py-20 dark:text-gray-500">
            <UploadCloud className="w-16 h-16 text-gray-300" />
            <p className="text-lg font-medium">
              {searchQuery ? '没有找到匹配的文件' : '此文件夹为空'}
            </p>
            <p className="text-sm">
              {searchQuery ? '请尝试其他关键词' : '拖拽文件到此处，或点击上方按钮上传'}
            </p>
          </div>
        ) : viewMode === 'list' ? (
          <FileList nodes={nodes} isLoading={isLoading} />
        ) : (
          <FileGrid nodes={nodes} isLoading={isLoading} />
        )}
      </div>

      {/* Drag overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-blue-500/10 backdrop-blur-sm border-2 border-dashed border-blue-400 rounded-xl pointer-events-none">
          <div className="flex flex-col items-center gap-3 px-8 py-6 rounded-2xl bg-white/90 dark:bg-gray-900/90 shadow-xl">
            <FolderUp className="w-12 h-12 text-blue-500" />
            <p className="text-lg font-semibold text-gray-800 dark:text-gray-100">释放以上传</p>
            <p className="text-sm text-gray-500">支持文件和文件夹</p>
          </div>
        </div>
      )}

      {/* Always mounted. FileContextMenu owns the rename/move/copy/share/lock
          dialog state in LOCAL React state — gating the component on
          contextMenuNode unmounted it the instant the menu closed, dropping
          dialogNode/dialogIds/dialog before the dialog could render. The
          component already has its own `{node && pos && (...)}` guard for the
          menu chrome itself, so leaving it mounted only costs a couple of
          null checks per render. */}
      <FileContextMenu />

      {previewNode && (
        <PreviewModal nodes={nodes} />
      )}

      <ShortcutsPanel open={showShortcuts} onClose={() => setShowShortcuts(false)} />
    </div>
  );
}
