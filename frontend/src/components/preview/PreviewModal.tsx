import DOMPurify from 'dompurify';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  X,
  Download,
  ChevronLeft,
  ChevronRight,
  Loader2,
  AlertTriangle,
  File,
  ZoomIn,
  ZoomOut,
  RotateCw,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  Edit3,
  Save, FileDown, FileText,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useQueryClient } from '@tanstack/react-query';
import { filesApi } from '../../api/client';
import { useFileStore } from '../../stores/file.store';
import { useAuthStore } from '../../stores/auth.store';
import { formatBytes, getSessionMEK, decryptDEK, decryptBuffer, encryptChunk, generateDEK, encryptDEK, exportDEKAsBase64 } from '../../utils/crypto';
import { streamingDownload, BlobFallbackTooLargeError } from '../../utils/streaming-download';
import RichTextEditor from './RichTextEditor';
import SpreadsheetEditor from './SpreadsheetEditor';
import PresentationEditor from './PresentationEditor';
import { Node, DownloadInfo } from '../../types';

// P1-F24: preview path has to buffer into a Blob URL for <img>/<video>/<pdf>.
// Above this size we refuse and tell the user to download instead — the
// download path streams to disk without the Blob.
const PREVIEW_BLOB_MAX_BYTES = 200 * 1024 * 1024;

interface PreviewModalProps {
  nodes: Node[];
}

type PreviewState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; blobUrl: string; mimeType: string }
  | { status: 'text'; content: string; mimeType: string }
  | { status: 'unencrypted'; downloadUrl: string }
  | { status: 'tooLarge'; size: number };

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
    mimeType.includes('xml') ||
    mimeType.includes('spreadsheet') ||
    mimeType.includes('excel') ||
    mimeType.includes('presentation') ||
    mimeType.includes('powerpoint') ||
    mimeType.includes('word') ||
    mimeType.includes('document')
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
    mimeType.includes('csv') ||
    mimeType.includes('spreadsheet') ||
    mimeType.includes('excel') ||
    mimeType.includes('presentation') ||
    mimeType.includes('powerpoint') ||
    mimeType.includes('word') ||
    mimeType.includes('document')
  );
}

function languageFromMime(mimeType: string): string {
  if (mimeType.includes('javascript') || mimeType.includes('ecmascript')) return 'javascript';
  if (mimeType.includes('typescript')) return 'typescript';
  if (mimeType.includes('json')) return 'json';
  if (mimeType.includes('xml') || mimeType.includes('svg')) return 'xml';
  if (mimeType.includes('yaml')) return 'yaml';
  if (mimeType.includes('css')) return 'css';
  if (mimeType.includes('shell') || mimeType.includes('sh')) return 'bash';
  if (mimeType.includes('python')) return 'python';
  return '';
}

// Image zoom / pan state
interface ImageTransform {
  scale: number;
  x: number;
  y: number;
}

