import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, Eye, EyeOff, ShieldAlert, Loader2 } from 'lucide-react';
import { useAuthStore } from '../stores/auth.store';
import { usersApi } from '../api/client';
import DrivePage from '../pages/Drive';

// P1-F17 + P1-F18: in-memory session token storage.
const SESSION_TTL_MS = 30 * 60 * 1000;
let __memToken__: string | null = null;
let __memUnlockedAt__: number = 0;

function isSessionValid(): boolean {
  if (!__memToken__) return false;
  if (Date.now() - __memUnlockedAt__ > SESSION_TTL_MS) {
    __memToken__ = null;
    __memUnlockedAt__ = 0;
    return false;
  }
  return true;
}

export default function PrivateSpaceGate() {
  const user = useAuthStore(s => s.user);
  const setUser = useAuthStore(s => s.setUser);
  const navigate = useNavigate();

  const [unlocked, setUnlocked] = useState(isSessionValid);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Server-authoritative probe: hasPrivateSpace from auth store may be stale
  // (login response doesn't include it). Probe backend on mount.
  const [probing, setProbing] = useState(true);
  const [hasPrivateSpace, setHasPrivateSpace] = useState<boolean | null>(null);

  useEffect(() => {
    if (!user) { navigate('/login', { replace: true }); return; }
    (async () => {
      try {
        const res = await usersApi.profile() as any;
        const hasPS = typeof res?.hasPrivateSpace === 'boolean' ? res.hasPrivateSpace : false;
        setHasPrivateSpace(hasPS);
        if (hasPS && !user.hasPrivateSpace) {
          setUser({ ...user, hasPrivateSpace: true });
        }
      } catch {
        setHasPrivateSpace(false);
      } finally {
        setProbing(false);
      }
    })();
  }, [user, navigate, setUser]);

  if (!user) return null;

  if (probing) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (hasPrivateSpace === false) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-6 text-gray-500 dark:text-gray-400 p-8">
        <div className="w-20 h-20 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center dark:bg-gray-700">
          <ShieldAlert className="w-10 h-10 text-gray-400 dark:text-gray-500" />
        </div>
        <div className="text-center">
          <p className="text-lg font-medium text-gray-700 dark:text-gray-200 dark:text-gray-300">尚未设置隐私空间密码</p>
          <p className="mt-1 text-sm">请前往「个人资料」页面设置隐私空间密码后再访问</p>
        </div>
        <button
          onClick={() => navigate('/profile?tab=security#private-space')}
          className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          前往设置
        </button>
      </div>
    );
  }

  if (unlocked) {
    return <DrivePage isPrivate />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setLoading(true);
    setError('');
    try {
      const res = await usersApi.verifyPrivateSpace(password) as any;
      const token = res?.sessionToken;
      if (token) {
        // F17/F18: in-memory only; no sessionStorage write.
        __memToken__ = token;
        __memUnlockedAt__ = Date.now();
        setUnlocked(true);
      } else {
        setError('验证失败，请重试');
      }
    } catch {
      setError('密码错误');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center h-full p-8">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center mx-auto mb-4">
            <Lock className="w-8 h-8 text-blue-600 dark:text-blue-400" />
          </div>
          <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-100">隐私空间</h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">请输入密码以访问隐私空间</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={e => { setPassword(e.target.value); setError(''); }}
              placeholder="请输入隐私空间密码"
              autoFocus
              className="w-full px-4 py-3 pr-10 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 transition"
            />
            <button
              type="button"
              onClick={() => setShowPassword(v => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 dark:text-gray-500 dark:hover:text-gray-200"
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>

          {error && (
            <p className="text-sm text-red-500 dark:text-red-400 text-center">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || !password}
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-xl transition-colors"
          >
            {loading ? '验证中…' : '进入隐私空间'}
          </button>
        </form>
      </div>
    </div>
  );
}
