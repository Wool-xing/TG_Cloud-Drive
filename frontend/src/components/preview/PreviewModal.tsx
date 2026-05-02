import { useCallback, useEffect, useRef, useState } from 'react';
import {
  X,
  Download,
  ChevronLeft,
  ChevronRight,
  Loader2,
  AlertTriangle,
  File,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { filesApi } from '../../api/client';
import { useFileStore } from '../../stores/file.store';
import { useAuthStore } from '../../stores/auth.store';
import { formatBytes, getSessionMEK, decryptDEK, decryptBuffer } from '../../utils/crypto';
import { Node, DownloadInfo } from '../../types';

interface PreviewModalProps {
  nodes: Node[];
}

type PreviewState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; blobUrl: string; mimeType: string }
  | { status: 'text'; content: string; mimeType: string }
  | { status: 'unencrypted'; downloadUrl: string };

function isPreviewable(mimeType?: string): boolean {
  if (!mimeType) return false;
  return (
    mimeType.startsWith('image/') ||
    mimeType.startsWith('video/') ||
    mimeType.startsWith('audio/') ||
    mimeType === 'application/pdf' ||
    mimeType.startsWith('text/') ||
    mimeType.includes('javascript') ||
    mimeType.includes('json') ||
    mimeType.includes('xml')
  );
}

function isTextMime(mimeType?: string): boolean {
  if (!mimeType) return false;
  return (
    mimeType.startsWith('text/') ||
    mimeType.includes('javascript') ||
    mimeType.includes('typescript') ||
    mimeType.includes('json') ||
    mimeType.includes('xml') ||
    mimeType.includes('yaml') ||
    mimeType.includes('csv')
  );
}

async function fetchAndDecrypt(
  nodeId: string,
  mekDerived: boolean,
  lockPassword?: string,
): Promise<{ blobUrl?: string; textContent?: string; mimeType: string; downloadUrl?: string; downloadInfo: DownloadInfo }> {
  const info = await filesApi.getDownloadInfo(nodeId, lockPassword) as unknown as DownloadInfo;
  const mimeType = info.node.mimeType ?? 'application/octet-stream';
  const mek = getSessionMEK();

  if (!info.key || !mek || !mekDerived) {
    // Not encrypted or MEK not available — return direct download URL if available
    const downloadUrl = (info as any).downloadUrl ?? (info as any).url;
    return { downloadUrl, mimeType, downloadInfo: info };
  }

  // Decrypt DEK
  const dek = await decryptDEK(info.key.encryptedDek, info.key.iv, mek);

  // Download and decrypt each chunk
  const chunks: ArrayBuffer[] = [];
  for (let i = 0; i < info.chunks.length; i++) {
    const chunkUrl = info.chunks[i];
    const res = await fetch(chunkUrl);
    if (!res.ok) throw new Error(`下载分片 ${i} 失败`);
    const encryptedData = await res.arrayBuffer();
    // The iv for each chunk is embedded or derived — for single-chunk files the NodeKey iv is used
    // For multi-chunk files the server must provide per-chunk IVs; here we use the NodeKey iv
    const iv = info.key.iv;
    const decrypted = await decryptBuffer(encryptedData, dek, iv);
    chunks.push(decrypted);
  }

  // Concatenate chunks
  const totalLength = chunks.reduce((s, c) => s + c.byteLength, 0);
  const merged = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(new Uint8Array(chunk), offset);
    offset += chunk.byteLength;
  }

  const blob = new Blob([merged], { type: mimeType });

  if (isTextMime(mimeType) && blob.size < 2 * 1024 * 1024) {
    const textContent = await blob.text();
    return { textContent, mimeType, downloadInfo: info };
  }

  const blobUrl = URL.createObjectURL(blob);
  return { blobUrl, mimeType, downloadInfo: info };
}

