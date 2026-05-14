import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Cloud, Eye, EyeOff, X, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { authApi, verificationApi } from '../api/client';
import { useAuthStore } from '../stores/auth.store';

// ── Forgot-password modal ─────────────────────────────────────────────────────

interface ForgotModalProps {
  onClose: () => void;
}

type ForgotStep = 'identify' | 'verify' | 'newpass';

function ForgotModal({ onClose }: ForgotModalProps) {
  const [step, setStep] = useState<ForgotStep>('identify');
  const [target, setTarget] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [sending, setSending] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const startCountdown = () => {
    setCountdown(60);
    const id = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) { clearInterval(id); return 0; }
        return prev - 1;
      });
    }, 1000);
  };

  const handleSendCode = async () => {
    if (!target.trim()) { toast.error('请输入邮箱或手机号'); return; }
    setSending(true);
    try {
      await verificationApi.sendCode(target.trim(), 'reset_password');
      toast.success('验证码已发送');
      startCountdown();
      setStep('verify');
    } catch {
      // error toast from interceptor
    } finally {
      setSending(false);
    }
  };

  const handleResend = async () => {
    if (countdown > 0) return;
    setSending(true);
    try {
      await verificationApi.sendCode(target.trim(), 'reset_password');
      toast.success('验证码已重新发送');
      startCountdown();
    } catch {
      // handled
    } finally {
      setSending(false);
    }
  };

  const handleSubmit = async () => {
    if (!code.trim()) { toast.error('请输入验证码'); return; }
    if (step === 'verify') { setStep('newpass'); return; }
    if (newPassword.length < 8) { toast.error('密码至少 8 位'); return; }
    if (newPassword !== confirmPassword) { toast.error('两次密码不一致'); return; }
    setSubmitting(true);
    try {
      // P1-F2: hit the dedicated /auth/reset-password endpoint instead of
      // the legacy login() call with a phantom `type: 'reset'` field.
      await authApi.resetPassword({ target, code, newPassword });
      toast.success('密码已重置，请重新登录');
      onClose();
    } catch {
      // handled
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="relative w-full max-w-md rounded-2xl bg-white dark:bg-gray-800 shadow-2xl p-8">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors dark:text-gray-500"
        >
          <X className="h-5 w-5" />
        </button>

        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-1 dark:text-gray-100">找回密码</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          {step === 'identify' && '输入您注册时使用的邮箱或手机号'}
          {step === 'verify' && `验证码已发送至 ${target}`}
          {step === 'newpass' && '设置您的新密码'}
        </p>

        <div className="space-y-4">
          {step === 'identify' && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">邮箱 / 手机号</label>
                <input
                  type="text"
                  value={target}
                  onChange={e => setTarget(e.target.value)}
                  placeholder="请输入邮箱或手机号"
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 transition dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500"
                  onKeyDown={e => e.key === 'Enter' && handleSendCode()}
                />
              </div>
              <button
                onClick={handleSendCode}
                disabled={sending}
                className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-medium transition disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {sending && <Loader2 className="h-4 w-4 animate-spin" />}
                发送验证码
              </button>
            </>
          )}

          {step === 'verify' && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">验证码</label>
                <input
                  type="text"
                  value={code}
                  onChange={e => setCode(e.target.value)}
                  placeholder="6 位验证码"
                  maxLength={6}
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500"
                />
              </div>
              <div className="flex gap-3">
                <button
                  onClick={handleResend}
                  disabled={countdown > 0 || sending}
                  className="flex-1 py-2.5 rounded-xl border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition disabled:opacity-60 dark:hover:bg-gray-700/50"
                >
                  {countdown > 0 ? `${countdown}s 后重发` : '重新发送'}
                </button>
                <button
                  onClick={handleSubmit}
                  className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-medium transition"
                >
                  下一步
                </button>
              </div>
            </>
          )}

          {step === 'newpass' && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">新密码</label>
                <div className="relative">
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    placeholder="至少 8 位"
                    className="w-full px-4 py-2.5 pr-11 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw(p => !p)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 dark:text-gray-500"
                  >
                    {showPw ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">确认新密码</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  placeholder="再次输入新密码"
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500"
                />
              </div>
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-medium transition disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                重置密码
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Login page ────────────────────────────────────────────────────────────────

export default function Login() {
  const navigate = useNavigate();
  const { setAuth, deriveMEK } = useAuthStore();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showForgot, setShowForgot] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identifier.trim()) { toast.error('请输入用户名、邮箱或手机号'); return; }
    if (!password) { toast.error('请输入密码'); return; }

    setLoading(true);
    try {
      const res = await authApi.login({ identifier: identifier.trim(), password }) as any;
      setAuth(res.user, res.accessToken, res.refreshToken, res.mekSalt, rememberMe);
      await deriveMEK(password);
      toast.success(`欢迎回来，${res.user.nickname || res.user.username}！`);
      navigate('/');
    } catch {
      // error toast from interceptor
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {showForgot && <ForgotModal onClose={() => setShowForgot(false)} />}

      <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-950 dark:bg-gray-900">
        {/* Blue gradient header strip */}
        <div className="h-1.5 bg-gradient-to-r from-blue-500 via-blue-600 to-indigo-600" />

        <div className="flex-1 flex items-center justify-center px-4 py-12">
          <div className="w-full max-w-md">
            {/* Logo + name */}
            <div className="text-center mb-8">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-lg shadow-blue-500/30 mb-4">
                <Cloud className="h-8 w-8 text-white" />
              </div>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white tracking-tight dark:text-gray-100">TG 云盘</h1>
              <p className="mt-1.5 text-sm text-gray-500 dark:text-gray-400">安全、私密的云端存储空间</p>
            </div>

            {/* Card */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl shadow-gray-200/60 dark:shadow-black/30 p-8">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-6 dark:text-gray-100">登录账号</h2>

              {/* P1-UX: explicit form name + each input gets id + name so Chrome /
                  Edge / Firefox password managers recognize the form and offer
                  account autofill (the popup with saved accounts next to the
                  username field). Pre-fix only autoComplete attrs were set, but
                  browsers also key off form name / input name for auto-fill. */}
              <form
                name="login"
                onSubmit={handleLogin}
                className="space-y-5"
                autoComplete="on"
                method="post"
                action="#"
              >
                {/* Identifier */}
                <div>
                  <label htmlFor="login-identifier" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                    用户名 / 手机号 / 邮箱
                  </label>
                  <input
                    id="login-identifier"
                    name="username"
                    type="text"
                    value={identifier}
                    onChange={e => setIdentifier(e.target.value)}
                    placeholder="请输入用户名、手机号或邮箱"
                    autoComplete="username"
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 transition text-sm dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500"
                  />
                </div>

                {/* Password */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label htmlFor="login-password" className="text-sm font-medium text-gray-700 dark:text-gray-300">密码</label>
                    <button
                      type="button"
                      onClick={() => setShowForgot(true)}
                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      忘记密码？
                    </button>
                  </div>
                  <div className="relative">
                    <input
                      id="login-password"
                      name="password"
                      type={showPw ? 'text' : 'password'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="请输入密码"
                      autoComplete="current-password"
                      className="w-full px-4 py-2.5 pr-11 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition text-sm dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw(p => !p)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition dark:text-gray-500"
                    >
                      {showPw ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                    </button>
                  </div>
                </div>

                {/* Remember me — P1-UX: explain what it does. Pre-fix the label
                    just read "记住我" so users couldn't tell what would happen
                    next: stay-logged-in across browser restart, or just a fancy
                    no-op. The hint below makes the behaviour explicit. */}
                <label className="flex items-start gap-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={e => setRememberMe(e.target.checked)}
                    className="w-4 h-4 mt-0.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 accent-blue-600 dark:border-gray-600"
                  />
                  <span className="flex-1 text-sm">
                    <span className="text-gray-700 dark:text-gray-200">记住我</span>
                    <span className="block text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                      {rememberMe
                        ? '勾选后关闭浏览器再打开仍保持登录'
                        : '未勾选则关闭浏览器后需重新登录（公共电脑推荐）'}
                    </span>
                  </span>
                </label>

                {/* Submit */}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-semibold shadow-md shadow-blue-500/25 transition disabled:opacity-60 flex items-center justify-center gap-2 text-sm"
                >
                  {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                  {loading ? '登录中…' : '登 录'}
                </button>
              </form>

              <div className="mt-6 pt-5 border-t border-gray-100 dark:border-gray-700 text-center text-sm text-gray-500 dark:text-gray-400">
                还没有账号？{' '}
                <Link to="/register" className="text-blue-600 dark:text-blue-400 font-medium hover:underline">
                  立即注册
                </Link>
              </div>
            </div>

            <p className="mt-6 text-center text-xs text-gray-400 dark:text-gray-600 dark:text-gray-500">
              登录即代表您同意我们的服务条款与隐私政策
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
