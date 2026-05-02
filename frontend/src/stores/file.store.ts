import { create } from 'zustand';
import { Node, SortField, SortOrder, ViewMode, FileFilter } from '../types';

interface FileStore {
  currentPath: { id: string; name: string }[];
  currentParentId: string | null;
  isPrivate: boolean;
  selectedIds: Set<string>;
  viewMode: ViewMode;
  sortField: SortField;
  sortOrder: SortOrder;
  filterType: FileFilter;
  searchQuery: string;
  previewNode: Node | null;
  contextMenuNode: Node | null;
  contextMenuPos: { x: number; y: number } | null;

  navigate: (folderId: string | null, folderName?: string) => void;
  navigateTo: (index: number) => void;
  goTo: (folderId: string | null, folderName?: string) => void;
  setPrivate: (v: boolean) => void;
  selectNode: (id: string, multi: boolean, range?: string[]) => void;
  selectAll: (ids: string[]) => void;
  clearSelection: () => void;
  setViewMode: (m: ViewMode) => void;
  setSort: (field: SortField) => void;
  setFilter: (f: FileFilter) => void;
  setSearch: (q: string) => void;
  setPreview: (node: Node | null) => void;
  setContextMenu: (node: Node | null, pos: { x: number; y: number } | null) => void;
}

export const useFileStore = create<FileStore>((set, get) => ({
  currentPath: [],
  currentParentId: null,
  isPrivate: false,
  selectedIds: new Set(),
  viewMode: (localStorage.getItem('viewMode') as ViewMode) || 'list',
  sortField: 'createdAt',
  sortOrder: 'DESC',
  filterType: 'all',
  searchQuery: '',
  previewNode: null,
  contextMenuNode: null,
  contextMenuPos: null,

  navigate: (folderId, folderName) => {
    if (!folderId) {
      set({ currentParentId: null, currentPath: [], selectedIds: new Set() });
    } else {
      set(s => {
        // Guard against double-click adding duplicate breadcrumb entries
        if (s.currentParentId === folderId) return s;
        return {
          currentParentId: folderId,
          currentPath: [...s.currentPath, { id: folderId, name: folderName || folderId }],
          selectedIds: new Set(),
        };
      });
    }
  },

  goTo: (folderId, folderName) => {
    set({
      currentParentId: folderId,
      currentPath: folderId && folderName ? [{ id: folderId, name: folderName }] : [],
      selectedIds: new Set(),
      isPrivate: false,
    });
  },

  navigateTo: (index) => {
    const { currentPath } = get();
    if (index < 0) {
      set({ currentParentId: null, currentPath: [], selectedIds: new Set() });
    } else {
      const newPath = currentPath.slice(0, index + 1);
      set({ currentParentId: newPath[index].id, currentPath: newPath, selectedIds: new Set() });
    }
  },

  setPrivate: (v) => set({ isPrivate: v, currentParentId: null, currentPath: [], selectedIds: new Set() }),

  selectNode: (id, multi, range) => {
    set(s => {
      const ids = new Set(s.selectedIds);
      if (multi) {
        ids.has(id) ? ids.delete(id) : ids.add(id);
      } else if (range?.length) {
        range.forEach(rid => ids.add(rid));
      } else {
        return { selectedIds: ids.has(id) && ids.size === 1 ? new Set<string>() : new Set([id]) };
      }
      return { selectedIds: ids };
    });
  },

  selectAll: (ids) => set({ selectedIds: new Set(ids) }),
  clearSelection: () => set({ selectedIds: new Set() }),

  setViewMode: (m) => {
    localStorage.setItem('viewMode', m);
    set({ viewMode: m });
  },

  setSort: (field) => set(s => ({
    sortField: field,
    sortOrder: s.sortField === field && s.sortOrder === 'DESC' ? 'ASC' : 'DESC',
  })),

  setFilter: (f) => set({ filterType: f }),
  setSearch: (q) => set({ searchQuery: q }),
  setPreview: (node) => set({ previewNode: node }),
  setContextMenu: (node, pos) => set({ contextMenuNode: node, contextMenuPos: pos }),
}));
