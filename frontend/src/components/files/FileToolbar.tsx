import { useState, useRef, useEffect } from 'react';
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
  Loader2,
  FileText,
  File,
  ChevronDown,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import JSZip from 'jszip';

import { filesApi } from '../../api/client';
import { useFileStore } from '../../stores/file.store';
import { useAuthStore } from '../../stores/auth.store';
import { useI18n } from '../../i18n/context';
import { Node, DownloadInfo } from '../../types';
import {
  getSessionMEK,
  decryptDEK,
  decryptBuffer,
} from '../../utils/crypto';
import MoveDialog from '../dialogs/MoveDialog';
import RenameDialog from '../dialogs/RenameDialog';
import ShareDialog from '../dialogs/ShareDialog';
import LockDialog from '../dialogs/LockDialog';
import TemplatePicker from '../dialogs/TemplatePicker';

interface FileToolbarProps {
  nodes: Node[];
  isLoading: boolean;
}

type DialogType = 'move' | 'copy' | 'rename' | 'share' | 'lock' | null;

export default function FileToolbar({ nodes, isLoading }: FileToolbarProps) {
  const queryClient = useQueryClient();
  const { t } = useI18n();
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
  const [createMode, setCreateMode] = useState<'folder' | 'document'>('folder');
  const [createMime, setCreateMime] = useState('');
  const [createExt, setCreateExt] = useState('');
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const newMenuRef = useRef<HTMLDivElement>(null);
  const [dialog, setDialog] = useState<DialogType>(null);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (newMenuRef.current && !newMenuRef.current.contains(e.target as HTMLElement)) setNewMenuOpen(false);
    };
    if (newMenuOpen) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [newMenuOpen]);

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
    if (e.key === 'Enter') await submitNewItem();
  };

  const submitNewItem = async () => {
    const name = newFolderName.trim();
    if (!name) { toast.error(t('toolbar.nameEmpty')); return; }
    setCreatingFolder(true);
    try {
      if (createMode === 'folder') {
        await filesApi.createFolder({ name, parentId: currentParentId, private: isPrivate });
        toast.success(t('toolbar.createdFolder', { name }));
      } else {
        const finalName = name.endsWith(createExt) ? name : name + createExt;
        await filesApi.createDocument({ name: finalName, parentId: currentParentId, mimeType: createMime, private: isPrivate });
        toast.success(t('toolbar.createdFile', { name: finalName }));
      }
      invalidateFiles();
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
      toast.success(t('delete.done', { n: selectedArray.length }));
    } catch {
      // handled
    }
  };

  const [batchDownloading, setBatchDownloading] = useState(false);

  const handleBatchDownload = async () => {
    if (!selectedArray.length) return;
    const fileNodes = nodes.filter(n => selectedArray.includes(n.id) && n.type === 'file');
    if (!fileNodes.length) {
      toast.error('请选择文件（不支持直接下载文件夹）');
      return;
    }
    // Memory safety: refuse batch downloads > 500MB to avoid OOM
    const MAX_BATCH_BYTES = 500 * 1024 * 1024;
    const totalSize = fileNodes.reduce((s, n) => s + Number(n.size), 0);
    if (totalSize > MAX_BATCH_BYTES) {
      toast.error(`所选文件总大小 ${(totalSize / 1024 / 1024).toFixed(0)}MB 超过 500MB 限制，请分批下载`);
      return;
    }
    const mek = getSessionMEK();
    if (!mek || !mekDerived) {
      toast.error('会话密钥已失效，请退出后重新登录');
      return;
    }
    setBatchDownloading(true);
    try {
      const zip = new JSZip();
      let completed = 0;
      for (const node of fileNodes) {
        try {
          const info = await filesApi.getDownloadInfo(node.id) as unknown as DownloadInfo;
          if (!info.key) continue;
          const dek = await decryptDEK(info.key.encryptedDek, info.key.iv, mek);
          const chunks: ArrayBuffer[] = [];
          for (let i = 0; i < info.chunks.length; i++) {
            const c = info.chunks[i];
            if (!c.iv) continue;
            const r = await fetch(c.url);
            if (!r.ok) throw new Error(`下载分片失败: ${node.name}`);
            const encrypted = await r.arrayBuffer();
            chunks.push(await decryptBuffer(encrypted, dek, c.iv));
          }
          const totalLen = chunks.reduce((s, c) => s + c.byteLength, 0);
          const merged = new Uint8Array(totalLen);
          let offset = 0;
          for (const c of chunks) { merged.set(new Uint8Array(c), offset); offset += c.byteLength; }
          zip.file(node.name, merged);
          completed++;
        } catch {
          toast.error(`打包 ${node.name} 失败`);
        }
      }
      if (completed === 0) { toast.error('没有可下载的文件'); return; }
      const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `files_${completed}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      toast.success(`已打包下载 ${completed} 个文件`);
    } finally {
      setBatchDownloading(false);
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
      toast.success(was ? t('toolbar.unstar') : t('toolbar.star'));
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
      toast.success(isPrivate ? t('toolbar.fromPrivate') : t('toolbar.toPrivate'));
    } catch {
      // handled
    }
  };

  const NEW_ITEMS = [
    { labelKey: 'new.folder', icon: <FolderPlus className="w-4 h-4" />, mode: 'folder' as const, ext: '', mime: '' },
    { labelKey: 'new.text', icon: <FileText className="w-4 h-4" />, mode: 'document' as const, ext: '.txt', mime: 'text/plain' },
    { labelKey: 'new.markdown', icon: <FileText className="w-4 h-4" />, mode: 'document' as const, ext: '.md', mime: 'text/markdown' },
    { labelKey: 'new.word', icon: <File className="w-4 h-4 text-blue-500" />, mode: 'document' as const, ext: '.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    { labelKey: 'new.excel', icon: <File className="w-4 h-4 text-green-500" />, mode: 'document' as const, ext: '.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    { labelKey: 'new.ppt', icon: <File className="w-4 h-4 text-orange-500" />, mode: 'document' as const, ext: '.pptx', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
  ];

  const NewDropdown = () => (
    <div ref={newMenuRef} className="relative">
      <button
        onClick={() => setNewMenuOpen(v => !v)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors"
      >
        <FolderPlus className="w-4 h-4" />
        {t('toolbar.new')}
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${newMenuOpen ? 'rotate-180' : ''}`} />
      </button>
      {newMenuOpen && (
        <div className="absolute right-0 top-full mt-1 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 py-1 z-50 min-w-[150px]">
          {NEW_ITEMS.map(item => (
            <button
              key={item.labelKey}
              onClick={() => {
                setCreateMode(item.mode);
                setCreateMime(item.mime);
                setCreateExt(item.ext);
                setNewFolderMode(true);
                setNewMenuOpen(false);
                if (item.mode === 'folder') {
                  setNewFolderName(t('toolbar.createFolder'));
                } else {
                  setNewFolderName(t('toolbar.createFile', { ext: item.ext }));
                }
              }}
              className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-left"
            >
              {item.icon}
              {t(item.labelKey)}
            </button>
          ))}
          <div className="border-t border-gray-100 dark:border-gray-700 my-1" />
          <button
            onClick={() => {
              setNewMenuOpen(false);
              setShowTemplatePicker(true);
            }}
            className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-left"
          >
            <FileText className="w-4 h-4 text-purple-500" />
            {t('toolbar.template')}
          </button>
        </div>
      )}
    </div>
  );

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
                {t('toolbar.selected', { n: selectedCount })}
              </span>
              <button
                onClick={clearSelection}
                className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1 dark:text-gray-400"
              >
                <X className="w-3.5 h-3.5" />
                {t('toolbar.deselect')}
              </button>
              <div className="flex items-center gap-1.5 ml-2 flex-wrap">
                <BtnSm icon={<Trash2 className="w-4 h-4" />} label={t('toolbar.delete')} onClick={handleBatchDelete} danger />
                <BtnSm icon={<FolderInput className="w-4 h-4" />} label={t('toolbar.move')} onClick={() => setDialog('move')} />
                <BtnSm icon={<Copy className="w-4 h-4" />} label={t('toolbar.copy')} onClick={() => setDialog('copy')} />
                <BtnSm
                  icon={batchDownloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                  label={batchDownloading ? t('ctxmenu.packaging') : t('toolbar.download')}
                  onClick={handleBatchDownload}
                />
                {/* Per-file actions only when exactly 1 selected — backend
                    contracts are single-node (rename / lock / share). */}
                {singleSelectedNode && (
                  <>
                    <BtnSm
                      icon={<Edit className="w-4 h-4" />}
                      label={t('toolbar.rename')}
                      onClick={() => setDialog('rename')}
                    />
                    <BtnSm
                      icon={<Star className="w-4 h-4" />}
                      label={singleSelectedNode.isStarred ? t('toolbar.unstar') : t('toolbar.star')}
                      onClick={handleStar}
                    />
                    {singleSelectedNode.type === 'file' && (
                      <BtnSm
                        icon={<Share2 className="w-4 h-4" />}
                        label={t('toolbar.share')}
                        onClick={() => setDialog('share')}
                      />
                    )}
                    <BtnSm
                      icon={singleSelectedNode.isLocked
                        ? <Unlock className="w-4 h-4" />
                        : <Lock className="w-4 h-4" />}
                      label={singleSelectedNode.isLocked ? t('toolbar.unlock') : t('toolbar.lock')}
                      onClick={() => setDialog('lock')}
                    />
                  </>
                )}
                <BtnSm
                  icon={isPrivate ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                  label={isPrivate ? t('toolbar.fromPrivate') : t('toolbar.toPrivate')}
                  onClick={handleMovePrivate}
                />
              </div>
            </>
          ) : (
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {isLoading ? t('toolbar.loading') : t('toolbar.count', { n: nodes.length })}
            </span>
          )}
        </div>

        {/* Right side: new dropdown */}
        <div className="flex items-center gap-2">
          {newFolderMode ? (
            <div className="flex items-center gap-1.5">
              <input
                autoFocus
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={handleNewFolderKeyDown}
                onBlur={() => { setNewFolderMode(false); setNewFolderName(''); }}
                placeholder={createMode === 'folder' ? t('toolbar.folderName') : t('toolbar.fileName')}
                maxLength={500}
                className="border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-44 dark:text-gray-100"
                disabled={creatingFolder}
              />
              <button
                onClick={submitNewItem}
                disabled={creatingFolder}
                className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {creatingFolder ? t('toolbar.creating') : t('toolbar.confirm')}
              </button>
              <button
                onClick={() => { setNewFolderMode(false); setNewFolderName(''); }}
                className="p-1.5 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <NewDropdown />
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

      {showTemplatePicker && (
        <TemplatePicker
          parentId={currentParentId}
          isPrivate={isPrivate}
          onClose={() => setShowTemplatePicker(false)}
          onSuccess={() => invalidateFiles()}
        />
      )}
    </>
  );
}
