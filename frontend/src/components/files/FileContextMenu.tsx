import { useEffect, useRef, useState } from 'react';
import {
  Eye, Download, Edit, FolderInput, Copy, Star, Lock, Unlock,
  Share2, EyeOff, Trash2, FolderDown, Loader2, Clock, Upload, Tag as TagIcon,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import JSZip from 'jszip';

import { filesApi } from '../../api/client';
import { useFileStore } from '../../stores/file.store';
import { useAuthStore } from '../../stores/auth.store';
import { Node, DownloadInfo } from '../../types';
import { formatBytes, getSessionMEK, decryptDEK, decryptBuffer } from '../../utils/crypto';
import { streamingDownload, BlobFallbackTooLargeError } from '../../utils/streaming-download';
import { t } from '../../i18n/translations';
import RenameDialog from '../dialogs/RenameDialog';
import MoveDialog from '../dialogs/MoveDialog';
import ShareDialog from '../dialogs/ShareDialog';
import LockDialog from '../dialogs/LockDialog';
import VersionDialog from '../dialogs/VersionDialog';
import FileRequestDialog from '../dialogs/FileRequestDialog';
import TagDialog from '../dialogs/TagDialog';

type DialogType = 'rename' | 'move' | 'copy' | 'share' | 'lock' | 'version' | 'file-request' | 'tag' | null;

export default function FileContextMenu() {
  const queryClient = useQueryClient();
  const { mekDerived } = useAuthStore();
  const {
    contextMenuNode: node, contextMenuPos: pos, selectedIds, isPrivate,
    setContextMenu, clearSelection, setPreview,
  } = useFileStore();

  const menuRef = useRef<HTMLDivElement>(null);
  const [dialog, setDialog] = useState<DialogType>(null);
  const [dialogNode, setDialogNode] = useState<Node | null>(null);
  const [dialogIds, setDialogIds] = useState<string[]>([]);
  const [downloadingFolder, setDownloadingFolder] = useState(false);

  const effectiveIds = node
    ? selectedIds.has(node.id) ? Array.from(selectedIds) : [node.id]
    : [];

  const [adjustedPos, setAdjustedPos] = useState(pos ?? { x: 0, y: 0 });
  useEffect(() => {
    if (!pos || !menuRef.current) { setAdjustedPos(pos ?? { x: 0, y: 0 }); return; }
    const menu = menuRef.current;
    const rect = menu.getBoundingClientRect();
    let { x, y } = pos;
    if (x + rect.width > window.innerWidth) x = window.innerWidth - rect.width - 8;
    if (y + rect.height > window.innerHeight) y = window.innerHeight - rect.height - 8;
    setAdjustedPos({ x, y });
  }, [pos]);

  useEffect(() => {
    if (!node) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as HTMLElement)) setContextMenu(null, null);
    };
    const handleKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') setContextMenu(null, null); };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [node, setContextMenu]);

  const close = () => setContextMenu(null, null);
  const invalidateFiles = () => { queryClient.invalidateQueries({ queryKey: ['files'] }); };

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
      if (savedNode.type !== 'file') {
        toast.error(t('ctxmenu.folderDownloadUnsupported'));
        return;
      }
      const info = await filesApi.getDownloadInfo(savedNode.id) as unknown as DownloadInfo;
      const mimeType = info.node.mimeType ?? 'application/octet-stream';
      const mek = getSessionMEK();
      if (!info.key || !mek || !mekDerived) {
        const directUrl = (info as any).downloadUrl ?? (info as any).url;
        if (directUrl) { window.open(directUrl, '_blank'); return; }
        toast.error(t('ctxmenu.sessionExpired'));
        return;
      }
      const dek = await decryptDEK(info.key.encryptedDek, info.key.iv, mek);
      let warned = false;
      await streamingDownload(
        {
          count: info.chunks.length,
          fetchChunk: async (i) => {
            const chunk = info.chunks[i];
            if (!chunk.iv) throw new Error(t('ctxmenu.chunkNoIV', { i }));
            const r = await fetch(chunk.url);
            if (!r.ok) throw new Error(t('ctxmenu.chunkDownloadFail', { i }));
            const encrypted = await r.arrayBuffer();
            const plain = await decryptBuffer(encrypted, dek, chunk.iv);
            return new Uint8Array(plain);
          },
        },
        {
          filename: savedNode.name, mimeType, totalSize: info.node.size,
          onLargeFileFallback: () => { if (!warned) { warned = true; toast(t('ctxmenu.blobFallbackWarn')); } },
        },
      );
      toast.success(t('download.done'));
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      if (err instanceof BlobFallbackTooLargeError) { toast.error(err.message); return; }
      toast.error(t('download.fail'));
    }
  };

  const handleDownloadFolder = async () => {
    if (!node || node.type !== 'folder') return;
    const savedNode = node;
    close();
    setDownloadingFolder(true);
    try {
      const mek = getSessionMEK();
      if (!mek || !mekDerived) { toast.error(t('ctxmenu.sessionExpired')); return; }
      const downloadList = await filesApi.getFolderDownloadList(savedNode.id) as any;
      if (!downloadList?.files?.length) { toast.error(t('ctxmenu.folderEmpty')); return; }
      const MAX_FOLDER_BYTES = 500 * 1024 * 1024;
      const totalSize = (downloadList.files as any[]).reduce((s: number, f: any) => s + Number(f.size || 0), 0);
      if (totalSize > MAX_FOLDER_BYTES) {
        toast.error(t('ctxmenu.folderTooLarge', { size: (totalSize / 1024 / 1024).toFixed(0) }));
        return;
      }
      const zip = new JSZip();
      let completed = 0, skipped = 0;
      for (const file of downloadList.files) {
        if (!file.key) { skipped++; continue; }
        const fileDek = await decryptDEK(file.key.encryptedDek, file.key.iv, mek);
        const chunks: ArrayBuffer[] = [];
        for (let i = 0; i < file.chunks.length; i++) {
          const chunk = file.chunks[i];
          if (!chunk.iv) continue;
          const res = await fetch(chunk.url);
          if (!res.ok) throw new Error(`Download chunk failed: ${file.name}`);
          const encrypted = await res.arrayBuffer();
          const plain = await decryptBuffer(encrypted, fileDek, chunk.iv);
          chunks.push(plain);
        }
        const totalLen = chunks.reduce((s, c) => s + c.byteLength, 0);
        const merged = new Uint8Array(totalLen);
        let offset = 0;
        for (const c of chunks) { merged.set(new Uint8Array(c), offset); offset += c.byteLength; }
        const zipPath = file.relPath.startsWith(savedNode.name + '/')
          ? file.relPath.slice(savedNode.name.length + 1) : file.relPath;
        zip.file(zipPath, merged);
        completed++;
      }
      const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url; a.download = `${savedNode.name}.zip`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      toast.success(t('ctxmenu.downloadPackaged', { n: completed }) + (skipped ? t('ctxmenu.downloadSkipped', { n: skipped }) : ''));
    } catch (err: any) {
      toast.error(err?.message ?? t('ctxmenu.downloadFolderFail'));
    } finally { setDownloadingFolder(false); }
  };

  const handleStar = async () => {
    if (!node) return;
    const wasStarred = node.isStarred;
    close();
    try {
      await filesApi.star(node.id);
      invalidateFiles();
      queryClient.invalidateQueries({ queryKey: ['starred'] });
      toast.success(wasStarred ? t('ctxmenu.unstarSuccess') : t('ctxmenu.starSuccess'));
    } catch { /* handled */ }
  };

  const handleDelete = async () => {
    const ids = effectiveIds.slice();
    close();
    try {
      await filesApi.delete(ids);
      invalidateFiles(); clearSelection();
      toast.success(t('ctxmenu.deletedN', { n: ids.length }));
    } catch { /* handled */ }
  };

  const handleMovePrivate = async () => {
    const ids = effectiveIds.slice();
    close();
    try {
      await filesApi.moveToPrivate(ids, !isPrivate);
      invalidateFiles(); clearSelection();
      toast.success(isPrivate ? t('ctxmenu.movedFromPrivate') : t('ctxmenu.movedToPrivate'));
    } catch { /* handled */ }
  };

  const openDialog = (type: DialogType) => {
    if (!node) return;
    setDialogNode(node);
    setDialogIds(effectiveIds.slice());
    setDialog(type);
    close();
  };

  const closeDialog = () => { setDialog(null); setDialogNode(null); setDialogIds([]); };

  const Item = ({ icon, label, onClick, danger = false, disabled = false }: {
    icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean; disabled?: boolean;
  }) => (
    <button
      className={`w-full flex items-center gap-3 px-4 py-2 text-sm transition-colors text-left ${
        disabled ? 'opacity-40 cursor-not-allowed text-gray-500 dark:text-gray-400'
        : danger ? 'text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30'
        : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
      }`}
      onClick={disabled ? undefined : onClick}
    >{icon}{label}</button>
  );

  const Divider = () => <div className="my-1 border-t border-gray-100 dark:border-gray-700" />;

  const isSingle = effectiveIds.length === 1;
  const isFile = node?.type === 'file';
  const dialogIsSingle = dialogIds.length === 1;

  return (
    <>
      {node && pos && (
        <div ref={menuRef}
          className="fixed z-50 min-w-[180px] bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 py-1 overflow-hidden"
          style={{ left: adjustedPos.x, top: adjustedPos.y }}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-700">
            <p className="text-xs font-medium text-gray-800 dark:text-gray-100 truncate max-w-[200px]">{node.name}</p>
            {isFile && <p className="text-xs text-gray-400 mt-0.5 dark:text-gray-500">{formatBytes(node.size)}</p>}
          </div>

          {isSingle && isFile && <Item icon={<Eye className="w-4 h-4" />} label={t('ctxmenu.preview')} onClick={handlePreview} />}
          {isSingle && isFile && <Item icon={<Download className="w-4 h-4" />} label={t('ctxmenu.download')} onClick={handleDownload} />}
          {isSingle && !isFile && (
            <Item icon={downloadingFolder ? <Loader2 className="w-4 h-4 animate-spin" /> : <FolderDown className="w-4 h-4" />}
              label={downloadingFolder ? t('ctxmenu.packaging') : t('ctxmenu.downloadFolder')}
              onClick={handleDownloadFolder} disabled={downloadingFolder} />
          )}
          {(isSingle && isFile || isSingle && !isFile) && <Divider />}

          {isSingle && <Item icon={<Edit className="w-4 h-4" />} label={t('toolbar.rename')} onClick={() => openDialog('rename')} />}
          <Item icon={<FolderInput className="w-4 h-4" />} label={t('toolbar.move')} onClick={() => openDialog('move')} />
          <Item icon={<Copy className="w-4 h-4" />} label={t('toolbar.copy')} onClick={() => openDialog('copy')} />
          <Divider />

          {isSingle && <Item icon={<Star className="w-4 h-4" />} label={node.isStarred ? t('toolbar.unstar') : t('toolbar.star')} onClick={handleStar} />}
          {isSingle && <Item icon={node.isLocked ? <Unlock className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
            label={node.isLocked ? t('toolbar.unlock') : t('toolbar.lock')} onClick={() => openDialog('lock')} />}
          {isSingle && <Item icon={<TagIcon className="w-4 h-4" />} label={t('ctxmenu.tag')} onClick={() => openDialog('tag')} />}
          {isSingle && isFile && <Item icon={<Clock className="w-4 h-4" />} label={t('ctxmenu.versions')} onClick={() => openDialog('version')} />}
          {isSingle && <Item icon={<Share2 className="w-4 h-4" />} label={t('toolbar.share')} onClick={() => openDialog('share')} />}
          {isSingle && !isFile && <Item icon={<Upload className="w-4 h-4" />} label={t('ctxmenu.fileRequest')} onClick={() => openDialog('file-request')} />}

          <Divider />
          <Item icon={isPrivate ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
            label={isPrivate ? t('toolbar.fromPrivate') : t('toolbar.toPrivate')} onClick={handleMovePrivate} />
          <Divider />

          <Item icon={<Trash2 className="w-4 h-4" />}
            label={effectiveIds.length > 1 ? `${t('toolbar.delete')} (${effectiveIds.length})` : t('toolbar.delete')}
            onClick={handleDelete} danger />
        </div>
      )}

      {dialog === 'rename' && dialogNode && dialogIsSingle && (
        <RenameDialog node={dialogNode} onClose={closeDialog} onSuccess={() => { closeDialog(); invalidateFiles(); }} />
      )}
      {(dialog === 'move' || dialog === 'copy') && (
        <MoveDialog nodeIds={dialogIds} mode={dialog} onClose={closeDialog} onSuccess={() => { closeDialog(); invalidateFiles(); clearSelection(); }} />
      )}
      {dialog === 'share' && dialogNode && dialogIsSingle && <ShareDialog node={dialogNode} onClose={closeDialog} />}
      {dialog === 'lock' && dialogNode && dialogIsSingle && <LockDialog node={dialogNode} onClose={closeDialog} onSuccess={() => { closeDialog(); invalidateFiles(); }} />}
      {dialog === 'version' && dialogNode && dialogIsSingle && <VersionDialog node={dialogNode} onClose={closeDialog} />}
      {dialog === 'file-request' && dialogNode && dialogIsSingle && <FileRequestDialog node={dialogNode} onClose={closeDialog} />}
      {dialog === 'tag' && dialogNode && dialogIsSingle && (
        <TagDialog node={dialogNode} onClose={closeDialog} onSuccess={() => queryClient.invalidateQueries({ queryKey: ['files'] })} />
      )}
    </>
  );
}
