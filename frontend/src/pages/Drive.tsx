import { useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { UploadCloud } from 'lucide-react';
import toast from 'react-hot-toast';

import { filesApi } from '../api/client';
import { useFileStore } from '../stores/file.store';
import { Node } from '../types';

import FileToolbar from '../components/files/FileToolbar';
import FileList from '../components/files/FileList';
import FileGrid from '../components/files/FileGrid';
import FileContextMenu from '../components/files/FileContextMenu';
import PreviewModal from '../components/preview/PreviewModal';

interface DriveProps {
  isPrivate?: boolean;
}

export default function Drive({ isPrivate = false }: DriveProps) {
  const queryClient = useQueryClient();
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
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

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
      <div className="flex flex-col items-center justify-center h-full text-gray-500 gap-3">
        <p className="text-red-500">加载失败，请刷新重试</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <FileToolbar nodes={nodes} isLoading={isLoading} />

      <div className="flex-1 overflow-y-auto">
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-4 py-20">
            <UploadCloud className="w-16 h-16 text-gray-300" />
            <p className="text-lg font-medium">
              {searchQuery ? '没有找到匹配的文件' : '此文件夹为空'}
            </p>
            <p className="text-sm">
              {searchQuery ? '请尝试其他关键词' : '点击上方按钮上传文件或创建文件夹'}
            </p>
          </div>
        ) : viewMode === 'list' ? (
          <FileList nodes={nodes} isLoading={isLoading} />
        ) : (
          <FileGrid nodes={nodes} isLoading={isLoading} />
        )}
      </div>

      {contextMenuNode && contextMenuPos && (
        <FileContextMenu />
      )}

      {previewNode && (
        <PreviewModal nodes={nodes} />
      )}
    </div>
  );
}
