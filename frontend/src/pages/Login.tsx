import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Cloud, Eye, EyeOff, X, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { authApi, verificationApi } from '../api/client';
import { useAuthStore } from '../stores/auth.store';
import { t } from '../i18n/translations';

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
    if (!target.trim()) { toast.error(t('forgot.error.missingTarget')); return; }
    setSending(true);
    try {
      await verificationApi.sendCode(target.trim(), 'reset_password');
      toast.success(t('forgot.success.sendCode'));
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
      toast.success(t('forgot.success.resend'));
      startCountdown();
    } catch {
      // handled
    } finally {
      setSending(false);
    }
  };

  const handleSubmit = async () => {
    if (!code.trim()) { toast.error(t('forgot.error.missingCode')); return; }
    if (step === 'verify') { setStep('newpass'); return; }
    if (newPassword.length < 8) { toast.error(t('forgot.error.passwordTooShort')); return; }
    if (newPassword !== confirmPassword) { toast.error(t('forgot.error.passwordMismatch')); return; }
    setSubmitting(true);
    try {
      // P1-F2: hit the dedicated /auth/reset-password endpoint instead of
      // the legacy login() call with a phantom `type: 'reset'` field.
      await authApi.resetPassword({ target, code, newPassword });
      toast.success(t('forgot.success.reset'));
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

        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-1 dark:text-gray-100">{t('forgot.title')}</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          {step === 'identify' && t('forgot.identifyHint')}
          {step === 'verify' && t('forgot.codeSentTo', {target})}
          {step === 'newpass' && t('forgot.setNewPass')}
        </p>

        <div className="space-y-4">
          {step === 'identify' && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{t('forgot.emailPhone')}</label>
                <input
                  type="text"
                  value={target}
                  onChange={e => setTarget(e.target.value)}
                  placeholder={t('forgot.placeholderEmailPhone')}
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
                {t('forgot.sendCode')}
              </button>
            </>
          )}

          {step === 'verify' && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{t('forgot.verifyCode')}</label>
                <input
                  type="text"
                  value={code}
                  onChange={e => setCode(e.target.value)}
                  placeholder={t('forgot.placeholderCode')}
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
                  {countdown > 0 ? t('forgot.resendAfter', {s: countdown}) : t('forgot.resend')}
                </button>
                <button
                  onClick={handleSubmit}
                  className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-medium transition"
                >
                  {t('forgot.nextStep')}
                </button>
              </div>
            </>
          )}

          {step === 'newpass' && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{t('forgot.newPassword')}</label>
                <div className="relative">
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    placeholder={t('forgot.placeholderNewPw')}
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
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{t('forgot.confirmNewPassword')}</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  placeholder={t('forgot.placeholderConfirmPw')}
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500"
                />
              </div>
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-medium transition disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                {t('forgot.resetPassword')}
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

  // Handle OAuth callback: backend redirects to /login?accessToken=...&refreshToken=...
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const at = params.get('accessToken');
    const rt = params.get('refreshToken');
    if (at && rt) {
      // Store tokens and redirect to home (no MEK for OAuth users)
      localStorage.setItem('accessToken', at);
      localStorage.setItem('refreshToken', rt);
      // Clean up URL
      window.history.replaceState({}, '', '/login');
      toast.success(t('login.oauthSuccess'));
      navigate('/');
    }
  }, [navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identifier.trim()) { toast.error(t('login.error.missingIdentifier')); return; }
    if (!password) { toast.error(t('login.error.missingPassword')); return; }

    setLoading(true);
    try {
      const res = await authApi.login({ identifier: identifier.trim(), password }) as any;
      setAuth(res.user, res.accessToken, res.refreshToken, res.mekSalt, rememberMe);
      await deriveMEK(password);
      // P1-UX: tell the browser explicitly to remember this credential pair.
      // Pre-fix the call was gated on rememberMe — but rememberMe is about
      // long-lived refresh-token persistence, not browser password storage.
      // The browser's own "save password?" prompt is also gated by the user
      // anyway. We always offer the pair to the password manager; Chrome /
      // Edge then merges it with their own prompt so the next visit can
      // autofill both username AND password (pre-fix Chrome sometimes stored
      // only the username, breaking the autofill chain on the next login).
      if (typeof window !== 'undefined' && 'PasswordCredential' in window) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const PC = (window as any).PasswordCredential;
          const cred = new PC({
            id: identifier.trim(),
            password,
            name: res.user.nickname || res.user.username,
          });
          await (navigator as any).credentials.store(cred);
        } catch {
          // Safari / Firefox lack PasswordCredential — fall through silently,
          // autoComplete attrs still cover those browsers' weaker autofill.
        }
      }
      toast.success(t('login.welcomeBack', {name: res.user.nickname || res.user.username}));
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

      <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-950">
        {/* Blue gradient header strip */}
        <div className="h-1.5 bg-gradient-to-r from-blue-500 via-blue-600 to-indigo-600" />

        <div className="flex-1 flex items-center justify-center px-4 py-12">
          <div className="w-full max-w-md">
            {/* Logo + name */}
            <div className="text-center mb-8">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-lg shadow-blue-500/30 mb-4">
                <Cloud className="h-8 w-8 text-white" />
              </div>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white tracking-tight dark:text-gray-100">{t('app.name')}</h1>
              <p className="mt-1.5 text-sm text-gray-500 dark:text-gray-400">{t('app.tagline')}</p>
            </div>

            {/* Card */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl shadow-gray-200/60 dark:shadow-black/30 p-8">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-6 dark:text-gray-100">{t('login.title')}</h2>

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
                    {t('login.identifierLabel')}
                  </label>
                  <input
                    id="login-identifier"
                    name="username"
                    type="text"
                    value={identifier}
                    onChange={e => setIdentifier(e.target.value)}
                    placeholder={t('login.placeholderIdentifier')}
                    autoComplete="username"
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 transition text-sm dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500"
                  />
                </div>

                {/* Password */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label htmlFor="login-password" className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('login.password')}</label>
                    <button
                      type="button"
                      onClick={() => setShowForgot(true)}
                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      {t('login.forgotPassword')}
                    </button>
                  </div>
                  <div className="relative">
                    <input
                      id="login-password"
                      name="password"
                      type={showPw ? 'text' : 'password'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder={t('login.placeholderPassword')}
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
                    <span className="text-gray-700 dark:text-gray-200">{t('login.rememberMe')}</span>
                    <span className="block text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                      {rememberMe
                        ? t('login.rememberMeOn')
                        : t('login.rememberMeOff')}
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
                  {loading ? t('login.submitting') : t('login.submit')}
                </button>
              </form>

              {/* OAuth buttons */}
              <div className="mt-5 space-y-2">
                <a
                  href="/api/oauth/google"
                  className="flex items-center justify-center gap-2 w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
                  {t('login.googleLogin')}
                </a>
                <a
                  href="/api/oauth/github"
                  className="flex items-center justify-center gap-2 w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
                  {t('login.githubLogin')}
                </a>
              </div>

              <div className="mt-5 pt-5 border-t border-gray-100 dark:border-gray-700 text-center text-sm text-gray-500 dark:text-gray-400">
                {t('login.noAccount')}{' '}
                <Link to="/register" className="text-blue-600 dark:text-blue-400 font-medium hover:underline">
                  {t('login.registerNow')}
                </Link>
              </div>
            </div>

            <p className="mt-6 text-center text-xs text-gray-400 dark:text-gray-600 dark:text-gray-500">
              {t('login.agreeTerms')}
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
