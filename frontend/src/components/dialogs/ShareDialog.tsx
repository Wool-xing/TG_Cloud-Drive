import { useEffect, useState } from 'react';
import { X, Copy, Check, Share2, Link } from 'lucide-react';
import toast from 'react-hot-toast';
import { sharesApi } from '../../api/client';
import { Node, Share } from '../../types';

interface ShareDialogProps {
  node: Node;
  onClose: () => void;
}

type Expiry = '1d' | '7d' | '30d' | 'never';
type MaxDownloads = 'unlimited' | '1' | '5' | 'custom';

const EXPIRY_OPTIONS: { value: Expiry; label: string }[] = [
  { value: '1d', label: '1天' },
  { value: '7d', label: '7天' },
  { value: '30d', label: '30天' },
  { value: 'never', label: '永久' },
];

const DOWNLOAD_OPTIONS: { value: MaxDownloads; label: string }[] = [
  { value: 'unlimited', label: '无限制' },
  { value: '1', label: '1次' },
  { value: '5', label: '5次' },
  { value: 'custom', label: '自定义' },
];

function expiryToDate(expiry: Expiry): string | undefined {
  if (expiry === 'never') return undefined;
  const days = expiry === '1d' ? 1 : expiry === '7d' ? 7 : 30;
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

export default function ShareDialog({ node, onClose }: ShareDialogProps) {
  const [expiry, setExpiry] = useState<Expiry>('7d');
  const [password, setPassword] = useState('');
  const [maxDownloadsType, setMaxDownloadsType] = useState<MaxDownloads>('unlimited');
  const [customDownloads, setCustomDownloads] = useState('10');
  const [submitting, setSubmitting] = useState(false);
  const [share, setShare] = useState<Share | null>(null);
  const [copied, setCopied] = useState(false);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const shareUrl = share
    ? `${window.location.origin}/s/${share.token}`
    : '';

  const handleCreate = async () => {
    setSubmitting(true);
    try {
      let maxDownloads: number | undefined;
      if (maxDownloadsType === '1') maxDownloads = 1;
      else if (maxDownloadsType === '5') maxDownloads = 5;
      else if (maxDownloadsType === 'custom') {
        const n = parseInt(customDownloads, 10);
        if (isNaN(n) || n < 1) {
          toast.error('请输入有效的下载次数');
          return;
        }
        maxDownloads = n;
      }

      const payload: Record<string, any> = {
        nodeId: node.id,
        expireAt: expiryToDate(expiry),
        maxDownloads,
      };
      if (password.trim()) payload.password = password.trim();

      const res = await sharesApi.create(payload) as any;
      const created: Share = res?.share ?? res?.data ?? res;
      setShare(created);
      toast.success('分享链接已创建');
    } catch {
      // handled
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      toast.success('链接已复制到剪贴板');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('复制失败，请手动复制');
    }
  };

  // Simple QR text representation
  const QRPlaceholder = () => (
    <div className="mt-4 p-4 border border-dashed border-gray-300 rounded-xl text-center">
      <div className="text-xs text-gray-400 mb-2">扫码访问</div>
      <div className="inline-block p-2 bg-white border border-gray-200 rounded-lg">
        <div className="text-xs font-mono text-gray-600 max-w-[200px] break-all">{shareUrl}</div>
      </div>
      <p className="text-xs text-gray-400 mt-2">可使用手机扫码或直接分享链接</p>
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Share2 className="w-5 h-5 text-blue-500" />
            <h2 className="text-lg font-semibold text-gray-800">分享文件</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5">
          {!share ? (
            /* Creation form */
            <div className="space-y-5">
              <div>
                <p className="text-sm text-gray-600 mb-1">
                  文件：<span className="font-medium text-gray-800">{node.name}</span>
                </p>
              </div>

              {/* Expiry */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">有效期</label>
                <div className="grid grid-cols-4 gap-2">
                  {EXPIRY_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setExpiry(opt.value)}
                      className={`py-2 rounded-xl text-sm font-medium border transition-colors ${
                        expiry === opt.value
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Max downloads */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">最大下载次数</label>
                <div className="grid grid-cols-4 gap-2">
                  {DOWNLOAD_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setMaxDownloadsType(opt.value)}
                      className={`py-2 rounded-xl text-sm font-medium border transition-colors ${
                        maxDownloadsType === opt.value
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                {maxDownloadsType === 'custom' && (
                  <input
                    type="number"
                    min={1}
                    value={customDownloads}
                    onChange={(e) => setCustomDownloads(e.target.value)}
                    className="mt-2 w-full border border-gray-300 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="输入次数"
                  />
                )}
              </div>

              {/* Password */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  访问密码
                  <span className="text-gray-400 font-normal ml-1.5">(可选)</span>
                </label>
                <input
                  type="text"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="留空则不设置密码"
                  className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-3 pt-1">
                <button
                  onClick={onClose}
                  className="px-4 py-2 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-100 border border-gray-200 transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleCreate}
                  disabled={submitting}
                  className="px-5 py-2 rounded-xl text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-sm"
                >
                  {submitting ? '创建中…' : '生成分享链接'}
                </button>
              </div>
            </div>
          ) : (
            /* Share result */
            <div className="space-y-4">
              <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3">
                <p className="text-sm font-medium text-green-700">分享链接已创建</p>
                {share.expireAt && (
                  <p className="text-xs text-green-600 mt-1">
                    有效期至：{new Date(share.expireAt).toLocaleString('zh-CN')}
                  </p>
                )}
                {share.hasPassword && (
                  <p className="text-xs text-green-600 mt-0.5">已设置访问密码</p>
                )}
              </div>

              {/* Link */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  <Link className="w-3.5 h-3.5 inline mr-1" />
                  分享链接
                </label>
                <div className="flex items-center gap-2">
                  <input
                    readOnly
                    value={shareUrl}
                    className="flex-1 border border-gray-200 rounded-xl px-4 py-2.5 text-sm bg-gray-50 text-gray-700 font-mono truncate"
                  />
                  <button
                    onClick={handleCopy}
                    className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                      copied
                        ? 'bg-green-100 text-green-700 border border-green-200'
                        : 'bg-blue-600 text-white hover:bg-blue-700'
                    }`}
                  >
                    {copied ? (
                      <>
                        <Check className="w-4 h-4" />
                        已复制
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4" />
                        复制
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* QR */}
              <QRPlaceholder />

              <div className="flex justify-end pt-1">
                <button
                  onClick={onClose}
                  className="px-5 py-2 rounded-xl text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 transition-colors shadow-sm"
                >
                  完成
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
