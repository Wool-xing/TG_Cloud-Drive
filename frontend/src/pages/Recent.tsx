import { useQuery } from '@tanstack/react-query';
import { useNavigate as useRouterNavigate } from 'react-router-dom';
import {
  Clock,
  Loader2,
  AlertTriangle,
  Folder,
  Image,
  Play,
  Music,
  FileText,
  Archive,
  Code,
  File,
  Lock,
} from 'lucide-react';

import { filesApi } from '../api/client';
import { useFileStore } from '../stores/file.store';
import { Node } from '../types';
import { formatBytes } from '../utils/crypto';
import FileContextMenu from '../components/files/FileContextMenu';
import PreviewModal from '../components/preview/PreviewModal';

function getMimeCategory(node: Node): 'image' | 'video' | 'audio' | 'document' | 'archive' | 'other' {
  if (node.type === 'folder') return 'other';
  const mime = node.mimeType ?? '';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (
    mime === 'application/pdf' ||
    mime.startsWith('text/') ||
    mime.includes('word') ||
    mime.includes('excel') ||
    mime.includes('spreadsheet') ||
    mime.includes('presentation') ||
    mime.includes('powerpoint') ||
    mime.includes('opendocument')
  ) return 'document';
  if (
    mime.includes('zip') ||
    mime.includes('rar') ||
    mime.includes('tar') ||
    mime.includes('gzip') ||
    mime.includes('7z') ||
    mime.includes('bzip') ||
    mime.includes('x-compressed')
  ) return 'archive';
  return 'other';
}

function getTypeLabel(node: Node): string {
  if (node.type === 'folder') return '文件夹';
  const labels = {
    image: '图片', video: '视频', audio: '音频',
    document: '文档', archive: '压缩包', other: '其他',
  };
  return labels[getMimeCategory(node)];
}

function getMimeIcon(mimeType?: string) {
  if (!mimeType) return <File className="w-5 h-5 text-gray-400" />;
  if (mimeType.startsWith('image/')) return <Image className="w-5 h-5 text-purple-500" />;
  if (mimeType.startsWith('video/')) return <Play className="w-5 h-5 text-red-500" />;
  if (mimeType.startsWith('audio/')) return <Music className="w-5 h-5 text-green-500" />;
  if (mimeType === 'application/pdf') return <FileText className="w-5 h-5 text-orange-500" />;
  if (mimeType.includes('zip') || mimeType.includes('rar') || mimeType.includes('tar') || mimeType.includes('gz'))
    return <Archive className="w-5 h-5 text-gray-500" />;
  if (mimeType.includes('javascript') || mimeType.includes('typescript') || mimeType.includes('json') || mimeType.startsWith('text/x-'))
    return <Code className="w-5 h-5 text-blue-500" />;
  return <File className="w-5 h-5 text-gray-400" />;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function Recent() {
  const routerNavigate = useRouterNavigate();
  const { goTo, setPreview, setContextMenu, contextMenuNode, contextMenuPos, previewNode, filterType } = useFileStore();

  const { data: nodes = [], isLoading, error } = useQuery<Node[]>({
    queryKey: ['recent'],
    queryFn: async () => {
      const res = await filesApi.recent(50);
      return (res as any) ?? [];
    },
    staleTime: 30_000,
  });

  const filteredNodes = filterType === 'all' ? nodes : nodes.filter(n => getMimeCategory(n) === filterType);

  const handleRowClick = (node: Node) => {
    if (node.type === 'folder') {
      goTo(node.id, node.name);
      routerNavigate('/');
    } else {
      setPreview(node);
    }
  };

  const handleContextMenu = (e: React.MouseEvent, node: Node) => {
    e.preventDefault();
    setContextMenu(node, { x: e.clientX, y: e.clientY });
  };

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-red-500 gap-2">
        <AlertTriangle className="w-10 h-10" />
        <p>加载失败，请刷新重试</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        <Clock className="w-5 h-5 text-blue-500 shrink-0" />
        <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
          最近访问
          {filteredNodes.length > 0 && (
            <span className="ml-1.5 text-xs text-gray-400">({filteredNodes.length} 个项目)</span>
          )}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
          </div>
        ) : filteredNodes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4 text-gray-400">
            <div className="w-20 h-20 rounded-full bg-blue-50 dark:bg-blue-950/30 flex items-center justify-center">
              <Clock className="w-10 h-10 text-blue-300" />
            </div>
            <p className="text-lg font-medium text-gray-500 dark:text-gray-400">暂无最近文件</p>
            <p className="text-sm text-center max-w-xs">上传或操作文件后，最近使用的文件将显示在这里</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 sticky top-0 z-10">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">名称</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden md:table-cell">类型</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden sm:table-cell">大小</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden lg:table-cell">修改时间</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {filteredNodes.map(node => (
                <tr
                  key={node.id}
                  className="group cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                  onClick={() => handleRowClick(node)}
                  onContextMenu={e => handleContextMenu(e, node)}
                >
                  <td className="px-4 py-3">
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
                      <span className="truncate font-medium text-gray-800 dark:text-gray-100 max-w-[200px]">{node.name}</span>
                    </div>
                  </td>

                  <td className="px-4 py-3 hidden md:table-cell">
                    <span className="inline-block px-2 py-0.5 text-xs rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                      {getTypeLabel(node)}
                    </span>
                  </td>

                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400 hidden sm:table-cell">
                    {node.type === 'folder' ? '—' : formatBytes(node.size)}
                  </td>

                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs hidden lg:table-cell">
                    {formatDate(node.updatedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {contextMenuNode && contextMenuPos && <FileContextMenu />}
      {previewNode && <PreviewModal nodes={nodes} />}
    </div>
  );
}
