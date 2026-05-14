import React, { useState, useEffect, useRef } from 'react';
import {
  ChevronRight,
  Home,
  Search,
  LayoutList,
  LayoutGrid,
  ArrowUpDown,
  UploadCloud,
  Sun,
  Moon,
  SortAsc,
  SortDesc,
} from 'lucide-react';
import { useFileStore } from '../../stores/file.store';
import { FileFilter, SortField } from '../../types';

// ── Dark mode hook ────────────────────────────────────────────────────────────

function useDarkMode() {
  const [dark, setDark] = useState(() => {
    if (typeof window === 'undefined') return false;
    return (
      localStorage.getItem('theme') === 'dark' ||
      (!localStorage.getItem('theme') && window.matchMedia('(prefers-color-scheme: dark)').matches)
    );
  });

  useEffect(() => {
    const root = window.document.documentElement;
    if (dark) {
      root.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      root.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [dark]);

  return [dark, setDark] as const;
}

// ── Filter tab labels ─────────────────────────────────────────────────────────

const filterTabs: { value: FileFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'image', label: '图片' },
  { value: 'video', label: '视频' },
  { value: 'audio', label: '音频' },
  { value: 'document', label: '文档' },
  { value: 'archive', label: '压缩包' },
];

const sortOptions: { value: SortField; label: string }[] = [
  { value: 'name', label: '名称' },
  { value: 'size', label: '大小' },
  { value: 'createdAt', label: '上传时间' },
  { value: 'updatedAt', label: '修改时间' },
];

// ── Topbar ────────────────────────────────────────────────────────────────────

interface TopbarProps {
  onUpload?: () => void;
}

export default function Topbar({ onUpload }: TopbarProps) {
  const {
    currentPath,
    navigateTo,
    navigate: fileNavigate,
    viewMode,
    setViewMode,
    sortField,
    sortOrder,
    setSort,
    filterType,
    setFilter,
    searchQuery,
    setSearch,
  } = useFileStore();

  const [dark, setDark] = useDarkMode();
  const [localSearch, setLocalSearch] = useState(searchQuery);
  const [showSortMenu, setShowSortMenu] = useState(false);
  const sortRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSearch(localSearch);
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [localSearch, setSearch]);

  // Sync external changes
  useEffect(() => {
    if (searchQuery !== localSearch) setLocalSearch(searchQuery);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery]);

  // Close sort menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) {
        setShowSortMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleBreadcrumbRoot = () => fileNavigate(null);
  const handleBreadcrumbItem = (index: number) => navigateTo(index);

  return (
    <div className="flex flex-col">
        {/* Upper row: breadcrumb + actions */}
        <div className="flex items-center gap-3 px-4 h-14">
          {/* Breadcrumb */}
          <nav className="flex items-center gap-1 flex-1 min-w-0 text-sm">
            <button
              onClick={handleBreadcrumbRoot}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition dark:hover:bg-gray-700"
            >
              <Home className="h-4 w-4" />
              <span className="font-medium">我的文件</span>
            </button>

            {currentPath.map((crumb, idx) => (
              <React.Fragment key={crumb.id}>
                <ChevronRight className="h-3.5 w-3.5 text-gray-400 shrink-0 dark:text-gray-500" />
                <button
                  onClick={() => handleBreadcrumbItem(idx)}
                  className={`px-2 py-1 rounded-lg transition truncate max-w-[140px] ${
                    idx === currentPath.length - 1
                      ? 'text-gray-900 dark:text-white font-semibold cursor-default'
                      : 'text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                  }`}
                >
                  {crumb.name}
                </button>
              </React.Fragment>
            ))}
          </nav>

          {/* Search */}
          <div className="relative w-52">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none dark:text-gray-500" />
            <input
              type="text"
              value={localSearch}
              onChange={e => setLocalSearch(e.target.value)}
              placeholder="搜索文件…"
              className="w-full pl-9 pr-3 py-1.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition dark:bg-gray-900 dark:text-gray-100 dark:placeholder-gray-500"
            />
          </div>

          {/* View mode */}
          <div className="flex items-center rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            <button
              onClick={() => setViewMode('list')}
              title="列表视图"
              className={`p-1.5 transition ${viewMode === 'list' ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800'}`}
            >
              <LayoutList className="h-4 w-4" />
            </button>
            <button
              onClick={() => setViewMode('grid')}
              title="网格视图"
              className={`p-1.5 transition ${viewMode === 'grid' ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800'}`}
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
          </div>

          {/* Sort dropdown */}
          <div className="relative" ref={sortRef}>
            <button
              onClick={() => setShowSortMenu(p => !p)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition dark:hover:bg-gray-700/50"
            >
              <ArrowUpDown className="h-3.5 w-3.5" />
              <span>{sortOptions.find(s => s.value === sortField)?.label ?? '排序'}</span>
              {sortOrder === 'ASC'
                ? <SortAsc className="h-3.5 w-3.5" />
                : <SortDesc className="h-3.5 w-3.5" />
              }
            </button>

            {showSortMenu && (
              <div className="absolute right-0 top-full mt-1 w-36 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-100 dark:border-gray-700 overflow-hidden z-30">
                {sortOptions.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => { setSort(opt.value); setShowSortMenu(false); }}
                    className={`w-full text-left px-4 py-2 text-sm transition ${
                      sortField === opt.value
                        ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-400 font-medium'
                        : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Upload button */}
          {onUpload && (
            <button
              onClick={onUpload}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition shadow-sm shadow-blue-500/20"
            >
              <UploadCloud className="h-4 w-4" />
              <span className="hidden lg:inline">上传</span>
            </button>
          )}

          {/* Dark mode toggle */}
          <button
            onClick={() => setDark(d => !d)}
            title={dark ? '切换亮色模式' : '切换暗色模式'}
            className="p-1.5 rounded-xl text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition dark:text-gray-500 dark:hover:bg-gray-700"
          >
            {dark ? <Sun className="h-4.5 w-4.5" /> : <Moon className="h-4.5 w-4.5" />}
          </button>
        </div>

        {/* Lower row: filter tabs */}
        <div className="flex items-center gap-1 px-4 pb-1.5 border-t border-gray-100 dark:border-gray-800 dark:border-gray-700">
          {filterTabs.map(tab => (
            <button
              key={tab.value}
              onClick={() => setFilter(tab.value)}
              className={`px-3 py-1 rounded-lg text-sm transition ${
                filterType === tab.value
                  ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-400 font-medium'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
    </div>
  );
}