export default function PreviewModal({ nodes }: PreviewModalProps) {
  const { previewNode, setPreview } = useFileStore();
  const { mekDerived } = useAuthStore();

  const [previewState, setPreviewState] = useState<PreviewState>({ status: 'loading' });
  const [lockPassword, setLockPassword] = useState('');
  const [needsLockPassword, setNeedsLockPassword] = useState(false);
  const [downloadInfo, setDownloadInfo] = useState<DownloadInfo | null>(null);

  const blobUrlRef = useRef<string | null>(null);

  const currentIndex = nodes.findIndex((n) => n.id === previewNode?.id);
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < nodes.length - 1 && currentIndex !== -1;

  const revokeBlobUrl = () => {
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
  };

  const loadPreview = useCallback(
    async (node: Node, password?: string) => {
      if (!node || node.type === 'folder') return;
      revokeBlobUrl();
      setPreviewState({ status: 'loading' });
      setNeedsLockPassword(false);

      try {
        const result = await fetchAndDecrypt(node.id, mekDerived, password);
        setDownloadInfo(result.downloadInfo);

        if (result.downloadUrl && !result.blobUrl && !result.textContent) {
          setPreviewState({ status: 'unencrypted', downloadUrl: result.downloadUrl });
          return;
        }

        if (result.textContent !== undefined) {
          setPreviewState({ status: 'text', content: result.textContent, mimeType: result.mimeType });
        } else if (result.blobUrl) {
          blobUrlRef.current = result.blobUrl;
          setPreviewState({ status: 'ready', blobUrl: result.blobUrl, mimeType: result.mimeType });
        } else {
          setPreviewState({ status: 'error', message: '无法预览此文件' });
        }
      } catch (err: any) {
        const msg = err?.response?.data?.message ?? err?.message ?? '加载失败';
        if (msg.includes('lock') || msg.includes('密码') || err?.response?.status === 403) {
          setNeedsLockPassword(true);
          setPreviewState({ status: 'error', message: '此文件已锁定，请输入密码' });
        } else {
          setPreviewState({ status: 'error', message: msg });
        }
      }
    },
    [mekDerived],
  );

  // Load on node change
  useEffect(() => {
    if (previewNode) {
      setLockPassword('');
      loadPreview(previewNode);
    }
    return () => {
      if (!previewNode) revokeBlobUrl();
    };
  }, [previewNode, loadPreview]);

  // Cleanup on unmount
  useEffect(() => {
    return () => revokeBlobUrl();
  }, []);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPreview(null);
      } else if (e.key === 'ArrowLeft' && hasPrev) {
        setPreview(nodes[currentIndex - 1]);
      } else if (e.key === 'ArrowRight' && hasNext) {
        setPreview(nodes[currentIndex + 1]);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [hasPrev, hasNext, currentIndex, nodes, setPreview]);

  if (!previewNode) return null;

  const handleDownload = async () => {
    if (!downloadInfo) return;
    try {
      if (previewState.status === 'ready' && blobUrlRef.current) {
        const a = document.createElement('a');
        a.href = blobUrlRef.current;
        a.download = previewNode.name;
        a.click();
      } else if (previewState.status === 'unencrypted') {
        const a = document.createElement('a');
        a.href = (previewState as any).downloadUrl;
        a.download = previewNode.name;
        a.click();
      } else if (previewState.status === 'text') {
        const blob = new Blob([(previewState as any).content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = previewNode.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      } else {
        // Fallback: reload download info and trigger download
        const info = await filesApi.getDownloadInfo(previewNode.id) as unknown as DownloadInfo;
        const url = (info as any).downloadUrl ?? info.chunks?.[0];
        if (url) {
          window.open(url, '_blank');
        } else {
          toast.error('无法获取下载链接');
        }
      }
    } catch {
      toast.error('下载失败');
    }
  };

  const renderContent = () => {
    switch (previewState.status) {
      case 'loading':
        return (
          <div className="flex flex-col items-center justify-center flex-1 gap-4 text-gray-400">
            <Loader2 className="w-10 h-10 animate-spin text-blue-500" />
            <p className="text-sm">正在加载预览…</p>
          </div>
        );

      case 'error':
        return (
          <div className="flex flex-col items-center justify-center flex-1 gap-4 text-gray-400 px-8">
            <AlertTriangle className="w-10 h-10 text-orange-400" />
            <p className="text-sm text-center">{previewState.message}</p>
            {needsLockPassword && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  loadPreview(previewNode, lockPassword);
                }}
                className="flex flex-col items-center gap-3 w-full max-w-xs"
              >
                <input
                  autoFocus
                  type="password"
                  value={lockPassword}
                  onChange={(e) => setLockPassword(e.target.value)}
                  placeholder="输入文件锁定密码"
                  className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  type="submit"
                  className="px-6 py-2.5 rounded-xl text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 transition-colors"
                >
                  解锁并预览
                </button>
              </form>
            )}
          </div>
        );

      case 'unencrypted':
        return (
          <div className="flex flex-col items-center justify-center flex-1 gap-4 text-gray-400">
            <File className="w-14 h-14 text-gray-300" />
            <p className="text-sm">此文件无加密，可直接下载</p>
            <button
              onClick={handleDownload}
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 transition-colors"
            >
              <Download className="w-4 h-4" />
              下载文件
            </button>
          </div>
        );

      case 'text':
        return (
          <div className="flex-1 overflow-auto p-6">
            <pre className="text-xs font-mono text-gray-700 whitespace-pre-wrap break-words bg-gray-900 text-green-400 rounded-xl p-6 h-full overflow-auto">
              {previewState.content}
            </pre>
          </div>
        );

      case 'ready': {
        const { blobUrl, mimeType } = previewState;
        if (mimeType.startsWith('image/')) {
          return (
            <div className="flex-1 flex items-center justify-center p-4 overflow-hidden">
              <img
                src={blobUrl}
                alt={previewNode.name}
                className="max-w-full max-h-full object-contain rounded-lg shadow-lg"
              />
            </div>
          );
        }
        if (mimeType.startsWith('video/')) {
          return (
            <div className="flex-1 flex items-center justify-center p-4">
              <video
                src={blobUrl}
                controls
                autoPlay
                className="max-w-full max-h-full rounded-lg shadow-lg"
              />
            </div>
          );
        }
        if (mimeType.startsWith('audio/')) {
          return (
            <div className="flex-1 flex flex-col items-center justify-center gap-6 p-8">
              <div className="w-32 h-32 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center shadow-xl">
                <span className="text-4xl">♪</span>
              </div>
              <audio src={blobUrl} controls autoPlay className="w-full max-w-md" />
            </div>
          );
        }
        if (mimeType === 'application/pdf') {
          return (
            <div className="flex-1 overflow-hidden">
              <iframe
                src={blobUrl}
                title={previewNode.name}
                className="w-full h-full border-0"
              />
            </div>
          );
        }
        return (
          <div className="flex flex-col items-center justify-center flex-1 gap-4 text-gray-400">
            <File className="w-14 h-14 text-gray-300" />
            <p className="text-sm">此格式暂不支持在线预览</p>
            <button
              onClick={handleDownload}
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 transition-colors"
            >
              <Download className="w-4 h-4" />
              下载文件
            </button>
          </div>
        );
      }

      default:
        return null;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/90 backdrop-blur-sm">
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-4 bg-black/60 border-b border-white/10 flex-shrink-0">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <h2
            className="text-base font-medium text-white truncate max-w-[60vw]"
            title={previewNode.name}
          >
            {previewNode.name}
          </h2>
          <span className="text-xs text-white/50 flex-shrink-0">
            {formatBytes(previewNode.size)}
          </span>
          {currentIndex >= 0 && (
            <span className="text-xs text-white/40 flex-shrink-0">
              {currentIndex + 1} / {nodes.length}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 ml-4 flex-shrink-0">
          {previewState.status === 'ready' ||
          previewState.status === 'text' ||
          previewState.status === 'unencrypted' ? (
            <button
              onClick={handleDownload}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-white bg-white/10 hover:bg-white/20 transition-colors"
            >
              <Download className="w-4 h-4" />
              下载
            </button>
          ) : null}
          <button
            onClick={() => setPreview(null)}
            className="p-2 rounded-xl text-white/70 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex items-stretch overflow-hidden relative">
        {/* Prev arrow */}
        {hasPrev && (
          <button
            onClick={() => setPreview(nodes[currentIndex - 1])}
            className="absolute left-4 top-1/2 -translate-y-1/2 z-10 p-3 rounded-full bg-black/40 text-white hover:bg-black/60 transition-colors"
            aria-label="上一个"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
        )}

        {/* Content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {renderContent()}
        </div>

        {/* Next arrow */}
        {hasNext && (
          <button
            onClick={() => setPreview(nodes[currentIndex + 1])}
            className="absolute right-4 top-1/2 -translate-y-1/2 z-10 p-3 rounded-full bg-black/40 text-white hover:bg-black/60 transition-colors"
            aria-label="下一个"
          >
            <ChevronRight className="w-6 h-6" />
          </button>
        )}
      </div>

      {/* Click backdrop to close (only on the side margins) */}
      <div
        className="absolute inset-0 -z-10"
        onClick={() => setPreview(null)}
      />
    </div>
  );
}
