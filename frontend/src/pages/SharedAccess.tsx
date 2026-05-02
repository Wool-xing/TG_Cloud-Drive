import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import {
  Download,
  Lock,
  FileText,
  Image,
  Play,
  Music,
  Archive,
  File,
  Eye,
  Loader2,
  AlertTriangle,
  CheckCircle,
  Cloud,
} from 'lucide-react';
import toast from 'react-hot-toast';

import { sharesApi } from '../api/client';
import { importShareDEK, decryptChunk, hexToBuffer, formatBytes } from '../utils/crypto';

interface ShareInfo {
  node: {
    id: string;
    name: string;
    size: number;
    mimeType?: string;
    type: 'file' | 'folder';
  };
  token: string;
  hasPassword: boolean;
  expireAt?: string;
  downloadCount: number;
  maxDownloads?: number;
  shareKeyFragment?: string;
  chunks?: Array<{ url: string; iv: string; index: number }>;
}

function getMimeIcon(mimeType?: string, large = false) {
  const size = large ? 'w-16 h-16' : 'w-8 h-8';
  if (!mimeType) return <File className={`${size} text-gray-400`} />;
  if (mimeType.startsWith('image/')) return <Image className={`${size} text-purple-500`} />;
  if (mimeType.startsWith('video/')) return <Play className={`${size} text-red-500`} />;
  if (mimeType.startsWith('audio/')) return <Music className={`${size} text-green-500`} />;
  if (mimeType === 'application/pdf') return <FileText className={`${size} text-orange-500`} />;
  if (mimeType.includes('zip') || mimeType.includes('rar') || mimeType.includes('tar') || mimeType.includes('gz'))
    return <Archive className={`${size} text-gray-500`} />;
  return <File className={`${size} text-gray-400`} />;
}

function isPreviewable(mimeType?: string): boolean {
  if (!mimeType) return false;
  return (
    mimeType.startsWith('image/') ||
    mimeType.startsWith('video/') ||
    mimeType.startsWith('audio/') ||
    mimeType === 'application/pdf'
  );
}