function ImageViewer({ blobUrl, name }: { blobUrl: string; name: string }) {
  const [transform, setTransform] = useState<ImageTransform>({ scale: 1, x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const clampScale = (s: number) => Math.max(0.25, Math.min(10, s));

  const zoomTo = (newScale: number, cx?: number, cy?: number) => {
    setTransform((prev) => {
      const s = clampScale(newScale);
      if (cx !== undefined && cy !== undefined) {
        const ratio = s / prev.scale;
        return { scale: s, x: cx - ratio * (cx - prev.x), y: cy - ratio * (cy - prev.y) };
      }
      return { ...prev, scale: s };
    });
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const delta = e.deltaY > 0 ? 0.85 : 1.15;
    zoomTo(transform.scale * delta, cx, cy);
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setDragging(true);
    setDragStart({ x: e.clientX - transform.x, y: e.clientY - transform.y });
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragging) return;
    setTransform((prev) => ({
      ...prev,
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    }));
  };

  const onMouseUp = () => setDragging(false);
  const onDoubleClick = () => {
    setTransform(transform.scale > 1.1 ? { scale: 1, x: 0, y: 0 } : { scale: 2.5, x: 0, y: 0 });
  };

  return (
    <div
      ref={containerRef}
      className="flex-1 flex items-center justify-center overflow-hidden cursor-grab active:cursor-grabbing"
      onWheel={onWheel}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      onDoubleClick={onDoubleClick}
    >
      <img
        ref={imgRef}
        src={blobUrl}
        alt={name}
        draggable={false}
        className="select-none"
        style={{
          transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
          transition: dragging ? 'none' : 'transform 0.15s ease-out',
          maxWidth: transform.scale <= 1 ? '90%' : 'none',
          maxHeight: transform.scale <= 1 ? '90%' : 'none',
        }}
      />
      {/* Zoom controls */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-black/60 backdrop-blur rounded-full px-3 py-1.5">
        <button onClick={() => zoomTo(transform.scale * 0.7)} className="p-1 text-white/80 hover:text-white" title="缩小">
          <ZoomOut className="w-4 h-4" />
        </button>
        <span className="text-xs text-white/70 min-w-[3rem] text-center">
          {Math.round(transform.scale * 100)}%
        </span>
        <button onClick={() => zoomTo(transform.scale * 1.4)} className="p-1 text-white/80 hover:text-white" title="放大">
          <ZoomIn className="w-4 h-4" />
        </button>
        <button onClick={() => setTransform({ scale: 1, x: 0, y: 0 })} className="p-1 text-white/80 hover:text-white" title="重置">
          <RotateCw className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

function VideoPlayer({ blobUrl, name }: { blobUrl: string; name: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { v.play(); setPlaying(true); }
    else { v.pause(); setPlaying(false); }
  };

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const v = videoRef.current;
    if (!v || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    v.currentTime = pct * duration;
  };

  const toggleMute = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  };

  const toggleFullscreen = () => {
    const v = videoRef.current;
    if (!v) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      v.requestFullscreen();
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const v = videoRef.current;
      if (!v) return;
      if (e.key === ' ') { e.preventDefault(); togglePlay(); }
      else if (e.key === 'ArrowLeft') { v.currentTime = Math.max(0, v.currentTime - 5); }
      else if (e.key === 'ArrowRight') { v.currentTime = Math.min(v.duration || 0, v.currentTime + 5); }
      else if (e.key === 'f') { toggleFullscreen(); }
      else if (e.key === 'm') { toggleMute(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-black">
      <video
        ref={videoRef}
        src={blobUrl}
        className="max-w-full max-h-[calc(100%-64px)] object-contain"
        onTimeUpdate={() => {
          const v = videoRef.current;
          if (!v) return;
          setCurrentTime(v.currentTime);
          setProgress(v.duration ? (v.currentTime / v.duration) * 100 : 0);
        }}
        onLoadedMetadata={() => {
          const v = videoRef.current;
          if (!v) return;
          setDuration(v.duration);
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onClick={togglePlay}
      />
      {/* Custom controls bar */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-4 pb-3 pt-8">
        {/* Progress bar */}
        <div className="w-full h-1 bg-white/20 rounded-full mb-3 cursor-pointer" onClick={seek}>
          <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${progress}%` }} />
        </div>
        <div className="flex items-center gap-3">
          <button onClick={togglePlay} className="text-white/90 hover:text-white">
            {playing ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
          </button>
          <span className="text-xs text-white/70 font-mono w-[4.5rem]">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
          <div className="flex-1" />
          <button onClick={toggleMute} className="text-white/70 hover:text-white">
            {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
          <button onClick={toggleFullscreen} className="text-white/70 hover:text-white">
            <Maximize className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function AudioPlayer({ blobUrl, name }: { blobUrl: string; name: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);

  const togglePlay = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) { a.play(); setPlaying(true); }
    else { a.pause(); setPlaying(false); }
  };

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const a = audioRef.current;
    if (!a || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    a.currentTime = pct * duration;
  };

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="w-full max-w-lg bg-white/5 backdrop-blur border border-white/10 rounded-2xl p-8 flex flex-col items-center gap-6">
        <audio
          ref={audioRef}
          src={blobUrl}
          onTimeUpdate={() => {
            const a = audioRef.current;
            if (!a) return;
            setCurrentTime(a.currentTime);
            setProgress(a.duration ? (a.currentTime / a.duration) * 100 : 0);
          }}
          onLoadedMetadata={() => {
            const a = audioRef.current;
            if (!a) return;
            setDuration(a.duration);
          }}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
        />
        {/* Visualizer disk */}
        <div className={`w-28 h-28 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center shadow-2xl transition-transform ${playing ? 'animate-pulse' : ''}`}>
          <span className="text-5xl select-none">♪</span>
        </div>
        <p className="text-sm text-white/80 font-medium truncate max-w-full">{name}</p>
        {/* Progress */}
        <div className="w-full">
          <div className="w-full h-1.5 bg-white/10 rounded-full cursor-pointer" onClick={seek}>
            <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${progress}%` }} />
          </div>
          <div className="flex justify-between mt-1.5">
            <span className="text-xs text-white/50 font-mono">{formatTime(currentTime)}</span>
            <span className="text-xs text-white/50 font-mono">{formatTime(duration)}</span>
          </div>
        </div>
        {/* Controls */}
        <button
          onClick={togglePlay}
          className="w-14 h-14 rounded-full bg-white text-gray-900 flex items-center justify-center hover:scale-105 transition-transform shadow-lg"
        >
          {playing ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6 ml-0.5" />}
        </button>
      </div>
    </div>
  );
}

async function fetchAndDecrypt(
  nodeId: string,
  mekDerived: boolean,
  lockPassword?: string,
): Promise<{ blobUrl?: string; textContent?: string; mimeType: string; downloadUrl?: string; downloadInfo: DownloadInfo; tooLargeForPreview?: boolean }> {
  const info = await filesApi.getDownloadInfo(nodeId, lockPassword) as unknown as DownloadInfo;
  const mimeType = info.node.mimeType ?? 'application/octet-stream';
  const mek = getSessionMEK();

  if (!info.key || !mek || !mekDerived) {
    // Not encrypted or MEK not available — return direct download URL if available
    const downloadUrl = (info as any).downloadUrl ?? (info as any).url;
    return { downloadUrl, mimeType, downloadInfo: info };
  }

  // P1-F24: refuse to buffer huge files into a preview Blob — fall back to
  // download (handled by caller via the `tooLargeForPreview` flag). The
  // download path uses streamingDownload() which doesn't OOM the tab.
  if (info.node.size > PREVIEW_BLOB_MAX_BYTES) {
    return { mimeType, downloadInfo: info, tooLargeForPreview: true };
  }

  // Decrypt DEK
  const dek = await decryptDEK(info.key.encryptedDek, info.key.iv, mek);

  // Download and decrypt each chunk using its OWN iv (chunk.iv, NOT key.iv).
  // key.iv is the IV used to wrap the DEK with MEK above — reusing it for chunk
  // decryption is what previously made multi-chunk encrypted files unrecoverable.
  const chunks: ArrayBuffer[] = [];
  for (let i = 0; i < info.chunks.length; i++) {
    const chunk = info.chunks[i];
    if (!chunk.iv) {
      throw new Error(`分片 ${i} 缺少 IV，可能是 A1 修复前上传的历史损坏文件`);
    }
    const res = await fetch(chunk.url);
    if (!res.ok) throw new Error(`下载分片 ${i} 失败`);
    const encryptedData = await res.arrayBuffer();
    const decrypted = await decryptBuffer(encryptedData, dek, chunk.iv);
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

  // P1-F24: if the caller throws between this point and `setPreviewState`
  // they would orphan this URL. We hand ownership of the URL to the caller
  // — the loadPreview catch + outer revokeBlobUrl handle teardown.
  const blobUrl = URL.createObjectURL(blob);
  return { blobUrl, mimeType, downloadInfo: info };
}

export default function PreviewModal({ nodes }: PreviewModalProps) {
  const queryClient = useQueryClient();
  const { previewNode, setPreview } = useFileStore();
  const { mekDerived } = useAuthStore();

  const [previewState, setPreviewState] = useState<PreviewState>({ status: 'loading' });
  const [downloadProgress, setDownloadProgress] = useState(-1);
  const [lockPassword, setLockPassword] = useState('');
  const [needsLockPassword, setNeedsLockPassword] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const [saving, setSaving] = useState(false);
  const savedNodeRef = useRef<Node | null>(null);

  const handleEdit = () => {
    if (previewState.status === 'text') {
      setEditText(previewState.content);
      setEditing(true);
    }
  };

  const handleSave = async () => {
    if (!previewNode || saving) return;
    setSaving(true);
    try {
      const mek = getSessionMEK();
      if (!mek || !mekDerived) { toast.error('会话密钥已失效'); return; }
      const info = await filesApi.getDownloadInfo(previewNode.id) as unknown as DownloadInfo;

      let dek: CryptoKey;
      let encryptedDek: string | undefined;
      let dekIv: string | undefined;

      if (info.key) {
        dek = await decryptDEK(info.key.encryptedDek, info.key.iv, mek);
        encryptedDek = info.key.encryptedDek;
        dekIv = info.key.iv;
      } else {
        // New empty file — generate fresh DEK and wrap with MEK
        dek = await generateDEK();
        const wrapped = await encryptDEK(dek, mek);
        encryptedDek = wrapped.encryptedDek;
        dekIv = wrapped.iv;
      }

      const encoder = new TextEncoder();
      const plain = encoder.encode(editText);
      const { data, iv } = await encryptChunk(plain.buffer, dek);
      const base64 = btoa(String.fromCharCode(...new Uint8Array(data)));
      await filesApi.updateContent(previewNode.id, {
        data: base64, iv, size: plain.byteLength,
        mimeType: previewNode.mimeType || 'text/plain',
        encryptedDek, dekIv,
      });

      setPreviewState({ status: 'text', content: editText, mimeType: previewNode.mimeType || 'text/plain' });
      setEditing(false);
      toast.success('已保存');
      queryClient.invalidateQueries({ queryKey: ['files'] });
    } catch (err: any) { toast.error(err?.message || '保存失败');
    } finally { setSaving(false); }
  };

  const downloadExport = async (format: 'pdf' | 'docx') => {
    if (!previewNode) return;
    const token = localStorage.getItem('accessToken') || '';
    const endpoint = format === 'pdf'
      ? `/api/files/${previewNode.id}/export/pdf`
      : `/api/files/${previewNode.id}/export/docx`;
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ html: editText || (previewState as any).content || '' }),
      });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = previewNode.name.replace(/\.[^.]+$/, '') + '.' + format;
      a.click();
      URL.revokeObjectURL(url);
    } catch { toast.error('导出失败'); }
  };

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

      // New empty document — open editor directly with default content
      if (node.size === 0 && isTextMime(node.mimeType)) {
        const mt = node.mimeType || 'text/plain';
        let initial = '';
        if (mt.includes('spreadsheet') || mt.includes('excel') || mt.includes('csv')) {
          initial = JSON.stringify(Array.from({ length: 10 }, () => Array.from({ length: 10 }, () => ({ value: '' }))));
        } else if (mt.includes('presentation') || mt.includes('powerpoint')) {
          initial = JSON.stringify([{ title: '', body: '' }]);
        }
        setPreviewState({ status: 'text', content: initial, mimeType: mt });
        setEditText(initial);
        setEditing(true); // Auto-enter edit mode for new files
        return;
      }

      try {
        const result = await fetchAndDecrypt(node.id, mekDerived, password);
        setDownloadInfo(result.downloadInfo);

        // P1-F24: size cap path — skip Blob construction, offer streaming
        // download instead via the 'tooLarge' state.
        if (result.tooLargeForPreview) {
          setPreviewState({ status: 'tooLarge', size: result.downloadInfo.node.size });
          return;
        }

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
      if (editing) return; // Don't capture keys when editing text
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
        return;
      }
      if (previewState.status === 'unencrypted') {
        const a = document.createElement('a');
        a.href = (previewState as any).downloadUrl;
        a.download = previewNode.name;
        a.click();
        return;
      }
      if (previewState.status === 'text') {
        const blob = new Blob([(previewState as any).content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = previewNode.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
        return;
      }

      // tooLarge / loading / error path → re-fetch and stream to disk via
      // showSaveFilePicker (Blob fallback for legacy browsers). Pre-fix this
      // branch called window.open() on the first chunk URL — only delivered
      // the first 20 MB to the user, silently.
      const mek = getSessionMEK();
      const info = await filesApi.getDownloadInfo(previewNode.id) as unknown as DownloadInfo;
      const mimeType = info.node.mimeType ?? 'application/octet-stream';

      if (!info.key || !mek || !mekDerived) {
        const directUrl = (info as any).downloadUrl ?? (info as any).url;
        if (directUrl) {
          window.open(directUrl, '_blank');
        } else {
          toast.error('无法获取下载链接');
        }
        return;
      }

      const dek = await decryptDEK(info.key.encryptedDek, info.key.iv, mek);

      setDownloadProgress(0);
      let warnedFallback = false;
      await streamingDownload(
        {
          count: info.chunks.length,
          fetchChunk: async (i: number) => {
            const chunk = info.chunks[i];
            if (!chunk.iv) throw new Error(`分片 ${i} 缺少 IV，可能是历史损坏文件`);
            const res = await fetch(chunk.url);
            if (!res.ok) throw new Error(`下载分片 ${i} 失败`);
            const encrypted = await res.arrayBuffer();
            const plain = await decryptBuffer(encrypted, dek, chunk.iv);
            return new Uint8Array(plain);
          },
        },
        {
          filename: previewNode.name,
          mimeType,
          totalSize: info.node.size,
          onProgress: (f) => setDownloadProgress(Math.round(f * 100)),
          onLargeFileFallback: () => {
            if (!warnedFallback) {
              warnedFallback = true;
              toast('当前浏览器将在内存中缓冲完整文件，大文件可能较慢。建议使用 Chrome / Edge 获得流式下载。');
            }
          },
        },
      );
      setDownloadProgress(-1);
      toast.success('下载完成');
    } catch (err: any) {
      if (err?.name === 'AbortError') return; // user cancelled save dialog
      if (err instanceof BlobFallbackTooLargeError) {
        toast.error(err.message);
        return;
      }
      toast.error('下载失败');
    }
  };

  const renderContent = () => {
    switch (previewState.status) {
      case 'loading':
        return (
          <div className="flex flex-col items-center justify-center flex-1 gap-4 text-gray-400 dark:text-gray-500">
            <Loader2 className="w-10 h-10 animate-spin text-blue-500" />
            <p className="text-sm">正在加载预览…</p>
          </div>
        );

      case 'error':
        return (
          <div className="flex flex-col items-center justify-center flex-1 gap-4 text-gray-400 px-8 dark:text-gray-500">
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
                  className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-gray-100 dark:border-gray-600"
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

      case 'tooLarge':
        return (
          <div className="flex flex-col items-center justify-center flex-1 gap-4 text-gray-400 px-8 text-center dark:text-gray-500">
            <File className="w-14 h-14 text-gray-300" />
            <p className="text-sm">
              文件大小 {formatBytes(previewState.size)} 超过在线预览上限 {formatBytes(PREVIEW_BLOB_MAX_BYTES)}。
              <br />
              直接下载后用本地播放器/查看器打开，体验更顺。
            </p>
            <button
              onClick={handleDownload}
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 transition-colors"
            >
              <Download className="w-4 h-4" />
              下载文件
            </button>
          </div>
        );

      case 'unencrypted':
        return (
          <div className="flex flex-col items-center justify-center flex-1 gap-4 text-gray-400 dark:text-gray-500">
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

      case 'text': {
        const lang = languageFromMime(previewState.mimeType);
        const isCode = !!lang;
        const isSheet = previewState.mimeType.includes('spreadsheet') || previewState.mimeType.includes('csv') || previewState.mimeType.includes('excel');
        const isSlide = previewState.mimeType.includes('presentation') || previewState.mimeType.includes('powerpoint');
        const label = isSheet ? 'sheet' : isSlide ? 'slide' : lang || 'richtext';

        return (
          <div className="flex-1 overflow-hidden p-4">
            <div className="rounded-xl overflow-hidden border border-white/10 h-full flex flex-col">
              <div className="flex items-center gap-2 px-4 py-2 bg-white/5 border-b border-white/10">
                <span className="text-xs text-white/50 font-mono">{label}</span>
                <div className="flex-1" />
                {editing ? (
                  <>
                    {/* Export buttons */}
                    <button
                      onClick={() => downloadExport('pdf')}
                      className="flex items-center gap-1 text-xs text-white/60 hover:text-white px-2 py-1 rounded hover:bg-white/10 transition-colors"
                      title="导出 PDF"
                    ><FileText className="w-3 h-3" /> PDF</button>
                    <button
                      onClick={() => downloadExport('docx')}
                      className="flex items-center gap-1 text-xs text-white/60 hover:text-white px-2 py-1 rounded hover:bg-white/10 transition-colors"
                      title="导出 Word"
                    ><FileDown className="w-3 h-3" /> Word</button>
                    <span className="w-px h-4 bg-white/10" />
                    <button onClick={() => setEditing(false)} className="text-xs text-white/70 hover:text-white px-3 py-1 rounded-lg hover:bg-white/10 transition-colors">取消</button>
                    <button onClick={handleSave} disabled={saving} className="flex items-center gap-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg transition-colors font-medium">
                      <Save className="w-3.5 h-3.5" />{saving ? '保存中…' : '保存'}
                    </button>
                  </>
                ) : (
                  <button onClick={handleEdit} className="flex items-center gap-1.5 text-xs bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 rounded-lg transition-colors font-medium border border-white/10">
                    <Edit3 className="w-3.5 h-3.5" />编辑
                  </button>
                )}
              </div>
              {editing ? (
                isCode ? (
                  <textarea value={editText} onChange={e => setEditText(e.target.value)}
                    className="flex-1 text-sm font-mono whitespace-pre-wrap break-words bg-gray-950 text-green-400 p-6 outline-none resize-none border-0" autoFocus />
                ) : isSheet ? (
                  <SpreadsheetEditor content={editText} onChange={setEditText} />
                ) : isSlide ? (
                  <PresentationEditor content={editText} onChange={setEditText} />
                ) : (
                  <RichTextEditor content={editText} onChange={setEditText} placeholder="开始编辑文档…" />
                )
              ) : (
                isCode ? (
                  <pre className="text-sm font-mono whitespace-pre-wrap break-words bg-gray-950 text-green-400 p-6 flex-1 overflow-auto m-0">{previewState.content}</pre>
                ) : (
                  <div className="prose prose-sm dark:prose-invert max-w-none p-6 flex-1 overflow-auto bg-gray-950 text-gray-100"
                    dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(previewState.content) }} />
                )
              )}
            </div>
          </div>
        );
      }

      case 'ready': {
        const { blobUrl, mimeType } = previewState;
        if (mimeType.startsWith('image/')) {
          return <ImageViewer blobUrl={blobUrl} name={previewNode.name} />;
        }
        if (mimeType.startsWith('video/')) {
          return <VideoPlayer blobUrl={blobUrl} name={previewNode.name} />;
        }
        if (mimeType.startsWith('audio/')) {
          return <AudioPlayer blobUrl={blobUrl} name={previewNode.name} />;
        }
        if (mimeType === 'application/pdf') {
          return (
            <div className="flex-1 overflow-hidden">
              <iframe
                src={blobUrl}
                title={previewNode.name}
                className="w-full h-full border-0"
                sandbox="allow-scripts allow-popups allow-forms"
                referrerPolicy="no-referrer"
              />
            </div>
          );
        }
        return (
          <div className="flex flex-col items-center justify-center flex-1 gap-4 text-gray-400 dark:text-gray-500">
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
          {downloadProgress >= 0 && (
            <span className="text-xs text-blue-400 flex-shrink-0 font-mono">{downloadProgress}%</span>
          )}
          {currentIndex >= 0 && (
            <span className="text-xs text-white/40 flex-shrink-0">
              {currentIndex + 1} / {nodes.length}
            </span>
          )}
        </div>
        {downloadProgress >= 0 && (
          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white/10">
            <div className="h-full bg-blue-500 transition-all duration-150" style={{ width: `${downloadProgress}%` }} />
          </div>
        )}

        <div className="flex items-center gap-2 ml-4 flex-shrink-0">
          {previewState.status === 'ready' ||
          previewState.status === 'text' ||
          previewState.status === 'unencrypted' ||
          previewState.status === 'tooLarge' ? (
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
