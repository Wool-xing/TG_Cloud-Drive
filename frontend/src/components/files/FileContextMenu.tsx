import { useEffect, useRef, useState } from 'react';
import {
  Eye,
  Download,
  Edit,
  FolderInput,
  Copy,
  Star,
  Lock,
  Unlock,
  Share2,
  EyeOff,
  Trash2,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';

import { filesApi } from '../../api/client';
import { useFileStore } from '../../stores/file.store';
import { useAuthStore } from '../../stores/auth.store';
import { Node, DownloadInfo } from '../../types';
import { formatBytes, getSessionMEK, decryptDEK, decryptBuffer } from '../../utils/crypto';
import { streamingDownload, BlobFallbackTooLargeError } from '../../utils/streaming-download';
import RenameDialog from '../dialogs/RenameDialog';
import MoveDialog from '../dialogs/MoveDialog';
import ShareDialog from '../dialogs/ShareDialog';
import LockDialog from '../dialogs/LockDialog';

type DialogType = 'rename' | 'move' | 'copy' | 'share' | 'lock' | null;

export default function FileContextMenu() {
  const queryClient = useQueryClient();
  const { mekDerived } = useAuthStore();
  const {
    contextMenuNode: node,
    contextMenuPos: pos,
    selectedIds,
    isPrivate,
    setContextMenu,
    clearSelection,
    setPreview,
  } = useFileStore();

  const menuRef = useRef<HTMLDivElement>(null);
  const [dialog, setDialog] = useState<DialogType>(null);
  // Capture node/ids before close() clears the store — React 18 batches both
  // updates in a single render, so dialogs must use these saved values.
  const [dialogNode, setDialogNode] = useState<Node | null>(null);
  const [dialogIds, setDialogIds] = useState<string[]>([]);

  const effectiveIds = node
    ? selectedIds.has(node.id)
      ? Array.from(selectedIds)
      : [node.id]
    : [];

  // Adjust position to avoid overflow
  const [adjustedPos, setAdjustedPos] = useState(pos ?? { x: 0, y: 0 });
  useEffect(() => {
    if (!pos || !menuRef.current) {
      setAdjustedPos(pos ?? { x: 0, y: 0 });
      return;
    }
    const menu = menuRef.current;
    const rect = menu.getBoundingClientRect();
    let { x, y } = pos;
    if (x + rect.width > window.innerWidth) x = window.innerWidth - rect.width - 8;
    if (y + rect.height > window.innerHeight) y = window.innerHeight - rect.height - 8;
    setAdjustedPos({ x, y });
  }, [pos]);

  // Close on outside click or Escape
  useEffect(() => {
    if (!node) return;

    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null, null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null, null);
    };

    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [node, setContextMenu]);

  const close = () => setContextMenu(null, null);

  const invalidateFiles = () => {
    queryClient.invalidateQueries({ queryKey: ['files'] });
  };

  const handlePreview = () => {
    if (!node) return;
    setPreview(node);
    close();
  };

  const handleDownload = async () => {
    if (!node) return;
    const savedNode = node;
    close();
    try {
      // Pre-fix: this branch read `res?.downloadUrl` / `res?.url`, but the
      // backend returns `{ chunks: [{url, iv}], key, node }` (see
      // files.service.getDownloadInfo). Both fallbacks were undefined →
      // toast "获取下载链接失败" every time = "下载按钮没用".
      // Now mirror PreviewModal.handleDownload: decrypt DEK with session
      // MEK, then stream each chunk through streamingDownload helper to
      // showSaveFilePicker (or Blob fallback). Folder downloads still
      // unsupported server-side; bail with a clear toast.
      if (savedNode.type !== 'file') {
        toast.error('文件夹下载暂不支持，请逐个下载内部文件');
        return;
      }
      const info = await filesApi.getDownloadInfo(savedNode.id) as unknown as DownloadInfo;
      const mimeType = info.node.mimeType ?? 'application/octet-stream';
      const mek = getSessionMEK();
      if (!info.key || !mek || !mekDerived) {
        const directUrl = (info as any).downloadUrl ?? (info as any).url;
        if (directUrl) { window.open(directUrl, '_blank'); return; }
        toast.error('会话密钥已失效，请退出后重新登录');
        return;
      }
      const dek = await decryptDEK(info.key.encryptedDek, info.key.iv, mek);
      let warned = false;
      await streamingDownload(
        {
          count: info.chunks.length,
          fetchChunk: async (i) => {
            const chunk = info.chunks[i];
            if (!chunk.iv) throw new Error(`分片 ${i} 缺少 IV，可能是历史损坏文件`);
            const r = await fetch(chunk.url);
            if (!r.ok) throw new Error(`下载分片 ${i} 失败`);
            const encrypted = await r.arrayBuffer();
            const plain = await decryptBuffer(encrypted, dek, chunk.iv);
            return new Uint8Array(plain);
          },
        },
        {
          filename: savedNode.name,
          mimeType,
          totalSize: info.node.size,
          onLargeFileFallback: () => {
            if (!warned) {
              warned = true;
              toast('当前浏览器将在内存中缓冲完整文件，大文件可能较慢。');
            }
          },
        },
      );
      toast.success('下载完成');
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      if (err instanceof BlobFallbackTooLargeError) {
        toast.error(err.message);
        return;
      }
      toast.error('下载失败');
    }
  };

  const handleStar = async () => {
    if (!node) return;
    const wasStarred = node.isStarred;
    close();
    try {
      await filesApi.star(node.id);
      invalidateFiles();
      queryClient.invalidateQueries({ queryKey: ['starred'] });
      toast.success(wasStarred ? '已取消收藏' : '已收藏');
    } catch {
      // handled
    }
  };

  const handleDelete = async () => {
    const ids = effectiveIds.slice();
    close();
    try {
      await filesApi.delete(ids);
      invalidateFiles();
      clearSelection();
      toast.success(`已删除 ${ids.length} 个项目`);
    } catch {
      // handled
    }
  };

  const handleMovePrivate = async () => {
    const ids = effectiveIds.slice();
    close();
    try {
      await filesApi.moveToPrivate(ids, !isPrivate);
      invalidateFiles();
      clearSelection();
      toast.success(isPrivate ? '已移出隐私空间' : '已移入隐私空间');
    } catch {
      // handled
    }
  };

  const openDialog = (type: DialogType) => {
    // Capture current node/ids BEFORE close() clears contextMenuNode from store.
    // React 18 batches setContextMenu(null) + setDialog(type) into one render,
    // which would cause node=null to trigger early return before dialogs render.
    if (!node) return;
    setDialogNode(node);
    setDialogIds(effectiveIds.slice());
    setDialog(type);
    close();
  };

  const closeDialog = () => {
    setDialog(null);
    setDialogNode(null);
    setDialogIds([]);
  };

  const Item = ({
    icon,
    label,
    onClick,
    danger = false,
    disabled = false,
  }: {
    icon: React.ReactNode;
    label: string;
    onClick: () => void;
    danger?: boolean;
    disabled?: boolean;
  }) => (
    <button
      className={`w-full flex items-center gap-3 px-4 py-2 text-sm transition-colors text-left ${
        disabled
          ? 'opacity-40 cursor-not-allowed text-gray-500 dark:text-gray-400'
          : danger
          ? 'text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30'
          : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
      }`}
      onClick={disabled ? undefined : onClick}
    >
      {icon}
      {label}
    </button>
  );

  const Divider = () => <div className="my-1 border-t border-gray-100 dark:border-gray-700" />;

  const isSingle = effectiveIds.length === 1;
  const isFile = node?.type === 'file';
  const dialogIsSingle = dialogIds.length === 1;

  return (
    <>
      {/* Context menu dropdown — only when node+pos are set */}
      {node && pos && (
        <div
          ref={menuRef}
          className="fixed z-50 min-w-[180px] bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 py-1 overflow-hidden"
          style={{ left: adjustedPos.x, top: adjustedPos.y }}
          onContextMenu={(e) => e.preventDefault()}
        >
          {/* Node info */}
          <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-700">
            <p className="text-xs font-medium text-gray-800 dark:text-gray-100 truncate max-w-[200px]">{node.name}</p>
            {isFile && (
              <p className="text-xs text-gray-400 mt-0.5 dark:text-gray-500">{formatBytes(node.size)}</p>
            )}
          </div>

          {/* Preview / Open */}
          {isSingle && isFile && (
            <Item icon={<Eye className="w-4 h-4" />} label="预览" onClick={handlePreview} />
          )}

          {/* Download */}
          {isSingle && isFile && (
            <Item icon={<Download className="w-4 h-4" />} label="下载" onClick={handleDownload} />
          )}

          {(isSingle && isFile) && <Divider />}

          {/* Rename */}
          {isSingle && (
            <Item
              icon={<Edit className="w-4 h-4" />}
              label="重命名"
              onClick={() => openDialog('rename')}
            />
          )}

          {/* Move */}
          <Item
            icon={<FolderInput className="w-4 h-4" />}
            label="移动到"
            onClick={() => openDialog('move')}
          />

          {/* Copy */}
          <Item
            icon={<Copy className="w-4 h-4" />}
            label="复制到"
            onClick={() => openDialog('copy')}
          />

          <Divider />

          {/* Star */}
          {isSingle && (
            <Item
              icon={<Star className="w-4 h-4" />}
              label={node.isStarred ? '取消收藏' : '收藏'}
              onClick={handleStar}
            />
          )}

          {/* Lock / Unlock */}
          {isSingle && (
            <Item
              icon={node.isLocked ? <Unlock className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
              label={node.isLocked ? '解除锁定' : '加密锁定'}
              onClick={() => openDialog('lock')}
            />
          )}

          {/* Share */}
          {isSingle && (
            <Item
              icon={<Share2 className="w-4 h-4" />}
              label="分享"
              onClick={() => openDialog('share')}
            />
          )}

          <Divider />

          {/* Move to/from private */}
          <Item
            icon={isPrivate ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
            label={isPrivate ? '移出隐私空间' : '移入隐私空间'}
            onClick={handleMovePrivate}
          />

          <Divider />

          {/* Delete */}
          <Item
            icon={<Trash2 className="w-4 h-4" />}
            label={`删除${effectiveIds.length > 1 ? ` (${effectiveIds.length})` : ''}`}
            onClick={handleDelete}
            danger
          />
        </div>
      )}

      {/* Dialogs — rendered outside the node/pos guard using captured dialogNode/dialogIds */}
      {dialog === 'rename' && dialogNode && dialogIsSingle && (
        <RenameDialog
          node={dialogNode}
          onClose={closeDialog}
          onSuccess={() => { closeDialog(); invalidateFiles(); }}
        />
      )}
      {(dialog === 'move' || dialog === 'copy') && (
        <MoveDialog
          nodeIds={dialogIds}
          mode={dialog}
          onClose={closeDialog}
          onSuccess={() => { closeDialog(); invalidateFiles(); clearSelection(); }}
        />
      )}
      {dialog === 'share' && dialogNode && dialogIsSingle && (
        <ShareDialog
          node={dialogNode}
          onClose={closeDialog}
        />
      )}
      {dialog === 'lock' && dialogNode && dialogIsSingle && (
        <LockDialog
          node={dialogNode}
          onClose={closeDialog}
          onSuccess={() => { closeDialog(); invalidateFiles(); }}
        />
      )}
    </>
  );
}