export default function SharedAccess() {
  const { token } = useParams<{ token: string }>();

  const [state, setState] = useState<'loading' | 'password' | 'ready' | 'error'>('loading');
  const [shareInfo, setShareInfo] = useState<ShareInfo | null>(null);
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    if (!token) return;
    fetchShareInfo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const fetchShareInfo = async (pwd?: string) => {
    if (!token) return;
    setState('loading');
    try {
      const res = await sharesApi.access(token, pwd) as any;
      const info: ShareInfo = res?.share ?? res;

      if (!info) throw new Error('Invalid response');
      setShareInfo(info);
      setState('ready');
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 401 || err?.response?.data?.message?.includes('password')) {
        setState('password');
        if (pwd) {
          toast.error('密码错误，请重试');
        }
      } else if (status === 404) {
        setErrorMessage('分享链接不存在或已失效');
        setState('error');
      } else if (status === 410) {
        setErrorMessage('分享链接已过期或下载次数已达上限');
        setState('error');
      } else {
        setErrorMessage('加载失败，请稍后重试');
        setState('error');
      }
    }
  };

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) return;
    fetchShareInfo(password);
  };

  const handleDownload = async () => {
    if (!shareInfo || !token) return;
    setIsDownloading(true);
    setDownloadProgress(0);

    try {
      // Fetch full download info (chunks + encrypted key)
      const res = await sharesApi.access(token, password || undefined) as any;
      const info: ShareInfo = res?.share ?? res;
      const chunks = info.chunks ?? [];

      if (!chunks.length) {
        toast.error('无法获取文件块信息');
        return;
      }

      // Determine if decryption is needed
      const shareKeyFragment = info.shareKeyFragment;
      let dek: CryptoKey | null = null;
      if (shareKeyFragment) {
        dek = await importShareDEK(shareKeyFragment);
      }

      // Stream: fetch each chunk, decrypt if needed, accumulate
      const buffers: ArrayBuffer[] = [];
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const chunkRes = await fetch(chunk.url);
        if (!chunkRes.ok) throw new Error(`Failed to fetch chunk ${i}`);
        const chunkData = await chunkRes.arrayBuffer();

        if (dek && chunk.iv) {
          const decrypted = await decryptChunk(chunkData, dek, chunk.iv);
          buffers.push(decrypted);
        } else {
          buffers.push(chunkData);
        }

        setDownloadProgress(Math.round(((i + 1) / chunks.length) * 100));
      }

      // Concat all buffers into one blob
      const totalLength = buffers.reduce((acc, b) => acc + b.byteLength, 0);
      const merged = new Uint8Array(totalLength);
      let offset = 0;
      for (const buf of buffers) {
        merged.set(new Uint8Array(buf), offset);
        offset += buf.byteLength;
      }

      const blob = new Blob([merged], { type: shareInfo.node.mimeType ?? 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = shareInfo.node.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 10_000);

      toast.success('下载完成');
    } catch (err) {
      console.error(err);
      toast.error('下载失败，请重试');
    } finally {
      setIsDownloading(false);
      setDownloadProgress(0);
    }
  };

  const handlePreview = async () => {
    if (!shareInfo || !token) return;
    if (previewUrl) {
      setShowPreview(true);
      return;
    }

    setIsDownloading(true);
    try {
      const res = await sharesApi.access(token, password || undefined) as any;
      const info: ShareInfo = res?.share ?? res;
      const chunks = info.chunks ?? [];

      const shareKeyFragment = info.shareKeyFragment;
      let dek: CryptoKey | null = null;
      if (shareKeyFragment) {
        dek = await importShareDEK(shareKeyFragment);
      }

      const buffers: ArrayBuffer[] = [];
      for (const chunk of chunks) {
        const chunkRes = await fetch(chunk.url);
        const chunkData = await chunkRes.arrayBuffer();
        if (dek && chunk.iv) {
          buffers.push(await decryptChunk(chunkData, dek, chunk.iv));
        } else {
          buffers.push(chunkData);
        }
      }

      const totalLength = buffers.reduce((acc, b) => acc + b.byteLength, 0);
      const merged = new Uint8Array(totalLength);
      let offset = 0;
      for (const buf of buffers) {
        merged.set(new Uint8Array(buf), offset);
        offset += buf.byteLength;
      }

      const blob = new Blob([merged], { type: shareInfo.node.mimeType ?? 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      setPreviewUrl(url);
      setShowPreview(true);
    } catch {
      toast.error('预览失败');
    } finally {
      setIsDownloading(false);
    }
  };

  // ── Password Gate ──────────────────────────────────────────────
  if (state === 'password') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-600 mb-4">
              <Cloud className="w-9 h-9 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900">TG 云盘</h1>
            <p className="text-gray-500 mt-1 text-sm">安全文件分享</p>
          </div>

          <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-8">
            <div className="flex items-center justify-center w-12 h-12 bg-amber-100 rounded-xl mx-auto mb-4">
              <Lock className="w-6 h-6 text-amber-600" />
            </div>
            <h2 className="text-lg font-semibold text-gray-900 text-center mb-1">此分享受密码保护</h2>
            <p className="text-sm text-gray-500 text-center mb-6">请输入访问密码以继续</p>
            <form onSubmit={handlePasswordSubmit}>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="输入密码"
                className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent mb-4"
                autoFocus
              />
              <button
                type="submit"
                disabled={!password.trim()}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl text-sm transition-colors disabled:opacity-50"
              >
                访问文件
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  // ── Error State ────────────────────────────────────────────────
  if (state === 'error') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-600 mb-4">
            <Cloud className="w-9 h-9 text-white" />
          </div>
          <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-8">
            <div className="flex items-center justify-center w-12 h-12 bg-red-100 rounded-xl mx-auto mb-4">
              <AlertTriangle className="w-6 h-6 text-red-600" />
            </div>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">链接无效</h2>
            <p className="text-sm text-gray-500">{errorMessage}</p>
          </div>
        </div>
      </div>
    );
  }

  // ── Loading State ──────────────────────────────────────────────
  if (state === 'loading' || !shareInfo) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 flex items-center justify-center">
        <Loader2 className="w-10 h-10 animate-spin text-blue-500" />
      </div>
    );
  }

  const { node } = shareInfo;
  const canPreview = isPreviewable(node.mimeType);

  // ── Main Share Access Page ────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-600 mb-4 shadow-lg">
            <Cloud className="w-9 h-9 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">TG 云盘</h1>
          <p className="text-gray-500 mt-1 text-sm">端对端加密文件分享</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">
          {/* File info header */}
          <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-8 py-6 text-white">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 bg-white/20 rounded-2xl flex items-center justify-center flex-shrink-0">
                {getMimeIcon(node.mimeType, true)}
              </div>
              <div className="min-w-0">
                <h2 className="text-lg font-bold truncate">{node.name}</h2>
                <p className="text-blue-200 text-sm mt-0.5">
                  {formatBytes(node.size)}
                  {node.mimeType && (
                    <span className="ml-2 opacity-75">• {node.mimeType}</span>
                  )}
                </p>
              </div>
            </div>
          </div>

          {/* Metadata */}
          <div className="px-8 py-4 border-b border-gray-100 bg-gray-50">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
              <div className="flex justify-between">
                <dt className="text-gray-500">文件大小</dt>
                <dd className="font-medium text-gray-800">{formatBytes(node.size)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">下载次数</dt>
                <dd className="font-medium text-gray-800">
                  {shareInfo.downloadCount}
                  {shareInfo.maxDownloads ? ` / ${shareInfo.maxDownloads}` : ''}
                </dd>
              </div>
              {shareInfo.expireAt && (
                <div className="flex justify-between col-span-2">
                  <dt className="text-gray-500">过期时间</dt>
                  <dd className="font-medium text-gray-800">
                    {new Date(shareInfo.expireAt).toLocaleDateString('zh-CN', {
                      year: 'numeric', month: 'short', day: 'numeric',
                    })}
                  </dd>
                </div>
              )}
            </dl>
          </div>

          {/* Actions */}
          <div className="px-8 py-6 space-y-3">
            {/* Download progress */}
            {isDownloading && downloadProgress > 0 && (
              <div className="mb-4">
                <div className="flex justify-between text-xs text-gray-500 mb-1">
                  <span>正在下载...</span>
                  <span>{downloadProgress}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${downloadProgress}%` }}
                  />
                </div>
              </div>
            )}

            <button
              onClick={handleDownload}
              disabled={isDownloading}
              className="w-full flex items-center justify-center gap-2 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl text-sm transition-colors disabled:opacity-60"
            >
              {isDownloading && downloadProgress === 0 ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Download className="w-4 h-4" />
              )}
              {isDownloading ? '下载中...' : '下载文件'}
            </button>

            {canPreview && (
              <button
                onClick={handlePreview}
                disabled={isDownloading}
                className="w-full flex items-center justify-center gap-2 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-xl text-sm transition-colors disabled:opacity-60"
              >
                {isDownloading && downloadProgress === 0 ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
                在线预览
              </button>
            )}
          </div>

          {/* Footer */}
          <div className="px-8 py-4 bg-gray-50 border-t border-gray-100 flex items-center justify-center gap-1.5 text-xs text-gray-400">
            <CheckCircle className="w-3.5 h-3.5 text-green-500" />
            <span>端对端加密保护 • 文件内容仅对您可见</span>
          </div>
        </div>
      </div>

      {/* Preview modal */}
      {showPreview && previewUrl && shareInfo.node.mimeType && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setShowPreview(false)}
        >
          <div className="max-w-5xl w-full max-h-full overflow-auto" onClick={e => e.stopPropagation()}>
            {shareInfo.node.mimeType.startsWith('image/') && (
              <img src={previewUrl} alt={shareInfo.node.name} className="max-w-full max-h-screen rounded-xl mx-auto" />
            )}
            {shareInfo.node.mimeType.startsWith('video/') && (
              <video src={previewUrl} controls className="w-full rounded-xl" />
            )}
            {shareInfo.node.mimeType.startsWith('audio/') && (
              <div className="bg-white rounded-xl p-8 text-center">
                <Music className="w-16 h-16 text-green-500 mx-auto mb-4" />
                <p className="font-medium text-gray-800 mb-4">{shareInfo.node.name}</p>
                <audio src={previewUrl} controls className="w-full" />
              </div>
            )}
            {shareInfo.node.mimeType === 'application/pdf' && (
              <iframe src={previewUrl} className="w-full h-screen rounded-xl" title={shareInfo.node.name} />
            )}
            <button
              onClick={() => setShowPreview(false)}
              className="mt-4 mx-auto block px-6 py-2 bg-white/20 hover:bg-white/30 text-white rounded-xl text-sm transition-colors"
            >
              关闭预览
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
