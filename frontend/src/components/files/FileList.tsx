import { useRef } from 'react';
import {
  Folder,
  Image,
  Play,
  Music,
  FileText,
  Archive,
  Code,
  File,
  Lock,
  Star,
  ChevronUp,
  ChevronDown,
} from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Node } from '../../types';
import { useFileStore } from '../../stores/file.store';
import { formatBytes } from '../../utils/crypto';
import { t } from '../../i18n/translations';

const ROW_HEIGHT = 52;

interface FileListProps {
  nodes: Node[];
  isLoading: boolean;
}

function getMimeIcon(mimeType?: string) {
  if (!mimeType) return <File className="w-5 h-5 text-gray-400 dark:text-gray-500" />;
  if (mimeType.startsWith('image/')) return <Image className="w-5 h-5 text-purple-500" />;
  if (mimeType.startsWith('video/')) return <Play className="w-5 h-5 text-red-500" />;
  if (mimeType.startsWith('audio/')) return <Music className="w-5 h-5 text-green-500" />;
  if (mimeType === 'application/pdf') return <FileText className="w-5 h-5 text-orange-500" />;
  if (
    mimeType.includes('zip') ||
    mimeType.includes('rar') ||
    mimeType.includes('tar') ||
    mimeType.includes('gz') ||
    mimeType.includes('7z')
  )
    return <Archive className="w-5 h-5 text-gray-500 dark:text-gray-400" />;
  if (
    mimeType.includes('javascript') ||
    mimeType.includes('typescript') ||
    mimeType.includes('json') ||
    mimeType.includes('xml') ||
    mimeType.includes('html') ||
    mimeType.includes('css') ||
    mimeType.startsWith('text/x-')
  )
    return <Code className="w-5 h-5 text-blue-500" />;
  return <File className="w-5 h-5 text-gray-400 dark:text-gray-500" />;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const day = 86_400_000;
  const time = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  if (diff < day) return `今天 ${time}`;
  const datePart = date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  if (diff < 365 * day) return `${datePart} ${time}`;
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' }) + ` ${time}`;
}

function getTypeBadge(node: Node): string {
  if (node.type === 'folder') return t('filelist.folder');
  const mime = node.mimeType ?? '';
  if (mime.startsWith('image/')) return t('filelist.image');
  if (mime.startsWith('video/')) return t('filelist.video');
  if (mime.startsWith('audio/')) return t('filelist.audio');
  if (mime === 'application/pdf') return t('filelist.pdf');
  if (mime.includes('zip') || mime.includes('rar') || mime.includes('tar') || mime.includes('gz'))
    return t('filelist.archive');
  if (mime.startsWith('text/')) return t('filelist.text');
  return t('filelist.file');
}

const gridCols = 'grid-cols-[40px_1fr_80px_90px_130px_130px]';

function SkeletonRow() {
  return (
    <div className={`grid ${gridCols} items-center animate-pulse border-b border-gray-100 dark:border-gray-800`} style={{ height: ROW_HEIGHT }}>
      <div className="px-4"><div className="w-4 h-4 bg-gray-200 dark:bg-gray-700 rounded" /></div>
      <div className="px-4 flex items-center gap-3">
        <div className="w-5 h-5 bg-gray-200 dark:bg-gray-700 rounded" />
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-40" />
      </div>
      <div className="px-4"><div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-16" /></div>
      <div className="px-4"><div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-14" /></div>
      <div className="px-4"><div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-20" /></div>
      <div className="px-4"><div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-20" /></div>
    </div>
  );
}

