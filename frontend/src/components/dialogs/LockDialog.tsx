import { useEffect, useState } from 'react';
import { X, Lock, Unlock, Eye, EyeOff } from 'lucide-react';
import toast from 'react-hot-toast';
import { filesApi } from '../../api/client';
import { Node } from '../../types';
import { t } from '../../i18n/translations';

interface LockDialogProps {
  node: Node;
  onClose: () => void;
  onSuccess: () => void;
}

export default function LockDialog({ node, onClose, onSuccess }: LockDialogProps) {
  const isLocked = node.isLocked;
  const itemLabel = node.type === 'folder' ? t('lock.folder') : t('lock.file');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const validate = (): boolean => {
    if (!password) {
      setError(t('lock.error.empty'));
      return false;
    }
    if (!isLocked) {
      if (password.length < 6) {
        setError(t('lock.error.tooShort'));
        return false;
      }
      if (password !== confirmPassword) {
        setError(t('lock.error.mismatch'));
        return false;
      }
    }
    setError('');
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    try {
      if (isLocked) {
        await filesApi.removeLock(node.id, password);
        toast.success(t('lock.success.unlock', { item: itemLabel }));
      } else {
        await filesApi.setLock(node.id, password);
        toast.success(t('lock.success.lock', { item: itemLabel }));
      }
      onSuccess();
    } catch {
      if (isLocked) {
        setError(t('lock.error.wrong'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700">
          <div className="flex items-center gap-2">
            {isLocked ? (
              <Unlock className="w-5 h-5 text-orange-500" />
            ) : (
              <Lock className="w-5 h-5 text-blue-500" />
            )}
            <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">
              {isLocked ? t('lock.unlockTitle', { item: itemLabel }) : t('lock.lockTitle', { item: itemLabel })}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:text-gray-200 dark:hover:bg-gray-700 transition-colors dark:text-gray-500"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div className={`rounded-xl p-3 text-sm ${
            isLocked
              ? 'bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300'
              : 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
          }`}>
            <span className="break-all">
            {isLocked
              ? t('lock.unlockDesc', { item: itemLabel, name: node.name })
              : t('lock.lockDesc', { item: itemLabel, name: node.name })}
            </span>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              {isLocked ? t('lock.currentPassword') : t('lock.setPassword')}
            </label>
            <div className="relative">
              <input
                autoFocus
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(''); }}
                className={`w-full border rounded-xl px-4 py-2.5 pr-10 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 transition-shadow ${
                  error ? 'border-red-400 focus:ring-red-300' : 'border-gray-300 dark:border-gray-600 focus:ring-blue-500'
                }`}
                placeholder={isLocked ? t('lock.placeholderCurrent') : t('lock.placeholderNew')}
                disabled={submitting}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 dark:text-gray-500"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {!isLocked && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{t('lock.confirmPassword')}</label>
              <div className="relative">
                <input
                  type={showConfirm ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => { setConfirmPassword(e.target.value); setError(''); }}
                  className={`w-full border rounded-xl px-4 py-2.5 pr-10 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 transition-shadow ${
                    error ? 'border-red-400 focus:ring-red-300' : 'border-gray-300 dark:border-gray-600 focus:ring-blue-500'
                  }`}
                  placeholder={t('lock.placeholderConfirm')}
                  disabled={submitting}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm(!showConfirm)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 dark:text-gray-500"
                >
                  {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          )}

          {error && <p className="text-xs text-red-500 dark:text-red-400">{error}</p>}

          <div className="flex justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-600 transition-colors dark:border-gray-700"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className={`px-5 py-2 rounded-xl text-sm font-medium text-white disabled:opacity-50 transition-colors shadow-sm ${
                isLocked
                  ? 'bg-orange-500 hover:bg-orange-600'
                  : 'bg-blue-600 hover:bg-blue-700'
              }`}
            >
              {submitting ? t('lock.processing') : isLocked ? t('lock.unlockBtn') : t('lock.lockBtn')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
