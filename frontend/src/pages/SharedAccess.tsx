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
import { importShareDEK, decryptChunk, formatBytes } from '../utils/crypto';
import { streamingDownload, BlobFallbackTooLargeError } from '../utils/streaming-download';
import { t } from '../i18n/translations';

// P1-F5: preview is the only path that still has to buffer the whole file
// (Blob URL → <img>/<video>/<iframe src>). Above this size we refuse to
// build the Blob and surface a "download then open locally" hint instead.
const PREVIEW_BLOB_MAX_BYTES = 200 * 1024 * 1024;

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
      // P1-F6: prefer server-provided `code` over message substring matching.
      // Backend now returns SHARE_PASSWORD_REQUIRED / SHARE_PASSWORD_INVALID
      // alongside 401. Fallback to legacy substring check for old backends.
      const code: string | undefined = err?.response?.data?.code;
      const legacyPwdHit =
        status === 401 && err?.response?.data?.message?.includes('password');
      if (code === 'SHARE_PASSWORD_REQUIRED') {
        setState('password');
      } else if (code === 'SHARE_PASSWORD_INVALID') {
        setState('password');
        toast.error(t('shareAccess.wrongPassword'));
      } else if (status === 401 || legacyPwdHit) {
        setState('password');
        if (pwd) toast.error(t('shareAccess.wrongPassword'));
      } else if (status === 404) {
        setErrorMessage(t('shareAccess.invalidLink'));
        setState('error');
      } else if (status === 410) {
        setErrorMessage(t('shareAccess.expiredOrLimit'));
        setState('error');
      } else {
        setErrorMessage(t('shareAccess.loadFail'));
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
        toast.error(t('shareAccess.noChunks'));
        return;
      }

      // Determine if decryption is needed
      const shareKeyFragment = info.shareKeyFragment;
      let dek: CryptoKey | null = null;
      if (shareKeyFragment) {
        dek = await importShareDEK(shareKeyFragment);
      }

      // P1-F5: stream chunks straight to disk via showSaveFilePicker, or
      // fall back to the legacy Blob path with a soft cap on non-Chromium
      // browsers. Only ONE chunk's worth of plaintext lives in memory at
      // a time, so multi-GB shares no longer crash the tab.
      let warnedFallback = false;
      await streamingDownload(
        {
          count: chunks.length,
          fetchChunk: async (i: number) => {
            const chunk = chunks[i];
            const chunkRes = await fetch(chunk.url);
            if (!chunkRes.ok) throw new Error(t('preview.chunkDownloadFail', { i }));
            const chunkData = await chunkRes.arrayBuffer();
            const plain = dek && chunk.iv
              ? await decryptChunk(chunkData, dek, chunk.iv)
              : chunkData;
            return new Uint8Array(plain);
          },
        },
        {
          filename: shareInfo.node.name,
          mimeType: shareInfo.node.mimeType,
          totalSize: shareInfo.node.size,
          onProgress: (f) => setDownloadProgress(Math.round(f * 100)),
          onLargeFileFallback: () => {
            if (!warnedFallback) {
              warnedFallback = true;
              toast(t('preview.blobFallbackWarn'));
            }
          },
        },
      );

      toast.success(t('preview.downloadDone'));
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        // User cancelled the save dialog — silent.
        return;
      }
      if (err instanceof BlobFallbackTooLargeError) {
        toast.error(err.message);
        return;
      }
      console.error(err);
      toast.error(t('preview.downloadFail'));
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

    // P1-F5: preview path *must* buffer (Blob URL → <img>/<video>/<iframe>),
    // so cap size and surface a clear hint instead of letting the tab OOM.
    if (shareInfo.node.size > PREVIEW_BLOB_MAX_BYTES) {
      toast.error(
        t('preview.tooLarge', { size: formatBytes(shareInfo.node.size), limit: formatBytes(PREVIEW_BLOB_MAX_BYTES) }),
      );
      return;
    }

    setIsDownloading(true);
    let createdUrl: string | null = null;
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
      createdUrl = URL.createObjectURL(blob);
      setPreviewUrl(createdUrl);
      setShowPreview(true);
      createdUrl = null; // ownership transferred to previewUrl state
    } catch {
      // P1-F24: on the error path the partially-built blob URL would have
      // leaked. Revoke it before bubbling up.
      if (createdUrl) URL.revokeObjectURL(createdUrl);
      toast.error(t('shareAccess.previewFail'));
    } finally {
      setIsDownloading(false);
    }
  };

  // P1-F24: revoke the preview blob URL when this page unmounts or when the
  // user navigates to a different share token. Pre-fix the URL leaked for the
  // lifetime of the tab.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);


  // ── Password Gate ──────────────────────────────────────────────
  if (state === 'password') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-600 mb-4">
              <Cloud className="w-9 h-9 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t('shareAccess.title')}</h1>
            <p className="text-gray-500 mt-1 text-sm dark:text-gray-400">{t('shareAccess.security')}</p>
          </div>

          <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-8 dark:bg-gray-800 dark:border-gray-700">
            <div className="flex items-center justify-center w-12 h-12 bg-amber-100 rounded-xl mx-auto mb-4">
              <Lock className="w-6 h-6 text-amber-600" />
            </div>
            <h2 className="text-lg font-semibold text-gray-900 text-center mb-1 dark:text-gray-100">{t('shareAccess.passwordProtected')}</h2>
            <p className="text-sm text-gray-500 text-center mb-6 dark:text-gray-400">{t('shareAccess.enterPassword')}</p>
            <form onSubmit={handlePasswordSubmit}>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder={t("shareAccess.passwordPlaceholder")}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent mb-4 dark:border-gray-600"
                autoFocus
              />
              <button
                type="submit"
                disabled={!password.trim()}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl text-sm transition-colors disabled:opacity-50"
              >
                {t('shareAccess.accessFile')}
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
          <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-8 dark:bg-gray-800 dark:border-gray-700">
            <div className="flex items-center justify-center w-12 h-12 bg-red-100 rounded-xl mx-auto mb-4">
              <AlertTriangle className="w-6 h-6 text-red-600" />
            </div>
            <h2 className="text-lg font-semibold text-gray-900 mb-2 dark:text-gray-100">{t('shareAccess.invalidLink')}</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">{errorMessage}</p>
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
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t('shareAccess.title')}</h1>
          <p className="text-gray-500 mt-1 text-sm dark:text-gray-400">{t('shareAccess.e2ee')}</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden dark:bg-gray-800 dark:border-gray-700">
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
          <div className="px-8 py-4 border-b border-gray-100 bg-gray-50 dark:bg-gray-900 dark:border-gray-700">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
              <div className="flex justify-between">
                <dt className="text-gray-500 dark:text-gray-400">{t('shareAccess.fileSize')}</dt>
                <dd className="font-medium text-gray-800 dark:text-gray-100">{formatBytes(node.size)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500 dark:text-gray-400">{t('shareAccess.downloadCount')}</dt>
                <dd className="font-medium text-gray-800 dark:text-gray-100">
                  {shareInfo.downloadCount}
                  {shareInfo.maxDownloads ? ` / ${shareInfo.maxDownloads}` : ''}
                </dd>
              </div>
              {shareInfo.expireAt && (
                <div className="flex justify-between col-span-2">
                  <dt className="text-gray-500 dark:text-gray-400">{t('shareAccess.expiry')}</dt>
                  <dd className="font-medium text-gray-800 dark:text-gray-100">
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
                <div className="flex justify-between text-xs text-gray-500 mb-1 dark:text-gray-400">
                  <span>{t('shareAccess.downloading')}</span>
                  <span>{downloadProgress}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2 dark:bg-gray-700">
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
              {isDownloading ? t('shareAccess.downloadingBtn') : t('shareAccess.downloadFile')}
            </button>

            {canPreview && (
              <button
                onClick={handlePreview}
                disabled={isDownloading}
                className="w-full flex items-center justify-center gap-2 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-xl text-sm transition-colors disabled:opacity-60 dark:bg-gray-700 dark:text-gray-300"
              >
                {isDownloading && downloadProgress === 0 ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
                {t('shareAccess.onlinePreview')}
              </button>
            )}
          </div>

          {/* Footer */}
          <div className="px-8 py-4 bg-gray-50 border-t border-gray-100 flex items-center justify-center gap-1.5 text-xs text-gray-400 dark:bg-gray-900 dark:text-gray-500 dark:border-gray-700">
            <CheckCircle className="w-3.5 h-3.5 text-green-500" />
            <span>{t('shareAccess.e2eeFooter')}</span>
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
              <div className="bg-white rounded-xl p-8 text-center dark:bg-gray-800">
                <Music className="w-16 h-16 text-green-500 mx-auto mb-4" />
                <p className="font-medium text-gray-800 mb-4 dark:text-gray-100">{shareInfo.node.name}</p>
                <audio src={previewUrl} controls className="w-full" />
              </div>
            )}
            {shareInfo.node.mimeType === 'application/pdf' && (
              // P1-F14: sandbox the preview iframe. Pre-fix, a malicious upload
              // posing as application/pdf but actually serving HTML executed
              // with full same-origin privileges — XSS path through any share
              // link. Restrict to scripts only (PDF.js needs scripts + same
              // origin); explicitly OMIT allow-same-origin to prevent the
              // embedded content reaching our cookies / localStorage.
              <iframe
                src={previewUrl}
                className="w-full h-screen rounded-xl"
                title={shareInfo.node.name}
                sandbox="allow-scripts allow-popups allow-forms"
                referrerPolicy="no-referrer"
              />
            )}
            <button
              onClick={() => setShowPreview(false)}
              className="mt-4 mx-auto block px-6 py-2 bg-white/20 hover:bg-white/30 text-white rounded-xl text-sm transition-colors"
            >
              {t('shareAccess.closePreview')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
