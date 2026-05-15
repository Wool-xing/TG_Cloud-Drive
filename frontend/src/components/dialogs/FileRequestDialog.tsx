import { useState } from 'react';
import { X, Link, Copy, Upload, Clock, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { filesApi } from '../../api/client';
import { Node } from '../../types';

interface FileRequestDialogProps {
  node: Node;
  onClose: () => void;
}

export default function FileRequestDialog({ node, onClose }: FileRequestDialogProps) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ token: string; url: string; expiresAt: string } | null>(null);
  const [maxFiles, setMaxFiles] = useState(100);
  const [ttlHours, setTtlHours] = useState(72);

  const handleCreate = async () => {
    setLoading(true);
    try {
      const res = await filesApi.createFileRequest(node.id, maxFiles, ttlHours) as any;
      const url = `${window.location.origin}${res.url}`;
      setResult({ token: res.token, url, expiresAt: res.expiresAt });
      toast.success('文件请求链接已生成');
    } catch {
      toast.error('创建失败');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    if (!result) return;
    navigator.clipboard.writeText(result.url);
    toast.success('已复制链接');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md border border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <Upload className="w-4.5 h-4.5 text-green-500" />
            <h3 className="text-base font-semibold text-gray-800 dark:text-gray-100">
              文件请求 · {node.name}
            </h3>
          </div>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">
            <X className="w-4.5 h-4.5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {!result ? (
            <>
              <p className="text-sm text-gray-500">
                生成一个公开链接。任何人都可以通过这个链接上传文件到 <strong>{node.name}</strong>，无需注册或登录。
              </p>
              <div className="space-y-3">
                <label className="block text-sm">
                  <span className="text-gray-600 dark:text-gray-300">上传数量上限</span>
                  <input
                    type="number"
                    min={1}
                    max={1000}
                    value={maxFiles}
                    onChange={e => setMaxFiles(Number(e.target.value))}
                    className="mt-1 w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100"
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-gray-600 dark:text-gray-300">有效时间（小时）</span>
                  <input
                    type="number"
                    min={1}
                    max={168}
                    value={ttlHours}
                    onChange={e => setTtlHours(Number(e.target.value))}
                    className="mt-1 w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100"
                  />
                </label>
              </div>
              <button
                onClick={handleCreate}
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium text-white bg-green-600 hover:bg-green-700 disabled:opacity-50 transition"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link className="w-4 h-4" />}
                {loading ? '生成中…' : '生成上传链接'}
              </button>
            </>
          ) : (
            <>
              <div className="p-4 rounded-xl bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 space-y-3">
                <p className="text-sm font-medium text-green-800 dark:text-green-200">链接已生成</p>
                <div className="flex items-center gap-2">
                  <input
                    readOnly
                    value={result.url}
                    className="flex-1 border border-green-300 dark:border-green-700 rounded-lg px-3 py-2 text-xs bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100"
                  />
                  <button onClick={handleCopy} className="p-2 text-green-600 hover:bg-green-100 dark:hover:bg-green-900/30 rounded-lg transition">
                    <Copy className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex items-center gap-1 text-xs text-gray-500">
                  <Clock className="w-3 h-3" />
                  过期时间：{new Date(result.expiresAt).toLocaleString('zh-CN')}
                </div>
              </div>
              <button
                onClick={onClose}
                className="w-full px-4 py-2.5 rounded-xl text-sm font-medium text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 transition"
              >
                关闭
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
