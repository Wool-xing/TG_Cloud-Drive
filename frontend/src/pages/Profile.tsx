import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  User,
  Shield,
  Monitor,
  ClipboardList,
  BarChart2,
  Eye,
  EyeOff,
  Loader2,
  Trash2,
  CheckCircle,
  AlertTriangle,
  Bell,
  BellOff,
  LogOut,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import toast from 'react-hot-toast';

import { usersApi } from '../api/client';
import { useAuthStore } from '../stores/auth.store';
import { formatBytes } from '../utils/crypto';
import { t } from '../i18n/translations';

// P1-F1: hoisted out of SecurityTab. Pre-fix this component was defined
// inside the function body, so React saw a fresh function identity on every
// parent render — unmount/remount the <input>, losing focus on every keystroke.
// Moving the declaration to module scope keeps the component identity stable.
function PwInput({
  label,
  value,
  show,
  placeholder,
  onChange,
  onToggle,
  autoComplete,
}: {
  label: string;
  value: string;
  show: boolean;
  placeholder?: string;
  onChange: (v: string) => void;
  onToggle: () => void;
  autoComplete?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-gray-300">{label}</label>
      <div className="relative">
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          className="w-full px-3 py-2 pr-10 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          type="button"
          onClick={onToggle}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-200"
        >
          {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}
import { AuditLog } from '../types';

type Tab = 'profile' | 'security' | 'devices' | 'logs' | 'storage';

interface Device {
  id: string;
  deviceName: string;
  ipAddress: string;
  lastActiveAt: string;
  isCurrent: boolean;
  userAgent?: string;
}

interface StorageStats {
  usedBytes: number;
  quotaBytes: number;
  byType: Array<{ type: string; label: string; bytes: number; color: string }>;
}

function formatDate(d: string) {
  return new Date(d).toLocaleString('zh-CN', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// ── Letter Avatar ──────────────────────────────────────────────
function LetterAvatar({ name, size = 'lg' }: { name: string; size?: 'sm' | 'lg' }) {
  const letter = (name?.[0] ?? '?').toUpperCase();
  const colors = ['bg-blue-500', 'bg-purple-500', 'bg-green-500', 'bg-orange-500', 'bg-pink-500', 'bg-teal-500'];
  const color = colors[letter.charCodeAt(0) % colors.length];
  const cls = size === 'lg' ? 'w-20 h-20 text-3xl' : 'w-8 h-8 text-sm';
  return (
    <div className={`${cls} ${color} rounded-full flex items-center justify-center text-white font-bold`}>
      {letter}
    </div>
  );
}

// ── Tabs ───────────────────────────────────────────────────────
const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'profile', label: t('profile.tabs.basic'), icon: <User className="w-4 h-4" /> },
  { id: 'security', label: t('profile.tabs.security'), icon: <Shield className="w-4 h-4" /> },
  { id: 'devices', label: t('profile.tabs.devices'), icon: <Monitor className="w-4 h-4" /> },
  { id: 'logs', label: t('profile.tabs.logs'), icon: <ClipboardList className="w-4 h-4" /> },
  { id: 'storage', label: t('profile.tabs.storage'), icon: <BarChart2 className="w-4 h-4" /> },
];

// ── Profile Tab ────────────────────────────────────────────────
function ProfileTab() {
  const { user, setUser } = useAuthStore();
  const [username, setUsername] = useState(user?.username ?? '');
  const [saving, setSaving] = useState(false);
  const [boundEmail, setBoundEmail] = useState<string | null>(null);
  // Server-authoritative flag (decrypted-email fallback proof). A11 dialog
  // uses this to decide single- vs dual-factor — never `email != null`
  // since decrypt can silently null the field while the email is bound.
  const [hasEmail, setHasEmail] = useState<boolean | null>(null);
  const [boundPhone, setBoundPhone] = useState<string | null>(null);
  const [hasPhone, setHasPhone] = useState<boolean | null>(null);
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [phoneDialogOpen, setPhoneDialogOpen] = useState(false);

  const refreshProfile = async () => {
    try {
      const res = (await usersApi.profile()) as any;
      setBoundEmail(res?.email ?? null);
      setHasEmail(typeof res?.hasEmail === 'boolean' ? res.hasEmail : !!res?.email);
      setBoundPhone(res?.phone ?? null);
      setHasPhone(typeof res?.hasPhone === 'boolean' ? res.hasPhone : !!res?.phone);
    } catch {
      // interceptor — leave flags null so dialogs show explicit
      // "profile load failed" hint rather than silently downgrading.
    }
  };

  useEffect(() => {
    refreshProfile();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await usersApi.updateProfile({ username }) as any;
      setUser(res ?? { ...user!, username });
      toast.success(t('profile.saved'));
    } catch {
      // interceptor
    } finally {
      setSaving(false);
    }
  };

  const handleEmailBound = (newEmail: string) => {
    setBoundEmail(newEmail);
    setHasEmail(true);
    setEmailDialogOpen(false);
    // Re-pull server-side to pick up any normalization the backend applied
    // (e.g. lowercased domain) so the displayed string matches the stored one.
    refreshProfile();
  };

  const handlePhoneBound = (newPhone: string) => {
    setBoundPhone(newPhone);
    setHasPhone(true);
    setPhoneDialogOpen(false);
    refreshProfile();
  };

  if (!user) return null;

  return (
    <div className="space-y-6 max-w-lg">
      {/* Avatar */}
      <div className="flex items-center gap-6">
        <LetterAvatar name={user.username} size="lg" />
        <div>
          <p className="font-semibold text-gray-900 text-lg dark:text-gray-100">{user.username}</p>
          <span className={`inline-block mt-1 px-2 py-0.5 text-xs rounded-full font-medium ${
            user.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
          }`}>
            {user.role === 'admin' ? t('profile.role.admin') : t('profile.role.user')}
          </span>
        </div>
      </div>

      {/* Form */}
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-gray-300">{t('profile.username')}</label>
          <input
            type="text"
            value={username}
            onChange={e => setUsername(e.target.value)}
            placeholder={t('profile.placeholderUsername')}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600"
          />
          <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">{t('profile.usernameChangeHint')}</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-gray-300">{t('profile.email')}</label>
          <div className="flex items-center gap-2">
            <input
              type="email"
              value={boundEmail ?? ''}
              readOnly
              placeholder={t('profile.placeholderEmail')}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm bg-gray-50 text-gray-700 dark:border-gray-600 dark:bg-gray-700/50 dark:text-gray-300"
            />
            <button
              type="button"
              onClick={() => setEmailDialogOpen(true)}
              className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium rounded-lg transition-colors dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-gray-200 whitespace-nowrap"
            >
              {boundEmail ? t('profile.boundEmail') : t('profile.bindEmail')}
            </button>
          </div>
          <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
            {boundEmail ? t('profile.emailBoundHint') : t('profile.emailNotBoundHint')}
          </p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-gray-300">{t('profile.phone')}</label>
          <div className="flex items-center gap-2">
            <input
              type="tel"
              value={boundPhone ?? ''}
              readOnly
              placeholder={t('profile.placeholderPhone')}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm bg-gray-50 text-gray-700 dark:border-gray-600 dark:bg-gray-700/50 dark:text-gray-300"
            />
            <button
              type="button"
              onClick={() => setPhoneDialogOpen(true)}
              className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium rounded-lg transition-colors dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-gray-200 whitespace-nowrap"
            >
              {hasPhone ? t('profile.boundPhone') : t('profile.bindPhone')}
            </button>
          </div>
          <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
            {hasPhone ? t('profile.phoneBoundHint') : t('profile.phoneNotBoundHint')}
          </p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-gray-300">{t('profile.storageUsed')}</label>
          <div className="flex items-center gap-3">
            <div className="flex-1 bg-gray-200 rounded-full h-2 dark:bg-gray-700">
              <div
                className="bg-blue-500 h-2 rounded-full transition-all"
                style={{ width: `${Math.min(100, (user.usedBytes / user.quotaBytes) * 100)}%` }}
              />
            </div>
            <span className="text-xs text-gray-500 whitespace-nowrap dark:text-gray-400">
              {formatBytes(user.usedBytes)} / {formatBytes(user.quotaBytes)}
            </span>
          </div>
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
        >
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          {t('profile.save')}
        </button>
      </div>

      {emailDialogOpen && (
        <BindEmailDialog
          currentEmail={boundEmail}
          hasEmail={hasEmail}
          onCancel={() => setEmailDialogOpen(false)}
          onBound={handleEmailBound}
        />
      )}
      {phoneDialogOpen && (
        <BindPhoneDialog
          currentPhone={boundPhone}
          hasPhone={hasPhone}
          onCancel={() => setPhoneDialogOpen(false)}
          onBound={handlePhoneBound}
        />
      )}
    </div>
  );
}

// ── Bind Phone Dialog ─────────────────────────────────────────
// Parallel to BindEmailDialog. Lives here (not extracted) because the two
// dialogs share zero state and the duplication is small enough that an
// abstraction would hide more than it helps.
function BindPhoneDialog(props: {
  currentPhone: string | null;
  hasPhone: boolean | null;
  onCancel: () => void;
  onBound: (newPhone: string) => void;
}) {
  const { currentPhone, hasPhone, onCancel, onBound } = props;
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [oldCode, setOldCode] = useState('');
  const [sending, setSending] = useState(false);
  const [sendingOld, setSendingOld] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [oldCountdown, setOldCountdown] = useState(0);

  useEffect(() => {
    if (countdown <= 0) return;
    const t = window.setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => window.clearTimeout(t);
  }, [countdown]);

  useEffect(() => {
    if (oldCountdown <= 0) return;
    const t = window.setTimeout(() => setOldCountdown(c => c - 1), 1000);
    return () => window.clearTimeout(t);
  }, [oldCountdown]);

  // Mainland CN mobile only — class-validator IsMobilePhone('zh-CN').
  const validPhone = /^1[3-9]\d{9}$/.test(phone);
  const needOldCode = hasPhone === true;
  const probeFailed = hasPhone === null && !currentPhone;

  const handleSend = async () => {
    if (!validPhone) {
      toast.error(t('bindPhone.error.invalidPhone'));
      return;
    }
    if (currentPhone && currentPhone === phone) {
      toast.error(t('bindPhone.error.samePhone'));
      return;
    }
    setSending(true);
    try {
      await usersApi.sendBindPhoneCode(phone);
      toast.success(t('bindPhone.codeSent'));
      setCountdown(60);
    } catch {
      // interceptor
    } finally {
      setSending(false);
    }
  };

  const handleSendOld = async () => {
    setSendingOld(true);
    try {
      await usersApi.sendBindPhoneOldCode();
      toast.success(t('bindPhone.sentToCurrent'));
      setOldCountdown(60);
    } catch {
      // interceptor
    } finally {
      setSendingOld(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validPhone || code.length !== 6) return;
    if (needOldCode && oldCode.length !== 6) {
      toast.error(t('bindPhone.error.oldCodeRequired'));
      return;
    }
    setSubmitting(true);
    try {
      await usersApi.bindPhone({
        phone,
        code,
        ...(needOldCode ? { oldPhoneCode: oldCode } : {}),
      });
      toast.success(currentPhone ? t('bindPhone.success') : t('bindPhone.successNew'));
      onBound(phone);
    } catch {
      // interceptor
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md mx-4 rounded-lg bg-white p-6 shadow-xl dark:bg-gray-800">
        <h3 className="text-base font-semibold text-gray-900 mb-4 dark:text-gray-100">
          {currentPhone ? t('bindPhone.title') : t('bindPhone.titleNew')}
        </h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-gray-300">{t('bindPhone.newPhone')}</label>
            <input
              type="tel"
              inputMode="numeric"
              value={phone}
              onChange={e => setPhone(e.target.value.replace(/\D/g, '').slice(0, 11))}
              autoComplete="tel"
              placeholder={t('bindPhone.placeholderPhone')}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-gray-300">{t('bindPhone.code')}</label>
            <div className="flex gap-2">
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder={t('security.placeholderEmailCode')}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
              />
              <button
                type="button"
                onClick={handleSend}
                disabled={sending || countdown > 0 || !validPhone}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-gray-200 whitespace-nowrap"
              >
                {sending && <Loader2 className="w-4 h-4 animate-spin inline mr-1" />}
                {countdown > 0 ? t('security.resendAfter', { s: countdown }) : t('bindPhone.sendCode')}
              </button>
            </div>
          </div>
          {probeFailed && (
            <p className="text-xs text-red-600 dark:text-red-400">
              {t('bindPhone.probeFailed')}
            </p>
          )}
          {needOldCode && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-gray-300">{t('bindPhone.oldCode')}</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={oldCode}
                  onChange={e => setOldCode(e.target.value.replace(/\D/g, ''))}
                  placeholder={t('security.placeholderEmailCode')}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                />
                <button
                  type="button"
                  onClick={handleSendOld}
                  disabled={sendingOld || oldCountdown > 0}
                  className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-gray-200 whitespace-nowrap"
                >
                  {sendingOld && <Loader2 className="w-4 h-4 animate-spin inline mr-1" />}
                  {oldCountdown > 0 ? t('security.resendAfter', { s: oldCountdown }) : t('bindPhone.sendToCurrent')}
                </button>
              </div>
              <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">将发送到 {currentPhone}（双重验证防接管）</p>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg dark:text-gray-300 dark:hover:bg-gray-700"
            >
              {t('bindPhone.cancel')}
            </button>
            <button
              type="submit"
              disabled={
                submitting ||
                probeFailed ||
                !validPhone ||
                code.length !== 6 ||
                (needOldCode && oldCode.length !== 6)
              }
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg disabled:opacity-50"
            >
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {currentPhone ? t('bindPhone.confirm') : t('bindPhone.confirmNew')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Bind Email Dialog ─────────────────────────────────────────
function BindEmailDialog(props: {
  currentEmail: string | null;
  hasEmail: boolean | null;
  onCancel: () => void;
  onBound: (newEmail: string) => void;
}) {
  const { currentEmail, hasEmail, onCancel, onBound } = props;
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [oldCode, setOldCode] = useState('');
  const [sending, setSending] = useState(false);
  const [sendingOld, setSendingOld] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [oldCountdown, setOldCountdown] = useState(0);

  useEffect(() => {
    if (countdown <= 0) return;
    const t = window.setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => window.clearTimeout(t);
  }, [countdown]);

  useEffect(() => {
    if (oldCountdown <= 0) return;
    const t = window.setTimeout(() => setOldCountdown(c => c - 1), 1000);
    return () => window.clearTimeout(t);
  }, [oldCountdown]);

  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  // A11: dual-confirm trigger uses the SERVER's hasEmail flag, not the
  // decrypted email string. If decrypt silently failed, currentEmail
  // is null but hasEmail is true — we still must show the old-OTP
  // field so the request matches what the server enforces.
  const needOldCode = hasEmail === true;
  // If the profile probe failed entirely (hasEmail === null), the dialog
  // cannot safely decide. Block submission until we know.
  const probeFailed = hasEmail === null && !currentEmail;

  const handleSend = async () => {
    if (!validEmail) {
      toast.error(t('bindEmail.error.invalidEmail'));
      return;
    }
    if (currentEmail && currentEmail === email) {
      toast.error(t('bindEmail.error.sameEmail'));
      return;
    }
    setSending(true);
    try {
      await usersApi.sendBindEmailCode(email);
      toast.success(t('bindEmail.codeSent'));
      setCountdown(60);
    } catch {
      // interceptor
    } finally {
      setSending(false);
    }
  };

  const handleSendOld = async () => {
    setSendingOld(true);
    try {
      await usersApi.sendBindEmailOldCode();
      toast.success(t('bindEmail.sentToCurrent'));
      setOldCountdown(60);
    } catch {
      // interceptor
    } finally {
      setSendingOld(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validEmail || code.length !== 6) return;
    if (needOldCode && oldCode.length !== 6) {
      toast.error(t('bindEmail.error.oldCodeRequired'));
      return;
    }
    setSubmitting(true);
    try {
      await usersApi.bindEmail({
        email,
        code,
        ...(needOldCode ? { oldEmailCode: oldCode } : {}),
      });
      toast.success(currentEmail ? t('bindEmail.success') : t('bindEmail.successNew'));
      onBound(email);
    } catch {
      // interceptor
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md mx-4 rounded-lg bg-white p-6 shadow-xl dark:bg-gray-800">
        <h3 className="text-base font-semibold text-gray-900 mb-4 dark:text-gray-100">
          {currentEmail ? t('bindEmail.title') : t('bindEmail.titleNew')}
        </h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-gray-300">{t('bindEmail.newEmail')}</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value.trim())}
              autoComplete="email"
              placeholder="example@domain.com"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-gray-300">{t('bindEmail.code')}</label>
            <div className="flex gap-2">
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder={t('security.placeholderEmailCode')}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
              />
              <button
                type="button"
                onClick={handleSend}
                disabled={sending || countdown > 0 || !validEmail}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-gray-200 whitespace-nowrap"
              >
                {sending && <Loader2 className="w-4 h-4 animate-spin inline mr-1" />}
                {countdown > 0 ? t('security.resendAfter', { s: countdown }) : t('bindEmail.sendCode')}
              </button>
            </div>
          </div>
          {probeFailed && (
            <p className="text-xs text-red-600 dark:text-red-400">
              {t('bindEmail.probeFailed')}
            </p>
          )}
          {needOldCode && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-gray-300">{t('bindEmail.oldCode')}</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={oldCode}
                  onChange={e => setOldCode(e.target.value.replace(/\D/g, ''))}
                  placeholder={t('security.placeholderEmailCode')}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                />
                <button
                  type="button"
                  onClick={handleSendOld}
                  disabled={sendingOld || oldCountdown > 0}
                  className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-gray-200 whitespace-nowrap"
                >
                  {sendingOld && <Loader2 className="w-4 h-4 animate-spin inline mr-1" />}
                  {oldCountdown > 0 ? t('security.resendAfter', { s: oldCountdown }) : t('bindEmail.sendToCurrent')}
                </button>
              </div>
              <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">将发送到 {currentEmail}（双重验证防接管）</p>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg dark:text-gray-300 dark:hover:bg-gray-700"
            >
              {t('bindEmail.cancel')}
            </button>
            <button
              type="submit"
              disabled={
                submitting ||
                probeFailed ||
                !validEmail ||
                code.length !== 6 ||
                (needOldCode && oldCode.length !== 6)
              }
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg disabled:opacity-50"
            >
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {currentEmail ? t('bindEmail.confirm') : t('bindEmail.confirmNew')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Security Tab ───────────────────────────────────────────────
function SecurityTab() {
  const { user, setUser } = useAuthStore();
  const [pwForm, setPwForm] = useState({ oldPassword: '', newPassword: '', confirm: '', emailCode: '' });
  const [showPw, setShowPw] = useState({ old: false, new: false, confirm: false });
  const [pwSaving, setPwSaving] = useState(false);

  const [ppForm, setPpForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [ppSaving, setPpSaving] = useState(false);
  // Server-authoritative: profile probe sets hasPrivateSpace.
  // Pre-fix this was a local boolean that nothing ever flipped — the form
  // always rendered as "first-time setup", and submitting against a backend
  // row that already had privateSpaceHash returned the confusing
  // "修改私密空间密码需要提供当前密码" error with no place to actually put it.
  const [hasPrivateSpace, setHasPrivateSpace] = useState<boolean | null>(null);
  const [showPpCurrent, setShowPpCurrent] = useState(false);

  const [notifs, setNotifs] = useState({ shareAccess: true, foreignLogin: true });
  const [notifSaving, setNotifSaving] = useState(false);

  // A8: email OTP for change-password. We probe the user's profile once to
  // decide whether to surface the OTP field. The server is the source of
  // truth — it requires/skips the OTP based on the stored email — so this
  // is purely a UX flag (hide the field for accounts without an email).
  const [boundEmail, setBoundEmail] = useState<string | null>(null);
  // Server-authoritative — see ProfileTab for the same flag and why we
  // don't infer from `email != null`.
  const [hasEmail, setHasEmail] = useState<boolean | null>(null);
  const [emailProbeStatus, setEmailProbeStatus] = useState<'idle' | 'ok' | 'error'>('idle');
  const [otpSending, setOtpSending] = useState(false);
  const [otpCountdown, setOtpCountdown] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        const res = (await usersApi.profile()) as any;
        setBoundEmail(res?.email ?? null);
        setHasEmail(typeof res?.hasEmail === 'boolean' ? res.hasEmail : !!res?.email);
        const hasPS = typeof res?.hasPrivateSpace === 'boolean' ? res.hasPrivateSpace : false;
        setHasPrivateSpace(hasPS);
        if (hasPS && user && !user.hasPrivateSpace) {
          setUser({ ...user, hasPrivateSpace: true });
        }
        setEmailProbeStatus('ok');
      } catch {
        // Surface the failure rather than silently leaving boundEmail=null,
        // which would let the user submit change-password without an OTP
        // and get a confusing server-side rejection.
        setEmailProbeStatus('error');
      }
    })();
  }, []);

  useEffect(() => {
    if (otpCountdown <= 0) return;
    const t = window.setTimeout(() => setOtpCountdown(c => c - 1), 1000);
    return () => window.clearTimeout(t);
  }, [otpCountdown]);

  const handleSendOtp = async () => {
    setOtpSending(true);
    try {
      await usersApi.sendChangePasswordCode();
      toast.success(t('security.codeSentToEmail'));
      setOtpCountdown(60);
    } catch {
      // interceptor
    } finally {
      setOtpSending(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pwForm.newPassword !== pwForm.confirm) {
      toast.error(t('security.error.passwordMismatch'));
      return;
    }
    if (pwForm.newPassword.length < 8) {
      toast.error(t('security.error.newPasswordTooShort'));
      return;
    }
    if (emailProbeStatus === 'error') {
      toast.error(t('security.error.probeFailed'));
      return;
    }
    if (hasEmail && !pwForm.emailCode) {
      toast.error(t('security.error.emailCodeRequired'));
      return;
    }
    setPwSaving(true);
    try {
      await usersApi.changePassword({
        oldPassword: pwForm.oldPassword,
        newPassword: pwForm.newPassword,
        ...(hasEmail ? { emailCode: pwForm.emailCode } : {}),
      });
      toast.success(t('security.passwordChanged'));
      setPwForm({ oldPassword: '', newPassword: '', confirm: '', emailCode: '' });
    } catch {
      // interceptor
    } finally {
      setPwSaving(false);
    }
  };

  const handleSetupPrivateSpace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (ppForm.newPassword !== ppForm.confirm) {
      toast.error(t('security.error.passwordMismatch'));
      return;
    }
    if (hasPrivateSpace && !ppForm.currentPassword) {
      toast.error(t('security.error.currentPrivatePwRequired'));
      return;
    }
    setPpSaving(true);
    try {
      await usersApi.setupPrivateSpace({
        password: ppForm.newPassword,
        ...(hasPrivateSpace ? { currentPassword: ppForm.currentPassword } : {}),
      });
      toast.success(hasPrivateSpace ? t('security.privatePwUpdated') : t('security.privatePwSet'));
      setPpForm({ currentPassword: '', newPassword: '', confirm: '' });
      setHasPrivateSpace(true);
      if (user) setUser({ ...user, hasPrivateSpace: true });
    } catch {
      // interceptor
    } finally {
      setPpSaving(false);
    }
  };

  const handleSaveNotifs = async () => {
    setNotifSaving(true);
    try {
      await usersApi.updateProfile({ notifications: notifs });
      toast.success(t('security.notifsSaved'));
    } catch {
      // interceptor
    } finally {
      setNotifSaving(false);
    }
  };

  // P1-F1: PwInput hoisted to module scope; keep this comment as a tombstone.

  return (
    <div className="space-y-8 max-w-lg">
      {/* Change Password */}
      <section>
        <h3 className="text-base font-semibold text-gray-900 mb-4 pb-2 border-b border-gray-200 dark:text-gray-100 dark:border-gray-700">{t('security.changePassword')}</h3>
        <form onSubmit={handleChangePassword} className="space-y-4">
          {/* P1-UX: input hints live in the placeholder, label stays a short
              noun. Pre-fix the password rule ("至少 8 位") was glued to the
              label like 新密码（至少 8 位） and the box itself was empty —
              inconsistent with the 隐私空间密码 input below which had a real
              placeholder. Pattern aligned across SecurityTab: label = noun,
              placeholder = constraint hint. */}
          <PwInput
            label={t('security.currentPassword')}
            value={pwForm.oldPassword}
            show={showPw.old}
            placeholder={t('security.placeholderCurrentPw')}
            autoComplete="current-password"
            onChange={v => setPwForm(f => ({ ...f, oldPassword: v }))}
            onToggle={() => setShowPw(s => ({ ...s, old: !s.old }))}
          />
          <PwInput
            label={t('security.newPassword')}
            value={pwForm.newPassword}
            show={showPw.new}
            placeholder={t('security.placeholderNewPw')}
            autoComplete="new-password"
            onChange={v => setPwForm(f => ({ ...f, newPassword: v }))}
            onToggle={() => setShowPw(s => ({ ...s, new: !s.new }))}
          />
          <PwInput
            label={t('security.confirmNewPassword')}
            value={pwForm.confirm}
            show={showPw.confirm}
            placeholder={t('security.placeholderConfirmPw')}
            autoComplete="new-password"
            onChange={v => setPwForm(f => ({ ...f, confirm: v }))}
            onToggle={() => setShowPw(s => ({ ...s, confirm: !s.confirm }))}
          />
          {/* A8: email OTP — visible only when the account has an email bound.
              Backend (users.service.ts) enforces this server-side; the field
              is hidden for email-less accounts purely for UX. */}
          {emailProbeStatus === 'ok' && hasEmail && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-gray-300">{t('security.emailCode')}</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={pwForm.emailCode}
                  onChange={e => setPwForm(f => ({ ...f, emailCode: e.target.value.replace(/\D/g, '') }))}
                  placeholder={t('security.placeholderEmailCode')}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                />
                <button
                  type="button"
                  onClick={handleSendOtp}
                  disabled={otpSending || otpCountdown > 0}
                  className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-gray-200 whitespace-nowrap"
                >
                  {otpSending && <Loader2 className="w-4 h-4 animate-spin inline mr-1" />}
                  {otpCountdown > 0 ? t('security.resendAfter', { s: otpCountdown }) : t('security.sendCode')}
                </button>
              </div>
              <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                {boundEmail ? t('security.codeSentTo', { email: boundEmail! }) : t('security.codeSentToBound')}
              </p>
            </div>
          )}
          {emailProbeStatus === 'ok' && !hasEmail && (
            <p className="text-xs text-amber-600 dark:text-amber-400">{t('security.emailNotBoundWarning')}</p>
          )}
          {emailProbeStatus === 'error' && (
            <p className="text-xs text-red-600 dark:text-red-400">{t('security.probeFailed')}</p>
          )}
          <button
            type="submit"
            disabled={
              pwSaving ||
              emailProbeStatus !== 'ok' ||
              !pwForm.oldPassword ||
              !pwForm.newPassword ||
              (hasEmail === true && !pwForm.emailCode)
            }
            className="flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
          >
            {pwSaving && <Loader2 className="w-4 h-4 animate-spin" />}
            {t('security.changePasswordBtn')}
          </button>
        </form>
      </section>

      {/* Private Space Password */}
      <section id="private-space" className="scroll-mt-4">
        <h3 className="text-base font-semibold text-gray-900 mb-4 pb-2 border-b border-gray-200 dark:text-gray-100 dark:border-gray-700">{t('security.privateSpaceTitle')}</h3>
        <p className="text-sm text-gray-500 mb-4 dark:text-gray-400">
          {hasPrivateSpace === true
            ? t('security.privateSpaceDescExisting')
            : t('security.privateSpaceDesc')}
        </p>
        <form onSubmit={handleSetupPrivateSpace} className="space-y-4">
          {/* Current private-space password — only when one is already set.
              hasPrivateSpace=null while the profile probe is in flight; gate
              on === true so we don't briefly flash the field. */}
          {hasPrivateSpace === true && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-gray-300">{t('security.currentPrivatePw')}</label>
              <div className="relative">
                <input
                  type={showPpCurrent ? 'text' : 'password'}
                  value={ppForm.currentPassword}
                  onChange={e => setPpForm(f => ({ ...f, currentPassword: e.target.value }))}
                  className="w-full px-3 py-2 pr-10 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder={t('security.placeholderCurrentPrivatePw')}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPpCurrent(s => !s)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1 dark:text-gray-500"
                >
                  {showPpCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-gray-300">
              {hasPrivateSpace === true ? t('security.newPrivatePw') : t('security.privateSpacePw')}
            </label>
            <input
              type="password"
              value={ppForm.newPassword}
              onChange={e => setPpForm(f => ({ ...f, newPassword: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder={t('security.placeholderNewPrivatePw')}
              autoComplete="new-password"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-gray-300">{t('security.confirmPrivatePw')}</label>
            <input
              type="password"
              value={ppForm.confirm}
              onChange={e => setPpForm(f => ({ ...f, confirm: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder={t('security.placeholderConfirmPrivatePw')}
              autoComplete="new-password"
            />
          </div>
          <button
            type="submit"
            disabled={
              ppSaving ||
              hasPrivateSpace === null ||
              !ppForm.newPassword ||
              (hasPrivateSpace === true && !ppForm.currentPassword)
            }
            className="flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
          >
            {ppSaving && <Loader2 className="w-4 h-4 animate-spin" />}
            {hasPrivateSpace === true ? t('security.changePrivatePw') : t('security.setPrivatePw')}
          </button>
        </form>
      </section>

      {/* Notification Settings */}
      <section>
        <h3 className="text-base font-semibold text-gray-900 mb-4 pb-2 border-b border-gray-200 dark:text-gray-100 dark:border-gray-700">{t('security.notifTitle')}</h3>
        <div className="space-y-3">
          {[
            { key: 'shareAccess', label: t('security.notif.shareAccess'), icon: <Bell className="w-4 h-4 text-blue-500" /> },
            { key: 'foreignLogin', label: t('security.notif.foreignLogin'), icon: <AlertTriangle className="w-4 h-4 text-orange-500" /> },
          ].map(({ key, label, icon }) => (
            <label key={key} className="flex items-center gap-3 cursor-pointer group">
              <div className="w-5 flex-shrink-0">{icon}</div>
              <span className="flex-1 text-sm text-gray-700 dark:text-gray-300">{label}</span>
              <div
                onClick={() => setNotifs(n => ({ ...n, [key]: !n[key as keyof typeof n] }))}
                className={`relative w-10 h-5 rounded-full transition-colors cursor-pointer ${
                  notifs[key as keyof typeof notifs] ? 'bg-blue-600' : 'bg-gray-300'
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                    notifs[key as keyof typeof notifs] ? 'translate-x-5' : ''
                  }`}
                />
              </div>
            </label>
          ))}
        </div>
        <button
          onClick={handleSaveNotifs}
          disabled={notifSaving}
          className="mt-4 flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
        >
          {notifSaving && <Loader2 className="w-4 h-4 animate-spin" />}
          {t('security.saveNotifs')}
        </button>
      </section>
    </div>
  );
}

// ── Devices Tab ────────────────────────────────────────────────
function DevicesTab() {
  const { data: devices = [], isLoading, refetch } = useQuery<Device[]>({
    queryKey: ['devices'],
    queryFn: async () => {
      const res = await usersApi.devices() as any;
      return res?.devices ?? res ?? [];
    },
  });

  const handleRevoke = async (deviceId: string) => {
    try {
      await usersApi.revokeDevice(deviceId);
      refetch();
      toast.success(t('devices.revoked'));
    } catch {
      // interceptor
    }
  };

  if (isLoading) return <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-blue-500" /></div>;

  return (
    <div className="space-y-3 max-w-2xl">
      <p className="text-sm text-gray-500 mb-4 dark:text-gray-400">{t('devices.desc')}</p>
      {devices.map(device => (
        <div
          key={device.id}
          className={`flex items-center gap-4 p-4 rounded-xl border transition-colors ${
            device.isCurrent
              ? 'border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/20'
              : 'border-gray-200 bg-white hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700/50'
          }`}
        >
          <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center flex-shrink-0 dark:bg-gray-700">
            <Monitor className="w-5 h-5 text-gray-500 dark:text-gray-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-medium text-gray-800 text-sm truncate dark:text-gray-100">{device.deviceName ?? t('devices.unknown')}</p>
              {device.isCurrent && (
                <span className="px-1.5 py-0.5 text-xs bg-blue-600 text-white rounded font-medium">{t('devices.current')}</span>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-0.5 dark:text-gray-400">
              IP: {device.ipAddress ?? '—'} &nbsp;·&nbsp; 最后活跃: {formatDate(device.lastActiveAt)}
            </p>
          </div>
          {!device.isCurrent && (
            <button
              onClick={() => handleRevoke(device.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors flex-shrink-0"
            >
              <LogOut className="w-4 h-4" />
              {t('devices.revoke')}
            </button>
          )}
        </div>
      ))}
      {devices.length === 0 && (
        <p className="text-center text-gray-400 py-10 dark:text-gray-500">{t('devices.empty')}</p>
      )}
    </div>
  );
}

// ── Audit Logs Tab ─────────────────────────────────────────────

// Backend audit actions are stored as English snake-style identifiers
// (login / upload / download / share.access / private_space.access ...).
// Show a Chinese label so the table isn't "all empty + code-looking strings"
// — pre-fix the action column read "login" / "share.access" and users
// reported "点击空白" because the rows looked sparse / cryptic.
const ACTION_LABEL: Record<string, string> = {
  login: '登录',
  logout: '退出',
  'login.fail': '登录失败',
  upload: '上传',
  download: '下载',
  delete: '删除',
  rename: '重命名',
  move: '移动',
  copy: '复制',
  star: '收藏',
  share: '创建分享',
  'share.access': '访问分享',
  'share.delete': '删除分享',
  'device.revoke': '注销设备',
  'private_space.password_set': '设置隐私空间密码',
  'private_space.access': '访问隐私空间',
  'password.change': '修改密码',
  'profile.update': '更新资料',
};

function actionLabel(action: string): string {
  return ACTION_LABEL[action] ?? action;
}

function AuditLogsTab() {
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const PAGE_SIZE = 20;

  const { data, isLoading } = useQuery<{ logs: AuditLog[]; total: number }>({
    queryKey: ['audit-logs', page],
    queryFn: async () => {
      const res = await usersApi.auditLogs({ page, limit: PAGE_SIZE }) as any;
      // Backend returns `{ items, total, page, limit }` (users.service.ts:
      // getAuditLogs). Pre-fix the fallback chain `res?.logs ?? res ?? []`
      // read `res.logs` (undefined), fell through to the whole `res` OBJECT,
      // and `.map()` on a plain object threw silently — table rendered empty
      // even though the backend had data. Explicit `items` first matches the
      // actual contract.
      const items: AuditLog[] = res?.items ?? res?.logs ?? [];
      return { logs: Array.isArray(items) ? items : [], total: res?.total ?? 0 };
    },
    staleTime: 30_000,
  });

  const logs = data?.logs ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const actionBadge = (action: string) => {
    const map: Record<string, string> = {
      upload:   'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
      download: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
      delete:   'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
      login:    'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
      share:    'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
    };
    const key = Object.keys(map).find(k => action.toLowerCase().includes(k)) ?? '';
    return map[key] || 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300';
  };

  if (isLoading) return <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-blue-500" /></div>;

  return (
    <div className="max-w-3xl">
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm dark:bg-gray-800 dark:border-gray-700">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200 dark:bg-gray-900 dark:border-gray-700">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase dark:text-gray-400">{t('logs.column.action')}</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase hidden md:table-cell dark:text-gray-400">{t('logs.column.file')}</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase hidden lg:table-cell dark:text-gray-400">{t('logs.column.ip')}</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase dark:text-gray-400">{t('logs.column.time')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {logs.length === 0 ? (
              <tr>
                <td colSpan={4} className="text-center py-8 text-gray-400 dark:text-gray-500">{t('logs.empty')}</td>
              </tr>
            ) : (
              // P1-UX: rows expand on click to show full audit detail
              // (userAgent / nodeId / metadata / full ISO timestamp / full IP).
              // Pre-fix the column data was English-codey ("share.access") and
              // many cells were "—" because the columns shown didn't cover the
              // rich fields the backend already returns. Click → expand wires
              // those fields without a separate modal route.
              logs.flatMap(log => {
                const expanded = expandedId === log.id;
                return [
                  <tr
                    key={log.id}
                    onClick={() => setExpandedId(expanded ? null : log.id)}
                    className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors even:bg-gray-50/50 dark:even:bg-gray-900/30"
                  >
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 text-xs rounded-full font-medium ${actionBadge(log.action)}`}>
                        {actionLabel(log.action)}
                      </span>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      {log.nodeName ? (
                        <span className="truncate max-w-[160px] block text-gray-600 dark:text-gray-300">{log.nodeName}</span>
                      ) : (
                        <span className="text-gray-300 dark:text-gray-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs font-mono hidden lg:table-cell">
                      {log.ipAddress ? (
                        <span className="text-gray-500 dark:text-gray-400">{log.ipAddress.replace(/^::ffff:/, '')}</span>
                      ) : (
                        <span className="text-gray-300 dark:text-gray-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs dark:text-gray-400">
                      {formatDate(log.createdAt)}
                    </td>
                  </tr>,
                  expanded && (
                    <tr key={`${log.id}-detail`} className="bg-gray-50 dark:bg-gray-900/60">
                      <td colSpan={4} className="px-4 py-3">
                        <dl className="grid grid-cols-1 md:grid-cols-[140px_1fr] gap-x-4 gap-y-2 text-xs">
                          <dt className="text-gray-500 dark:text-gray-400">{t('logs.detail.actionCode')}</dt>
                          <dd className="font-mono text-gray-700 dark:text-gray-200 break-all">{log.action}</dd>

                          <dt className="text-gray-500 dark:text-gray-400">{t('logs.detail.fullTime')}</dt>
                          <dd className="text-gray-700 dark:text-gray-200">{new Date(log.createdAt).toLocaleString('zh-CN', { hour12: false })}</dd>

                          <dt className="text-gray-500 dark:text-gray-400">{t('logs.detail.fullIp')}</dt>
                          <dd className="font-mono text-gray-700 dark:text-gray-200 break-all">{log.ipAddress ?? '—'}</dd>

                          <dt className="text-gray-500 dark:text-gray-400">{t('logs.detail.client')}</dt>
                          <dd className="text-gray-700 dark:text-gray-200 break-all">{log.userAgent ?? '—'}</dd>

                          <dt className="text-gray-500 dark:text-gray-400">{t('logs.detail.relatedFile')}</dt>
                          <dd className="text-gray-700 dark:text-gray-200 break-all">{log.nodeName ?? '—'}</dd>

                          <dt className="text-gray-500 dark:text-gray-400">{t('logs.detail.fileId')}</dt>
                          <dd className="font-mono text-gray-700 dark:text-gray-200 break-all">{log.nodeId ?? '—'}</dd>

                          {log.metadata && Object.keys(log.metadata).length > 0 && (
                            <>
                              <dt className="text-gray-500 dark:text-gray-400">{t('logs.detail.metadata')}</dt>
                              <dd className="font-mono text-gray-700 dark:text-gray-200 break-all whitespace-pre-wrap">
                                {JSON.stringify(log.metadata, null, 2)}
                              </dd>
                            </>
                          )}
                        </dl>
                      </td>
                    </tr>
                  ),
                ].filter(Boolean);
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-xs text-gray-500 dark:text-gray-400">{t('logs.totalRecords', { n: total })}</p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-40 transition-colors dark:hover:bg-gray-700"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm text-gray-600 dark:text-gray-300">
              {page} / {totalPages}
            </span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-40 transition-colors dark:hover:bg-gray-700"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Storage Stats Tab ──────────────────────────────────────────
function StorageTab() {
  const { data: stats, isLoading } = useQuery<StorageStats>({
    queryKey: ['storage-stats'],
    queryFn: async () => {
      const res = await usersApi.stats() as any;
      return res?.stats ?? res;
    },
  });

  const { user } = useAuthStore();

  if (isLoading) return <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-blue-500" /></div>;
  if (!stats) return null;

  const usedPct = Math.min(100, (stats.usedBytes / stats.quotaBytes) * 100);
  const colors = ['bg-blue-500', 'bg-purple-500', 'bg-green-500', 'bg-orange-500', 'bg-pink-500', 'bg-teal-500'];

  return (
    <div className="max-w-lg space-y-6">
      {/* Total usage */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm dark:bg-gray-800 dark:border-gray-700">
        <div className="flex items-end justify-between mb-3">
          <div>
            <p className="text-sm text-gray-500 dark:text-gray-400">{t('storage.used')}</p>
            <p className="text-2xl font-bold text-gray-900 mt-1 dark:text-gray-100">{formatBytes(stats.usedBytes)}</p>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('storage.total', { size: formatBytes(stats.quotaBytes) })}</p>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-3 dark:bg-gray-700">
          <div
            className={`h-3 rounded-full transition-all ${usedPct > 90 ? 'bg-red-500' : usedPct > 70 ? 'bg-orange-500' : 'bg-blue-500'}`}
            style={{ width: `${usedPct}%` }}
          />
        </div>
        <p className="text-xs text-gray-400 mt-1.5 text-right dark:text-gray-500">{t('storage.usedPct', { pct: usedPct.toFixed(1) })}</p>
      </div>

      {/* By type bars */}
      {stats.byType && stats.byType.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm dark:bg-gray-800 dark:border-gray-700">
          <h3 className="text-sm font-semibold text-gray-900 mb-4 dark:text-gray-100">{t('storage.byType')}</h3>
          <div className="space-y-3">
            {stats.byType.map((item, idx) => {
              const pct = stats.usedBytes > 0 ? (item.bytes / stats.usedBytes) * 100 : 0;
              return (
                <div key={item.type}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-gray-600 dark:text-gray-300">{item.label}</span>
                    <span className="text-gray-500 font-medium dark:text-gray-400">{formatBytes(item.bytes)}</span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2 dark:bg-gray-700">
                    <div
                      className={`h-2 rounded-full transition-all ${colors[idx % colors.length]}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5 text-right dark:text-gray-500">{pct.toFixed(1)}%</p>
                </div>
              );
            })}
          </div>

          {/* Legend */}
          <div className="mt-4 flex flex-wrap gap-3">
            {stats.byType.map((item, idx) => (
              <div key={item.type} className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
                <div className={`w-2.5 h-2.5 rounded-full ${colors[idx % colors.length]}`} />
                <span>{item.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Profile Page ─────────────────────────────────────────
const VALID_TABS: Tab[] = ['profile', 'security', 'devices', 'logs', 'storage'];

export default function Profile() {
  // P1-UX: support ?tab=security#private-space deep-link so PrivateSpaceGate's
  // "前往设置" button lands users right at the 隐私空间密码 section instead
  // of the default 资料 tab.
  const location = useLocation();
  const initialTab: Tab = (() => {
    const params = new URLSearchParams(location.search);
    const t = params.get('tab');
    return (t && VALID_TABS.includes(t as Tab)) ? (t as Tab) : 'profile';
  })();
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);

  // After security tab renders, scroll to the anchor (#private-space) if present.
  useEffect(() => {
    if (activeTab !== 'security') return;
    if (location.hash !== '#private-space') return;
    // Wait a tick for the section to mount before scrolling.
    const t = setTimeout(() => {
      const el = document.getElementById('private-space');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
    return () => clearTimeout(t);
  }, [activeTab, location.hash]);

  const renderTab = () => {
    switch (activeTab) {
      case 'profile': return <ProfileTab />;
      case 'security': return <SecurityTab />;
      case 'devices': return <DevicesTab />;
      case 'logs': return <AuditLogsTab />;
      case 'storage': return <StorageTab />;
    }
  };

  return (
    <div className="flex h-full overflow-hidden">
      {/* Sidebar tabs */}
      <aside className="w-48 flex-shrink-0 border-r border-gray-200 bg-white p-3 space-y-1 dark:bg-gray-800 dark:border-gray-700">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-left ${
              activeTab === tab.id
                ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-gray-100'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </aside>

      {/* Content */}
      <main className="flex-1 overflow-y-auto p-6 bg-gray-50 dark:bg-gray-900">
        <h2 className="text-xl font-bold text-gray-900 mb-6 dark:text-gray-100">
          {TABS.find(t => t.id === activeTab)?.label}
        </h2>
        {renderTab()}
      </main>
    </div>
  );
}
