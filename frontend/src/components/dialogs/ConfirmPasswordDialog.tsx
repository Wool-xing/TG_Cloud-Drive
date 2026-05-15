import { useEffect, useState } from 'react';
import { AxiosError } from 'axios';
import { AlertTriangle, Eye, EyeOff, Loader2, X } from 'lucide-react';

interface ConfirmPasswordDialogProps {
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: (password: string) => Promise<void>;
  onClose: () => void;
}

/**
 * P1-I7: high-risk admin operations (deleteUser / forceLogout / role-or-status
 * change / admin deleteFile / system config update) require the admin to
 * re-type their own password. The backend returns structured `code` errors —
 * ADMIN_CONFIRM_REQUIRED / _INVALID / _LOCKED — and this dialog distinguishes
 * them so the user sees a precise message instead of a generic toast.
 */
export default function ConfirmPasswordDialog({
  title,
  description,
  confirmLabel = '确认',
  destructive = false,
  onConfirm,
  onClose,
}: ConfirmPasswordDialogProps) {
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) {
      setError('请输入管理员密码');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await onConfirm(password);
      onClose();
    } catch (err) {
      const ax = err as AxiosError<{ code?: string; message?: string }>;
      const code = ax?.response?.data?.code;
      const msg = ax?.response?.data?.message;
      if (code === 'ADMIN_CONFIRM_INVALID') {
        setError(msg ?? '管理员密码错误');
        setPassword('');
      } else if (code === 'ADMIN_CONFIRM_LOCKED') {
        setError(msg ?? '错误过多，请 15 分钟后再试');
        setLocked(true);
      } else if (code === 'ADMIN_CONFIRM_REQUIRED') {
        setError(msg ?? '危险操作需要再次输入管理员密码');
      } else {
        setError(msg ?? '操作失败，请稍后重试');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const themeBtn = destructive
    ? 'bg-red-600 hover:bg-red-700'
    : 'bg-blue-600 hover:bg-blue-700';
  const themeIconBg = destructive
    ? 'bg-red-100 dark:bg-red-900/40'
    : 'bg-blue-100 dark:bg-blue-900/40';
  const themeIcon = destructive
    ? 'text-red-600 dark:text-red-400'
    : 'text-blue-600 dark:text-blue-400';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-full ${themeIconBg} flex items-center justify-center`}>
              <AlertTriangle className={`w-5 h-5 ${themeIcon}`} />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors dark:text-gray-500 dark:hover:text-gray-200"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
            {description}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              管理员密码
            </label>
            <div className="relative">
              <input
                autoFocus
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(''); }}
                disabled={submitting || locked}
                className={`w-full border rounded-xl px-4 py-2.5 pr-10 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 transition-shadow disabled:opacity-50 ${
                  error
                    ? 'border-red-400 focus:ring-red-300'
                    : 'border-gray-300 dark:border-gray-600 focus:ring-blue-500'
                }`}
                placeholder="输入您的登录密码以确认"
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-200"
              >
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {error && <p className="text-xs text-red-500 dark:text-red-400">{error}</p>}

          <div className="flex justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={submitting || locked}
              className={`flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-medium text-white disabled:opacity-50 transition-colors shadow-sm ${themeBtn}`}
            >
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {locked ? '已锁定' : confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