export default function FileList({ nodes, isLoading }: FileListProps) {
  const {
    selectedIds,
    sortField,
    sortOrder,
    navigate,
    setPreview,
    setContextMenu,
    selectNode,
    selectAll,
    clearSelection,
    setSort,
  } = useFileStore();

  const lastClickedRef = useRef<string | null>(null);

  const handleRowClick = (e: React.MouseEvent, node: Node) => {
    e.preventDefault();
    const ids = nodes.map((n) => n.id);

    if (e.shiftKey && lastClickedRef.current) {
      const fromIdx = ids.indexOf(lastClickedRef.current);
      const toIdx = ids.indexOf(node.id);
      if (fromIdx !== -1 && toIdx !== -1) {
        const rangeIds = ids.slice(
          Math.min(fromIdx, toIdx),
          Math.max(fromIdx, toIdx) + 1,
        );
        selectNode(node.id, false, rangeIds);
        return;
      }
    }

    lastClickedRef.current = node.id;
    // Always toggle selection (checkbox-style behavior)
    selectNode(node.id, true);
  };

  const handleRowDoubleClick = (node: Node) => {
    if (node.type === 'folder') {
      navigate(node.id, node.name);
    } else {
      setPreview(node);
    }
  };

  const handleContextMenu = (e: React.MouseEvent, node: Node) => {
    e.preventDefault();
    if (!selectedIds.has(node.id)) {
      selectNode(node.id, false);
    }
    setContextMenu(node, { x: e.clientX, y: e.clientY });
  };

  const allSelected = nodes.length > 0 && nodes.every((n) => selectedIds.has(n.id));
  const someSelected = nodes.some((n) => selectedIds.has(n.id));

  const handleHeaderCheckbox = () => {
    if (allSelected) {
      clearSelection();
    } else {
      selectAll(nodes.map((n) => n.id));
    }
  };

  const SortIcon = ({ field }: { field: string }) => {
    if (sortField !== field) return null;
    return sortOrder === 'ASC' ? (
      <ChevronUp className="w-3 h-3 inline ml-1" />
    ) : (
      <ChevronDown className="w-3 h-3 inline ml-1" />
    );
  };

  const thClass =
    'px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider select-none';
  const sortableTh = `${thClass} cursor-pointer hover:text-gray-800 dark:hover:text-gray-200`;

  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: isLoading ? 0 : nodes.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  const Row = ({ node }: { node: Node }) => {
    const isSelected = selectedIds.has(node.id);
    return (
      <div
        className={`grid ${gridCols} items-center cursor-pointer transition-colors border-b border-gray-100 dark:border-gray-800 ${
          isSelected
            ? 'bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/30 dark:hover:bg-blue-900/40'
            : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
        }`}
        style={{ height: ROW_HEIGHT }}
        onClick={(e) => handleRowClick(e, node)}
        onDoubleClick={() => handleRowDoubleClick(node)}
        onContextMenu={(e) => handleContextMenu(e, node)}
      >
        <div className="px-4">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => selectNode(node.id, true)}
            onClick={(e) => e.stopPropagation()}
            className="w-4 h-4 rounded border-gray-300 text-blue-600 cursor-pointer dark:border-gray-600"
          />
        </div>
        <div className="px-4 min-w-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="relative flex-shrink-0">
              {node.type === 'folder' ? (
                <Folder className="w-5 h-5 text-yellow-400 fill-yellow-300" />
              ) : (
                getMimeIcon(node.mimeType)
              )}
              {node.isLocked && (
                <Lock className="w-2.5 h-2.5 text-gray-500 absolute -bottom-0.5 -right-0.5 dark:text-gray-400" />
              )}
            </div>
            <span className="truncate font-medium text-gray-800 dark:text-gray-100">{node.name}</span>
            {node.tags?.slice(0, 2).map((t: any) => (
              <span key={t.id} className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300 flex-shrink-0 max-w-[80px] truncate"
                style={t.color ? { backgroundColor: t.color + '20', color: t.color } : {}}>
                {t.name}
              </span>
            ))}
            {node.isStarred && (
              <Star className="w-3.5 h-3.5 text-yellow-400 fill-yellow-300 flex-shrink-0" />
            )}
          </div>
        </div>
        <div className="px-4">
          <span className="inline-block px-2 py-0.5 text-xs rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 truncate">
            {getTypeBadge(node)}
          </span>
        </div>
        <div className="px-4 text-sm text-gray-500 dark:text-gray-400 truncate">
          {node.type === 'folder' ? '—' : formatBytes(node.size)}
        </div>
        <div className="px-4 text-sm text-gray-500 dark:text-gray-400 truncate">
          {formatDate(node.createdAt)}
        </div>
        <div className="px-4 text-sm text-gray-500 dark:text-gray-400 truncate">
          {formatDate(node.updatedAt)}
        </div>
      </div>
    );
  };

  return (
    <div ref={scrollRef} className="w-full overflow-auto" style={{ height: 'calc(100vh - 200px)' }}>
      {/* Header */}
      <div className={`grid ${gridCols} items-center sticky top-0 z-10 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 dark:bg-gray-900`}>
        <div className="px-4 py-2">
          <input
            type="checkbox"
            checked={allSelected}
            ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
            onChange={handleHeaderCheckbox}
            className="w-4 h-4 rounded border-gray-300 text-blue-600 cursor-pointer dark:border-gray-600"
          />
        </div>
        <div className={`${sortableTh} cursor-pointer`} onClick={() => setSort('name')}>
          {t('files.colName')} <SortIcon field="name" />
        </div>
        <div className={thClass}>{t('filelist.colType')}</div>
        <div className={`${sortableTh} cursor-pointer`} onClick={() => setSort('size')}>
          {t('files.colSize')} <SortIcon field="size" />
        </div>
        <div className={`${sortableTh} cursor-pointer`} onClick={() => setSort('createdAt')}>
          {t('files.colUploadTime')} <SortIcon field="createdAt" />
        </div>
        <div className={`${sortableTh} cursor-pointer`} onClick={() => setSort('updatedAt')}>
          {t('files.colModifiedTime')} <SortIcon field="updatedAt" />
        </div>
      </div>

      {/* Virtual body */}
      <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
        {isLoading
          ? Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)
          : virtualizer.getVirtualItems().map(vRow => (
              <div
                key={nodes[vRow.index].id}
                className="absolute top-0 left-0 w-full"
                style={{ transform: `translateY(${vRow.start}px)` }}
              >
                <Row node={nodes[vRow.index]} />
              </div>
            ))}
      </div>
    </div>
  );
}
