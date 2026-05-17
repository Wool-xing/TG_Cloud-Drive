import { describe, it, expect, beforeEach } from 'vitest';
import { useFileStore } from './file.store';

describe('useFileStore', () => {
  beforeEach(() => {
    // Reset store to initial state
    useFileStore.setState({
      currentPath: [],
      currentParentId: null,
      isPrivate: false,
      selectedIds: new Set(),
      viewMode: 'list',
      sortField: 'createdAt',
      sortOrder: 'DESC',
      filterType: 'all',
      searchQuery: '',
      previewNode: null,
      contextMenuNode: null,
      contextMenuPos: null,
    });
  });

  describe('navigate', () => {
    it('sets root when folderId is null', () => {
      useFileStore.getState().navigate(null);
      const s = useFileStore.getState();
      expect(s.currentParentId).toBeNull();
      expect(s.currentPath).toEqual([]);
    });

    it('adds folder to breadcrumb path', () => {
      useFileStore.getState().navigate('folder-1', 'Docs');
      const s = useFileStore.getState();
      expect(s.currentParentId).toBe('folder-1');
      expect(s.currentPath).toEqual([{ id: 'folder-1', name: 'Docs' }]);
    });

    it('guards against double-click duplicate', () => {
      useFileStore.getState().navigate('folder-1', 'Docs');
      useFileStore.getState().navigate('folder-1', 'Docs');
      expect(useFileStore.getState().currentPath.length).toBe(1);
    });

    it('clears selection on navigate', () => {
      useFileStore.setState({ selectedIds: new Set(['a', 'b']) });
      useFileStore.getState().navigate('folder-1', 'Docs');
      expect(useFileStore.getState().selectedIds.size).toBe(0);
    });
  });

  describe('navigateTo', () => {
    it('goes to root on negative index', () => {
      useFileStore.setState({
        currentPath: [{ id: 'f1', name: 'A' }, { id: 'f2', name: 'B' }],
        currentParentId: 'f2',
      });
      useFileStore.getState().navigateTo(-1);
      const s = useFileStore.getState();
      expect(s.currentParentId).toBeNull();
      expect(s.currentPath).toEqual([]);
    });

    it('trims path to index', () => {
      useFileStore.setState({
        currentPath: [{ id: 'f1', name: 'A' }, { id: 'f2', name: 'B' }, { id: 'f3', name: 'C' }],
        currentParentId: 'f3',
      });
      useFileStore.getState().navigateTo(0);
      const s = useFileStore.getState();
      expect(s.currentParentId).toBe('f1');
      expect(s.currentPath).toEqual([{ id: 'f1', name: 'A' }]);
    });
  });

  describe('goTo', () => {
    it('sets direct path to single folder', () => {
      useFileStore.getState().goTo('deep-folder', 'Deep');
      const s = useFileStore.getState();
      expect(s.currentParentId).toBe('deep-folder');
      expect(s.currentPath).toEqual([{ id: 'deep-folder', name: 'Deep' }]);
    });

    it('resets private mode', () => {
      useFileStore.setState({ isPrivate: true });
      useFileStore.getState().goTo('f1', 'Files');
      expect(useFileStore.getState().isPrivate).toBe(false);
    });
  });

  describe('selectNode', () => {
    it('selects a single node', () => {
      useFileStore.getState().selectNode('n1', false);
      expect(useFileStore.getState().selectedIds.has('n1')).toBe(true);
    });

    it('deselects if same single node clicked', () => {
      useFileStore.getState().selectNode('n1', false);
      useFileStore.getState().selectNode('n1', false);
      expect(useFileStore.getState().selectedIds.size).toBe(0);
    });

    it('toggles with multi=true', () => {
      useFileStore.getState().selectNode('n1', true);
      useFileStore.getState().selectNode('n2', true);
      expect(useFileStore.getState().selectedIds.size).toBe(2);
      useFileStore.getState().selectNode('n1', true);
      expect(useFileStore.getState().selectedIds.has('n1')).toBe(false);
    });
  });

  describe('setSort', () => {
    it('toggles order when same field clicked', () => {
      useFileStore.setState({ sortField: 'name', sortOrder: 'ASC' });
      useFileStore.getState().setSort('name');
      // ASC → toggles to DES (same field, order !== 'DESC' → 'DESC')
      expect(useFileStore.getState().sortOrder).toBe('DESC');
      useFileStore.getState().setSort('name');
      // DES (same field, order === 'DESC' → 'ASC')
      expect(useFileStore.getState().sortOrder).toBe('ASC');
    });

    it('stays on current order when switching to different field', () => {
      useFileStore.setState({ sortField: 'createdAt', sortOrder: 'DESC' });
      useFileStore.getState().setSort('size');
      expect(useFileStore.getState().sortField).toBe('size');
      expect(useFileStore.getState().sortOrder).toBe('DESC');
    });
  });

  describe('setPrivate', () => {
    it('resets path and selection', () => {
      useFileStore.setState({
        currentParentId: 'f1',
        currentPath: [{ id: 'f1', name: 'A' }],
        selectedIds: new Set(['a', 'b']),
      });
      useFileStore.getState().setPrivate(true);
      const s = useFileStore.getState();
      expect(s.isPrivate).toBe(true);
      expect(s.currentParentId).toBeNull();
      expect(s.selectedIds.size).toBe(0);
    });
  });

  describe('search', () => {
    it('sets search query', () => {
      useFileStore.getState().setSearch('report');
      expect(useFileStore.getState().searchQuery).toBe('report');
    });
  });
});
