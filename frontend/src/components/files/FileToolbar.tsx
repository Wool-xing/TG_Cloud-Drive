import { useState } from 'react';
import {
  FolderPlus,
  Trash2,
  FolderInput,
  Copy,
  Download,
  X,
  Edit,
  Star,
  Lock,
  Unlock,
  Share2,
  Eye,
  EyeOff,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';

import { filesApi } from '../../api/client';
import { useFileStore } from '../../stores/file.store';
import { useAuthStore } from '../../stores/auth.store';
import { Node, DownloadInfo } from '../../types';
import {
  getSessionMEK,
  decryptDEK,
  decryptBuffer,
} from '../../utils/crypto';
import {
  streamingDownload,
  BlobFallbackTooLargeError,
} from '../../utils/streaming-download';
import MoveDialog from '../dialogs/MoveDialog';
import RenameDialog from '../dialogs/RenameDialog';
import ShareDialog from '../dialogs/ShareDialog';
import LockDialog from '../dialogs/LockDialog';

interface FileToolbarProps {
  nodes: Node[];
  isLoading: boolean;
}

type DialogType = 'move' | 'copy' | 'rename' | 'share' | 'lock' | null;

export default function FileToolbar({ nodes, isLoading }: FileToolbarProps) {
  const queryClient = useQueryClient();
  const { mekDerived } = useAuthStore();
  const {
    selectedIds,
    currentParentId,
    isPrivate,
    clearSelection,
  } = useFileStore();

  const [newFolderMode, setNewFolderMode] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [dialog, setDialog] = useState<DialogType>(null);

  const selectedCount = selectedIds.size;
  const selectedArray = Array.from(selectedIds);

  const invalidateFiles = () => {
    queryClient.invalidateQueries({ queryKey: ['files'] });
  };

  const handleNewFolderKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setNewFolderMode(false);
      setNewFolderName('');
      return;
    }
    if (e.key === 'Enter') await submitNewFolder();
  };

  const submitNewFolder = async () => {
    const name = newFolderName.trim();
    if (!name) { toast.error('文件夹名称不能为空'); return; }
    setCreatingFolder(true);
    try {
      await filesApi.createFolder({ name, parentId: currentParentId, private: isPrivate });
      invalidateFiles();
      toast.success(`文件夹 "${name}" 已创建`);
      setNewFolderMode(false);
      setNewFolderName('');
    } catch {
      // handled by interceptor
    } finally {
      setCreatingFolder(false);
    }
  };

  const handleBatchDelete = async () => {
    if (!selectedArray.length) return;
    try {
      await filesApi.delete(selectedArray);
      invalidateFiles();
      clearSelection();
      toast.success(`已删除 ${selectedArray.length} 个项目`);
    } catch {
      // handled
    }
  };

  const handleBatchDownload = async () => {
    if (!selectedArray.length) return;
    const fileNodes = nodes.filter(n => selectedArray.includes(n.id) && n.type === 'file');
    if (!fileNodes.length) {
      toast.error('请选择文件（不支持直接下载文件夹）');
      return;
    }
    // Pre-fix: this read `res?.downloadUrl ?? res?.url` and bailed silently
    // for every file because the backend returns `{chunks, key, node}`. Now
    // mirror PreviewModal/handleDownload: decrypt + stream each file.
    const mek = getSessionMEK();
    toast.success(`开始下载 ${fileNodes.length} 个文件`);
    for (const node of fileNodes) {
      try {
        const info = await filesApi.getDownloadInfo(node.id) as unknown as DownloadInfo;
        const mimeType = info.node.mimeType ?? 'application/octet-stream';
        if (!info.key || !mek || !mekDerived) {
          // Fallback to direct URL if backend ever returns one (legacy /
          // unencrypted path).
          const directUrl = (info as any).downloadUrl ?? (info as any).url;
          if (directUrl) {
            const a = document.createElement('a');
            a.href = directUrl;
            a.download = node.name;
            a.click();
            await new Promise(r => setTimeout(r, 800));
          }
          continue;
        }
        const dek = await decryptDEK(info.key.encryptedDek, info.key.iv, mek);
        await streamingDownload(
          {
            count: info.chunks.length,
            fetchChunk: async (i) => {
              const chunk = info.chunks[i];
              if (!chunk.iv) throw new Error(`分片 ${i} 缺少 IV`);
              const r = await fetch(chunk.url);
              if (!r.ok) throw new Error(`下载分片 ${i} 失败`);
              const enc = await r.arrayBuffer();
              const plain = await decryptBuffer(enc, dek, chunk.iv);
              return new Uint8Array(plain);
            },
          },
          { filename: node.name, mimeType, totalSize: info.node.size },
        );
        // Brief gap so showSaveFilePicker dialogs don't queue on top of each
        // other (UX: user picks save location for each).
        await new Promise(r => setTimeout(r, 500));
      } catch (err: any) {
        if (err?.name === 'AbortError') return; // user cancelled — stop batch
        if (err instanceof BlobFallbackTooLargeError) {
          toast.error(err.message);
          return;
        }
        toast.error(`下载 ${node.name} 失败`);
      }
    }
  };

  // P1-UX: per-file actions reachable from toolbar without right-click
  // (新手不一定有右键习惯, 之前 toolbar 只 4 件让用户觉得"很多功能没用")
  const singleSelectedNode = selectedCount === 1
    ? nodes.find(n => selectedArray[0] === n.id) ?? null
    : null;

  const handleStar = async () => {
    if (!singleSelectedNode) return;
    const was = singleSelectedNode.isStarred;
    try {
      await filesApi.star(singleSelectedNode.id);
      invalidateFiles();
      queryClient.invalidateQueries({ queryKey: ['starred'] });
      toast.success(was ? '已取消收藏' : '已收藏');
    } catch {
      // handled
    }
  };

  const handleMovePrivate = async () => {
    if (!selectedArray.length) return;
    try {
      await filesApi.moveToPrivate(selectedArray, !isPrivate);
      invalidateFiles();
      clearSelection();
      toast.success(isPrivate ? '已移出隐私空间' : '已移入隐私空间');
    } catch {
      // handled
    }
  };

  const BtnSm = ({
    icon, label, onClick, danger = false,
  }: {
    icon: React.ReactNode;
    label: string;
    onClick: () => void;
    danger?: boolean;
  }) => (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
        danger
          ? 'text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 border border-red-200 dark:border-red-800'
          : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-600'
      }`}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <>
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 flex-shrink-0 flex-wrap gap-2 dark:bg-gray-800">
        {/* Left side */}
        <div className="flex items-center gap-2 flex-wrap">
          {selectedCount > 0 ? (
            <>
              <span className="text-sm font-medium text-blue-600 bg-blue-50 px-2.5 py-1 rounded-full">
                已选 {selectedCount} 项
              </span>
              <button
                onClick={clearSelection}
                className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1 dark:text-gray-400"
              >
                <X className="w-3.5 h-3.5" />
                取消选择
              </button>
              <div className="flex items-center gap-1.5 ml-2 flex-wrap">
                <BtnSm icon={<Trash2 className="w-4 h-4" />} label="删除" onClick={handleBatchDelete} danger />
                <BtnSm icon={<FolderInput className="w-4 h-4" />} label="移动" onClick={() => setDialog('move')} />
                <BtnSm icon={<Copy className="w-4 h-4" />} label="复制" onClick={() => setDialog('copy')} />
                <BtnSm icon={<Download className="w-4 h-4" />} label="下载" onClick={handleBatchDownload} />
                {/* Per-file actions only when exactly 1 selected — backend
                    contracts are single-node (rename / lock / share). */}
                {singleSelectedNode && (
                  <>
                    <BtnSm
                      icon={<Edit className="w-4 h-4" />}
                      label="重命名"
                      onClick={() => setDialog('rename')}
                    />
                    <BtnSm
                      icon={<Star className="w-4 h-4" />}
                      label={singleSelectedNode.isStarred ? '取消收藏' : '收藏'}
                      onClick={handleStar}
                    />
                    {singleSelectedNode.type === 'file' && (
                      <BtnSm
                        icon={<Share2 className="w-4 h-4" />}
                        label="分享"
                        onClick={() => setDialog('share')}
                      />
                    )}
                    <BtnSm
                      icon={singleSelectedNode.isLocked
                        ? <Unlock className="w-4 h-4" />
                        : <Lock className="w-4 h-4" />}
                      label={singleSelectedNode.isLocked ? '解锁' : '加密锁定'}
                      onClick={() => setDialog('lock')}
                    />
                  </>
                )}
                <BtnSm
                  icon={isPrivate ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                  label={isPrivate ? '移出隐私' : '移入隐私'}
                  onClick={handleMovePrivate}
                />
              </div>
            </>
          ) : (
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {isLoading ? '加载中…' : `共 ${nodes.length} 个项目`}
            </span>
          )}
        </div>

        {/* Right side: new folder */}
        <div className="flex items-center gap-2">
          {newFolderMode ? (
            <div className="flex items-center gap-1.5">
              <input
                autoFocus
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={handleNewFolderKeyDown}
                onBlur={() => {
                  if (newFolderName.trim()) submitNewFolder();
                  else { setNewFolderMode(false); setNewFolderName(''); }
                }}
                placeholder="文件夹名称"
                maxLength={500}
                className="border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-44 dark:text-gray-100"
                disabled={creatingFolder}
              />
              <button
                onClick={submitNewFolder}
                disabled={creatingFolder}
                className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {creatingFolder ? '创建中…' : '确定'}
              </button>
              <button
                onClick={() => { setNewFolderMode(false); setNewFolderName(''); }}
                className="p-1.5 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setNewFolderMode(true)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors dark:text-gray-300 dark:border-gray-700 dark:hover:bg-gray-700/50"
            >
              <FolderPlus className="w-4 h-4" />
              新建文件夹
            </button>
          )}
        </div>
      </div>

      {(dialog === 'move' || dialog === 'copy') && (
        <MoveDialog
          nodeIds={selectedArray}
          mode={dialog}
          onClose={() => setDialog(null)}
          onSuccess={() => { setDialog(null); invalidateFiles(); clearSelection(); }}
        />
      )}
      {dialog === 'rename' && singleSelectedNode && (
        <RenameDialog
          node={singleSelectedNode}
          onClose={() => setDialog(null)}
          onSuccess={() => { setDialog(null); invalidateFiles(); }}
        />
      )}
      {dialog === 'share' && singleSelectedNode && singleSelectedNode.type === 'file' && (
        <ShareDialog
          node={singleSelectedNode}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'lock' && singleSelectedNode && (
        <LockDialog
          node={singleSelectedNode}
          onClose={() => setDialog(null)}
          onSuccess={() => { setDialog(null); invalidateFiles(); }}
        />
      )}
    </>
  );
}
