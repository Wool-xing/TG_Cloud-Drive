import { useEffect, useState } from 'react';
import { X, Lock, Unlock, Eye, EyeOff } from 'lucide-react';
import toast from 'react-hot-toast';
import { filesApi } from '../../api/client';
import { Node } from '../../types';

interface LockDialogProps {
  node: Node;
  onClose: () => void;
  onSuccess: () => void;
}

export default function LockDialog({ node, onClose, onSuccess }: LockDialogProps) {
  const isLocked = node.isLocked;
  const itemLabel = node.type === 'folder' ? '文件夹' : '文件';
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const validate = (): boolean => {
    if (!password) {
      setError('请输入密码');
      return false;
    }
    if (!isLocked) {
      if (password.length < 4) {
        setError('密码至少 4 个字符');
        return false;
      }
      if (password !== confirmPassword) {
        setError('两次密码输入不一致');
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
        await filesApi.verifyLock(node.id, password);
        toast.success(`${itemLabel}已解锁`);
      } else {
        await filesApi.setLock(node.id, password);
        toast.success(`${itemLabel}已加密锁定`);
      }
      onSuccess();
    } catch {
      if (isLocked) {
        setError('密码错误，请重试');
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
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            {isLocked ? (
              <Unlock className="w-5 h-5 text-orange-500" />
            ) : (
              <Lock className="w-5 h-5 text-blue-500" />
            )}
            <h2 className="text-lg font-semibold text-gray-800">
              {isLocked ? `解锁${itemLabel}` : `加密锁定${itemLabel}`}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {/* Description */}
          <div className={`rounded-xl p-3 text-sm ${
            isLocked ? 'bg-orange-50 text-orange-700' : 'bg-blue-50 text-blue-700'
          }`}>
            {isLocked
              ? `输入锁定密码以解锁${itemLabel} "${node.name}"`
              : `为${itemLabel} "${node.name}" 设置访问密码，访问时需要输入密码`}
          </div>

          {/* Password input */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              {isLocked ? '当前密码' : '设置密码'}
            </label>
            <div className="relative">
              <input
                autoFocus
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(''); }}
                className={`w-full border rounded-xl px-4 py-2.5 pr-10 text-sm focus:outline-none focus:ring-2 transition-shadow ${
                  error ? 'border-red-400 focus:ring-red-300' : 'border-gray-300 focus:ring-blue-500'
                }`}
                placeholder={isLocked ? '输入锁定密码' : '至少 4 个字符'}
                disabled={submitting}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Confirm password (only when locking) */}
          {!isLocked && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">确认密码</label>
              <div className="relative">
                <input
                  type={showConfirm ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => { setConfirmPassword(e.target.value); setError(''); }}
                  className={`w-full border rounded-xl px-4 py-2.5 pr-10 text-sm focus:outline-none focus:ring-2 transition-shadow ${
                    error ? 'border-red-400 focus:ring-red-300' : 'border-gray-300 focus:ring-blue-500'
                  }`}
                  placeholder="再次输入密码"
                  disabled={submitting}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm(!showConfirm)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          )}

          {/* Error */}
          {error && <p className="text-xs text-red-500">{error}</p>}

          {/* Footer */}
          <div className="flex justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-100 border border-gray-200 transition-colors"
            >
              取消
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
              {submitting ? '处理中…' : isLocked ? '解锁' : '确认锁定'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
