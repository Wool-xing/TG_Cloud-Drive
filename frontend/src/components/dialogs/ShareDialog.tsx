import { useEffect, useState } from 'react';
import { X, Copy, Check, Share2, Link } from 'lucide-react';
import toast from 'react-hot-toast';
import { sharesApi } from '../../api/client';
import { Node, Share } from '../../types';
import { t, getLang } from '../../i18n/translations';

interface ShareDialogProps {
  node: Node;
  onClose: () => void;
}

type Expiry = '1d' | '7d' | '30d' | 'never';
type MaxDownloads = 'unlimited' | '1' | '5' | 'custom';

const EXPIRY_OPTIONS: { value: Expiry; labelKey: string }[] = [
  { value: '1d', labelKey: 'share.expiry.1d' },
  { value: '7d', labelKey: 'share.expiry.7d' },
  { value: '30d', labelKey: 'share.expiry.30d' },
  { value: 'never', labelKey: 'share.expiry.never' },
];

const DOWNLOAD_OPTIONS: { value: MaxDownloads; labelKey: string }[] = [
  { value: 'unlimited', labelKey: 'share.downloads.unlimited' },
  { value: '1', labelKey: 'share.downloads.1' },
  { value: '5', labelKey: 'share.downloads.5' },
  { value: 'custom', labelKey: 'share.downloads.custom' },
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
        if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) {
          toast.error(t('share.error.range'));
          return;
        }
        if (n > 10_000) {
          toast.error(t('share.error.max'));
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
      toast.success(t('share.createdToast'));
    } catch {
      toast.error(t('share.error.create'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      toast.success(t('share.copiedToast'));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t('share.copyFailToast'));
    }
  };

  const QRPlaceholder = () => (
    <div className="mt-4 p-4 border border-dashed border-gray-300 dark:border-gray-600 rounded-xl text-center">
      <div className="text-xs text-gray-400 dark:text-gray-500 mb-2">{t('share.scanQr')}</div>
      <div className="inline-block p-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-lg dark:bg-gray-800 dark:border-gray-700">
        <div className="text-xs font-mono text-gray-600 dark:text-gray-300 max-w-[200px] break-all">{shareUrl}</div>
      </div>
      <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">{t('share.qrHint')}</p>
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <Share2 className="w-5 h-5 text-blue-500" />
            <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">{t('share.title')}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:text-gray-200 dark:hover:bg-gray-700 transition-colors dark:text-gray-500"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5">
          {!share ? (
            <div className="space-y-5">
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-300 mb-1">
                  {t('share.fileLabel')}<span className="font-medium text-gray-800 dark:text-gray-100">{node.name}</span>
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('share.expiry')}</label>
                <div className="grid grid-cols-4 gap-2">
                  {EXPIRY_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setExpiry(opt.value)}
                      className={`py-2 rounded-xl text-sm font-medium border transition-colors ${
                        expiry === opt.value
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                      }`}
                    >
                      {t(opt.labelKey)}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('share.maxDownloads')}</label>
                <div className="grid grid-cols-4 gap-2">
                  {DOWNLOAD_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setMaxDownloadsType(opt.value)}
                      className={`py-2 rounded-xl text-sm font-medium border transition-colors ${
                        maxDownloadsType === opt.value
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                      }`}
                    >
                      {t(opt.labelKey)}
                    </button>
                  ))}
                </div>
                {maxDownloadsType === 'custom' && (
                  <input
                    type="number"
                    min={1}
                    max={10000}
                    step={1}
                    value={customDownloads}
                    onChange={(e) => setCustomDownloads(e.target.value.replace(/[^\d]/g, ''))}
                    className="mt-2 w-full border border-gray-300 dark:border-gray-600 rounded-xl px-4 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800"
                    placeholder={t('share.downloads.placeholder')}
                  />
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  {t('share.password')}
                  <span className="text-gray-400 dark:text-gray-500 font-normal ml-1.5">{t('share.optional')}</span>
                </label>
                <input
                  type="text"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t('share.passwordPlaceholder')}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-4 py-2.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800"
                />
              </div>

              {expiry === 'never' && !password.trim() && (
                <div className="rounded-xl border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/30 px-4 py-3 text-sm text-red-700 dark:text-red-300">
                  <div className="font-semibold mb-0.5">{t('share.warningTitle')}</div>
                  <div className="text-xs leading-relaxed">
                    {t('share.warningBody')}
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-1">
                <button
                  onClick={onClose}
                  className="px-4 py-2 rounded-xl text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-600 transition-colors dark:border-gray-700"
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={handleCreate}
                  disabled={submitting}
                  className="px-5 py-2 rounded-xl text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-sm"
                >
                  {submitting ? t('share.creating') : t('share.createBtn')}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-700 rounded-xl px-4 py-3">
                <p className="text-sm font-medium text-green-700 dark:text-green-300">{t('share.created')}</p>
                {share.expireAt && (
                  <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                    {t('share.expiresAt', { date: new Date(share.expireAt).toLocaleString(getLang() === 'en' ? 'en-US' : 'zh-CN') })}
                  </p>
                )}
                {share.hasPassword && (
                  <p className="text-xs text-green-600 dark:text-green-400 mt-0.5">{t('share.hasPassword')}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  <Link className="w-3.5 h-3.5 inline mr-1" />
                  {t('share.link')}
                </label>
                <div className="flex items-center gap-2">
                  <input
                    readOnly
                    value={shareUrl}
                    className="flex-1 border border-gray-200 dark:border-gray-600 rounded-xl px-4 py-2.5 text-sm bg-gray-50 dark:bg-gray-900 text-gray-700 dark:text-gray-200 font-mono truncate dark:text-gray-300 dark:border-gray-700"
                  />
                  <button
                    onClick={handleCopy}
                    className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                      copied
                        ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-700'
                        : 'bg-blue-600 text-white hover:bg-blue-700'
                    }`}
                  >
                    {copied ? (
                      <>
                        <Check className="w-4 h-4" />
                        {t('share.copied')}
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4" />
                        {t('share.copy')}
                      </>
                    )}
                  </button>
                </div>
              </div>

              <QRPlaceholder />

              <div className="flex justify-end pt-1">
                <button
                  onClick={onClose}
                  className="px-5 py-2 rounded-xl text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 transition-colors shadow-sm"
                >
                  {t('share.done')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
