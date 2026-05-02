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
import { Node } from '../../types';
import { useFileStore } from '../../stores/file.store';
import { formatBytes } from '../../utils/crypto';

interface FileListProps {
  nodes: Node[];
  isLoading: boolean;
}

function getMimeIcon(mimeType?: string) {
  if (!mimeType) return <File className="w-5 h-5 text-gray-400" />;
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
    return <Archive className="w-5 h-5 text-gray-500" />;
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
  return <File className="w-5 h-5 text-gray-400" />;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const day = 86_400_000;
  if (diff < day) return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  if (diff < 7 * day)
    return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' });
}

function getTypeBadge(node: Node): string {
  if (node.type === 'folder') return '文件夹';
  const mime = node.mimeType ?? '';
  if (mime.startsWith('image/')) return '图片';
  if (mime.startsWith('video/')) return '视频';
  if (mime.startsWith('audio/')) return '音频';
  if (mime === 'application/pdf') return 'PDF';
  if (mime.includes('zip') || mime.includes('rar') || mime.includes('tar') || mime.includes('gz'))
    return '压缩包';
  if (mime.startsWith('text/')) return '文本';
  return '文件';
}

function SkeletonRow() {
  return (
    <tr className="animate-pulse border-b border-gray-100 dark:border-gray-800">
      <td className="w-10 px-4 py-3">
        <div className="w-4 h-4 bg-gray-200 dark:bg-gray-700 rounded" />
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 bg-gray-200 dark:bg-gray-700 rounded" />
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-40" />
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-16" />
      </td>
      <td className="px-4 py-3">
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-14" />
      </td>
      <td className="px-4 py-3">
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-20" />
      </td>
    </tr>
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

  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 sticky top-0 z-10">
          <tr>
            <th className="w-10 px-4 py-2">
              <input
                type="checkbox"
                checked={allSelected}
                ref={(el) => {
                  if (el) el.indeterminate = someSelected && !allSelected;
                }}
                onChange={handleHeaderCheckbox}
                className="w-4 h-4 rounded border-gray-300 text-blue-600 cursor-pointer"
              />
            </th>
            <th
              className={sortableTh}
              onClick={() => setSort('name')}
            >
              名称 <SortIcon field="name" />
            </th>
            <th className={thClass}>类型</th>
            <th
              className={sortableTh}
              onClick={() => setSort('size')}
            >
              大小 <SortIcon field="size" />
            </th>
            <th
              className={sortableTh}
              onClick={() => setSort('updatedAt')}
            >
              修改时间 <SortIcon field="updatedAt" />
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
          {isLoading
            ? Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)
            : nodes.map((node) => {
                const isSelected = selectedIds.has(node.id);
                return (
                  <tr
                    key={node.id}
                    className={`group cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/30 dark:hover:bg-blue-900/40'
                        : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
                    }`}
                    onClick={(e) => handleRowClick(e, node)}
                    onDoubleClick={() => handleRowDoubleClick(node)}
                    onContextMenu={(e) => handleContextMenu(e, node)}
                  >
                    {/* Checkbox */}
                    <td className="w-10 px-4 py-3">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => selectNode(node.id, true)}
                        onClick={(e) => e.stopPropagation()}
                        className="w-4 h-4 rounded border-gray-300 text-blue-600 cursor-pointer"
                      />
                    </td>

                    {/* Name */}
                    <td className="px-4 py-3 max-w-xs">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="relative flex-shrink-0">
                          {node.type === 'folder' ? (
                            <Folder className="w-5 h-5 text-yellow-400 fill-yellow-300" />
                          ) : (
                            getMimeIcon(node.mimeType)
                          )}
                          {node.isLocked && (
                            <Lock className="w-2.5 h-2.5 text-gray-500 absolute -bottom-0.5 -right-0.5" />
                          )}
                        </div>
                        <span className="truncate font-medium text-gray-800 dark:text-gray-100">{node.name}</span>
                        {node.isStarred && (
                          <Star className="w-3.5 h-3.5 text-yellow-400 fill-yellow-300 flex-shrink-0" />
                        )}
                      </div>
                    </td>

                    {/* Type badge */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="inline-block px-2 py-0.5 text-xs rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                        {getTypeBadge(node)}
                      </span>
                    </td>

                    {/* Size */}
                    <td className="px-4 py-3 whitespace-nowrap text-gray-500 dark:text-gray-400">
                      {node.type === 'folder' ? '—' : formatBytes(node.size)}
                    </td>

                    {/* Date */}
                    <td className="px-4 py-3 whitespace-nowrap text-gray-500 dark:text-gray-400">
                      {formatDate(node.updatedAt)}
                    </td>
                  </tr>
                );
              })}
        </tbody>
      </table>
    </div>
  );
}
