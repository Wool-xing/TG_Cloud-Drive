import { useState, useEffect } from 'react';
import { X, Clock, RotateCcw, Download, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { filesApi } from '../../api/client';
import { formatBytes } from '../../utils/crypto';
import { Node } from '../../types';

interface VersionDialogProps {
  node: Node;
  onClose: () => void;
}

interface Version {
  id: string;
  version: number;
  size: number;
  createdAt: string;
}

export default function VersionDialog({ node, onClose }: VersionDialogProps) {
  const [versions, setVersions] = useState<Version[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);

  useEffect(() => {
    loadVersions();
  }, []);

  const loadVersions = async () => {
    try {
      const res = await filesApi.getVersions(node.id) as any;
      setVersions(res ?? []);
    } catch {
      toast.error('加载版本列表失败');
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    setCreating(true);
    try {
      const res = await filesApi.createVersion(node.id) as any;
      toast.success(`已保存为版本 ${res.version}`);
      await loadVersions();
    } catch {
      toast.error('创建版本失败');
    } finally {
      setCreating(false);
    }
  };

  const handleDownload = async (versionId: string) => {
    setDownloading(versionId);
    try {
      const info = await filesApi.getVersionDownloadInfo(node.id, versionId) as any;
      if (info?.chunks?.length) {
        // Simple download: fetch first chunk
        const chunks: ArrayBuffer[] = [];
        for (const chunk of info.chunks) {
          const res = await fetch(chunk.url);
          if (res.ok) chunks.push(await res.arrayBuffer());
        }
        const total = chunks.reduce((s, c) => s + c.byteLength, 0);
        const merged = new Uint8Array(total);
        let off = 0;
        for (const c of chunks) { merged.set(new Uint8Array(c), off); off += c.byteLength; }
        const blob = new Blob([merged]);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `${node.name}.v${info.version ?? ''}`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
        toast.success('下载完成');
      }
    } catch {
      toast.error('下载版本失败');
    } finally {
      setDownloading(null);
    }
  };

  const formatDate = (d: string) => {
    return new Date(d).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md max-h-[80vh] flex flex-col border border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <Clock className="w-4.5 h-4.5 text-blue-500" />
            <h3 className="text-base font-semibold text-gray-800 dark:text-gray-100">
              版本历史 · {node.name}
            </h3>
          </div>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">
            <X className="w-4.5 h-4.5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-blue-500" /></div>
          ) : versions.length === 0 ? (
            <p className="text-center text-sm text-gray-400 py-8">暂无历史版本</p>
          ) : (
            <div className="space-y-2">
              {versions.map((v) => (
                <div key={v.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-900 border border-gray-100 dark:border-gray-700">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-200">
                      版本 {v.version}
                    </p>
                    <p className="text-xs text-gray-400">
                      {formatBytes(v.size)} · {formatDate(v.createdAt)}
                    </p>
                  </div>
                  <button
                    onClick={() => handleDownload(v.id)}
                    disabled={downloading === v.id}
                    className="p-2 text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg transition"
                    title="下载此版本"
                  >
                    {downloading === v.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-700">
          <button
            onClick={handleCreate}
            disabled={creating}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 transition"
          >
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
            {creating ? '保存中…' : '保存当前为版本'}
          </button>
        </div>
      </div>
    </div>
  );
}
