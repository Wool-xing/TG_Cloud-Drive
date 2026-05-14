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
} from 'lucide-react';
import { Node } from '../../types';
import { useFileStore } from '../../stores/file.store';
import { formatBytes } from '../../utils/crypto';

interface FileGridProps {
  nodes: Node[];
  isLoading: boolean;
}

function getMimeIcon(mimeType?: string, large = false) {
  const cls = large ? 'w-12 h-12' : 'w-8 h-8';
  if (!mimeType) return <File className={`${cls} text-gray-400`} />;
  if (mimeType.startsWith('image/')) return <Image className={`${cls} text-purple-500`} />;
  if (mimeType.startsWith('video/')) return <Play className={`${cls} text-red-500`} />;
  if (mimeType.startsWith('audio/')) return <Music className={`${cls} text-green-500`} />;
  if (mimeType === 'application/pdf') return <FileText className={`${cls} text-orange-500`} />;
  if (
    mimeType.includes('zip') ||
    mimeType.includes('rar') ||
    mimeType.includes('tar') ||
    mimeType.includes('gz') ||
    mimeType.includes('7z')
  )
    return <Archive className={`${cls} text-gray-500`} />;
  if (
    mimeType.includes('javascript') ||
    mimeType.includes('typescript') ||
    mimeType.includes('json') ||
    mimeType.includes('xml') ||
    mimeType.includes('html') ||
    mimeType.includes('css') ||
    mimeType.startsWith('text/x-')
  )
    return <Code className={`${cls} text-blue-500`} />;
  return <File className={`${cls} text-gray-400`} />;
}

function isImageMime(mimeType?: string) {
  return !!mimeType && mimeType.startsWith('image/');
}

function SkeletonCard() {
  return (
    <div className="animate-pulse rounded-xl border border-gray-200 overflow-hidden bg-white dark:bg-gray-800 dark:border-gray-700">
      <div className="h-36 bg-gray-200 dark:bg-gray-700" />
      <div className="p-3 space-y-2">
        <div className="h-3.5 bg-gray-200 rounded w-3/4 dark:bg-gray-700" />
        <div className="h-3 bg-gray-200 rounded w-1/3 dark:bg-gray-700" />
      </div>
    </div>
  );
}

export default function FileGrid({ nodes, isLoading }: FileGridProps) {
  const {
    selectedIds,
    navigate,
    setPreview,
    setContextMenu,
    selectNode,
    selectAll,
    clearSelection,
  } = useFileStore();

  const lastClickedRef = useRef<string | null>(null);

  const handleCardClick = (e: React.MouseEvent, node: Node) => {
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

    if (e.ctrlKey || e.metaKey) {
      selectNode(node.id, true);
    } else {
      selectNode(node.id, false);
    }
  };

  const handleDoubleClick = (node: Node) => {
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

  const handleCheckbox = (e: React.MouseEvent, node: Node) => {
    e.stopPropagation();
    selectNode(node.id, true);
  };

  if (isLoading) {
    return (
      <div className="p-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
        {Array.from({ length: 12 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    );
  }

  return (
    <div className="p-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
      {nodes.map((node) => {
        const isSelected = selectedIds.has(node.id);
        const showThumbnail = node.type === 'file' && isImageMime(node.mimeType);

        return (
          <div
            key={node.id}
            className={`group relative rounded-xl border-2 overflow-hidden bg-white dark:bg-gray-800 cursor-pointer transition-all select-none ${
              isSelected
                ? 'border-blue-500 ring-2 ring-blue-300 dark:ring-blue-500/40 shadow-md'
                : 'border-transparent hover:border-gray-200 dark:hover:border-gray-700 hover:shadow-md'
            }`}
            onClick={(e) => handleCardClick(e, node)}
            onDoubleClick={() => handleDoubleClick(node)}
            onContextMenu={(e) => handleContextMenu(e, node)}
          >
            {/* Thumbnail / Icon area */}
            <div className="h-32 bg-gray-50 flex items-center justify-center relative overflow-hidden dark:bg-gray-900">
              {showThumbnail ? (
                <img
                  src={`/api/files/thumbnail/${node.id}`}
                  alt={node.name}
                  className="w-full h-full object-cover"
                  loading="lazy"
                  onError={(e) => {
                    const target = e.currentTarget as HTMLImageElement;
                    target.style.display = 'none';
                    (target.nextElementSibling as HTMLElement | null)?.removeAttribute('style');
                  }}
                />
              ) : node.type === 'folder' ? (
                <Folder className="w-14 h-14 text-yellow-400 fill-yellow-300" />
              ) : (
                getMimeIcon(node.mimeType, true)
              )}
              {/* Fallback icon (hidden by default, shown on image error) */}
              {showThumbnail && (
                <div className="absolute inset-0 hidden items-center justify-center bg-gray-50 dark:bg-gray-900">
                  {getMimeIcon(node.mimeType, true)}
                </div>
              )}

              {/* Checkbox overlay */}
              <div
                className={`absolute top-2 left-2 transition-opacity ${
                  isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                }`}
                onClick={(e) => handleCheckbox(e, node)}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => {}}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 cursor-pointer shadow dark:border-gray-600"
                />
              </div>

              {/* Lock icon */}
              {node.isLocked && (
                <div className="absolute top-2 right-2">
                  <div className="bg-white/80 backdrop-blur-sm rounded-full p-1">
                    <Lock className="w-3 h-3 text-gray-600 dark:text-gray-300" />
                  </div>
                </div>
              )}

              {/* Star icon */}
              {node.isStarred && (
                <div className="absolute bottom-2 right-2">
                  <Star className="w-4 h-4 text-yellow-400 fill-yellow-300 drop-shadow" />
                </div>
              )}
            </div>

            {/* Info */}
            <div className="px-3 py-2 border-t border-gray-100 dark:border-gray-700">
              <p
                className="text-sm font-medium text-gray-800 truncate dark:text-gray-100"
                title={node.name}
              >
                {node.name}
              </p>
              <p className="text-xs text-gray-400 mt-0.5 dark:text-gray-500">
                {node.type === 'folder' ? '文件夹' : formatBytes(node.size)}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
