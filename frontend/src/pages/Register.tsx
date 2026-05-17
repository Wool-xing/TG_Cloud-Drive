import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Cloud, Eye, EyeOff, Loader2, Phone, Mail } from 'lucide-react';
import toast from 'react-hot-toast';
import { authApi, verificationApi } from '../api/client';
import { t } from '../i18n/translations';

// ── Password strength ─────────────────────────────────────────────────────────

function getPasswordStrength(pw: string): { score: number; label: string; color: string } {
  if (!pw) return { score: 0, label: '', color: '' };
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;

  if (score <= 1) return { score: 1, label: t('pwdStrength.weak'), color: 'bg-red-500' };
  if (score <= 3) return { score: 2, label: t('pwdStrength.medium'), color: 'bg-yellow-400' };
  return { score: 3, label: t('pwdStrength.strong'), color: 'bg-green-500' };
}

function PasswordStrengthBar({ password }: { password: string }) {
  const { score, label, color } = getPasswordStrength(password);
  if (!password) return null;
  return (
    <div className="mt-2">
      <div className="flex gap-1 mb-1">
        {[1, 2, 3].map(i => (
          <div
            key={i}
            className={`flex-1 h-1.5 rounded-full transition-all duration-300 ${i <= score ? color : 'bg-gray-200 dark:bg-gray-600'}`}
          />
        ))}
      </div>
      <p className={`text-xs font-medium ${score === 1 ? 'text-red-500' : score === 2 ? 'text-yellow-500' : 'text-green-500'}`}>
        {t('pwdStrength.label', {label})}
      </p>
    </div>
  );
}

// ── Register page ─────────────────────────────────────────────────────────────

export default function Register() {
  const navigate = useNavigate();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [contactType, setContactType] = useState<'email' | 'phone'>('email');
  const [contact, setContact] = useState('');
  const [code, setCode] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const startCountdown = () => {
    setCountdown(60);
    const id = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) { clearInterval(id); return 0; }
        return prev - 1;
      });
    }, 1000);
  };

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!username.trim()) errs.username = t('register.error.usernameRequired');
    else if (username.trim().length < 3) errs.username = t('register.error.usernameMinLength');
    else if (!/^[a-zA-Z0-9_]+$/.test(username.trim())) errs.username = t('register.error.usernameFormat');

    if (!password) errs.password = t('register.error.passwordRequired');
    else if (password.length < 8) errs.password = t('register.error.passwordMinLength');

    if (!confirmPassword) errs.confirmPassword = t('register.error.confirmPasswordRequired');
    else if (password !== confirmPassword) errs.confirmPassword = t('register.error.passwordMismatch');

    if (!contact.trim()) errs.contact = t('register.error.contactRequired', {type: contactType === 'email' ? t('register.email') : t('register.phone')});
    if (!code.trim()) errs.code = t('register.error.codeRequired');

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSendCode = async () => {
    if (!contact.trim()) {
      setErrors(e => ({ ...e, contact: t('register.error.contactRequired', {type: contactType === 'email' ? t('register.email') : t('register.phone')}) }));
      return;
    }
    setSending(true);
    try {
      await verificationApi.sendCode(contact.trim(), 'register');
      toast.success(t('register.codeSent'));
      startCountdown();
      setErrors(e => { const n = { ...e }; delete n.contact; return n; });
    } catch {
      // handled
    } finally {
      setSending(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setLoading(true);
    try {
      await authApi.register({
        username: username.trim(),
        password,
        [contactType]: contact.trim(),
        code: code.trim(),
      });
      toast.success(t('register.success'));
      navigate('/login');
    } catch {
      // handled
    } finally {
      setLoading(false);
    }
  };

  const inputCls = (field: string) =>
    `w-full px-4 py-2.5 rounded-xl border ${errors[field] ? 'border-red-400 focus:ring-red-400' : 'border-gray-300 dark:border-gray-600 focus:ring-blue-500'} bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 transition text-sm`;

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-950">
      <div className="h-1.5 bg-gradient-to-r from-blue-500 via-blue-600 to-indigo-600" />

      <div className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          {/* Logo */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-lg shadow-blue-500/30 mb-4">
              <Cloud className="h-8 w-8 text-white" />
            </div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white tracking-tight dark:text-gray-100">TG 云盘</h1>
            <p className="mt-1.5 text-sm text-gray-500 dark:text-gray-400">{t('register.tagline')}</p>
          </div>

          {/* Card */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl shadow-gray-200/60 dark:shadow-black/30 p-8">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-6 dark:text-gray-100">{t('register.title')}</h2>

            <form onSubmit={handleRegister} className="space-y-4" noValidate>
              {/* Username */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{t('register.username')}</label>
                <input
                  type="text"
                  value={username}
                  onChange={e => { setUsername(e.target.value); setErrors(v => { const n={...v}; delete n.username; return n; }); }}
                  placeholder={t('register.placeholderUsername')}
                  autoComplete="username"
                  className={inputCls('username')}
                />
                {errors.username && <p className="mt-1 text-xs text-red-500">{errors.username}</p>}
              </div>

              {/* Password */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{t('register.password')}</label>
                <div className="relative">
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={password}
                    onChange={e => { setPassword(e.target.value); setErrors(v => { const n={...v}; delete n.password; return n; }); }}
                    placeholder={t('register.placeholderPassword')}
                    autoComplete="new-password"
                    className={`${inputCls('password')} pr-11`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw(p => !p)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition dark:text-gray-500"
                  >
                    {showPw ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
                <PasswordStrengthBar password={password} />
                {errors.password && <p className="mt-1 text-xs text-red-500">{errors.password}</p>}
              </div>

              {/* Confirm password */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{t('register.confirmPassword')}</label>
                <div className="relative">
                  <input
                    type={showConfirmPw ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={e => { setConfirmPassword(e.target.value); setErrors(v => { const n={...v}; delete n.confirmPassword; return n; }); }}
                    placeholder={t('register.placeholderConfirmPw')}
                    autoComplete="new-password"
                    className={`${inputCls('confirmPassword')} pr-11`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPw(p => !p)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition dark:text-gray-500"
                  >
                    {showConfirmPw ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
                {errors.confirmPassword && <p className="mt-1 text-xs text-red-500">{errors.confirmPassword}</p>}
              </div>

              {/* Contact type toggle */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    {contactType === 'email' ? t('register.email') : t('register.phone')}
                  </label>
                  <button
                    type="button"
                    onClick={() => { setContactType(t => t === 'email' ? 'phone' : 'email'); setContact(''); setErrors(v => { const n={...v}; delete n.contact; return n; }); }}
                    className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    {contactType === 'email'
                      ? <><Phone className="h-3.5 w-3.5" />{t('register.switchToPhone')}</>
                      : <><Mail className="h-3.5 w-3.5" />{t('register.switchToEmail')}</>
                    }
                  </button>
                </div>
                <input
                  type={contactType === 'email' ? 'email' : 'tel'}
                  value={contact}
                  onChange={e => { setContact(e.target.value); setErrors(v => { const n={...v}; delete n.contact; return n; }); }}
                  placeholder={contactType === 'email' ? 'example@mail.com' : '13800000000'}
                  className={inputCls('contact')}
                />
                {errors.contact && <p className="mt-1 text-xs text-red-500">{errors.contact}</p>}
              </div>

              {/* Verification code */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{t('register.verifyCode')}</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={code}
                    onChange={e => { setCode(e.target.value); setErrors(v => { const n={...v}; delete n.code; return n; }); }}
                    placeholder={t('register.placeholderCode')}
                    maxLength={6}
                    className={`${inputCls('code')} flex-1`}
                  />
                  <button
                    type="button"
                    onClick={handleSendCode}
                    disabled={countdown > 0 || sending}
                    className="shrink-0 px-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition disabled:opacity-60 whitespace-nowrap flex items-center gap-1.5 dark:hover:bg-gray-700/50"
                  >
                    {sending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    {countdown > 0 ? `${countdown}s` : t('register.sendCode')}
                  </button>
                </div>
                {errors.code && <p className="mt-1 text-xs text-red-500">{errors.code}</p>}
              </div>

              {/* Submit */}
              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-semibold shadow-md shadow-blue-500/25 transition disabled:opacity-60 flex items-center justify-center gap-2 text-sm mt-2"
              >
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                {loading ? t('register.submitting') : t('register.submit')}
              </button>
            </form>

            <div className="mt-6 pt-5 border-t border-gray-100 dark:border-gray-700 text-center text-sm text-gray-500 dark:text-gray-400">
              {t('register.hasAccount')}{' '}
              <Link to="/login" className="text-blue-600 dark:text-blue-400 font-medium hover:underline">
                {t('register.loginNow')}
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
