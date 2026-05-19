import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { t } from '../../i18n/translations';
import {
  Mail,
  Loader2,
  X,
  CheckCircle,
  Eye,
  EyeOff,
} from 'lucide-react';
import toast from 'react-hot-toast';

import { adminApi } from '../../api/client';
import ConfirmPasswordDialog from '../../components/dialogs/ConfirmPasswordDialog';

type SmsProvider = 'none' | 'twilio' | 'aliyun' | 'aws-sns' | 'telegram-bot';

interface SystemConfig {
  defaultQuotaGB: number;
  maxFoldersPerDir: number;
  registrationMode: 'open' | 'invite' | 'closed';
  fileTypeBlacklist: string[];
  verificationCodeTTL: number;
  loginFailLockCount: number;
  loginLockDuration: number;
  shareDefaultExpireDays: number;
  cfWorkersUrl: string;
  smtp: {
    host: string;
    port: number;
    user: string;
    pass: string;
    from: string;
  };
  sms: {
    provider: SmsProvider;
    accountSid: string;
    authToken: string;
    accessKeyId: string;
    accessKeySecret: string;
    signName: string;
    templateCode: string;
    region: string;
    botToken: string;
    from: string;
  };
}

function TagInput({
  tags,
  onChange,
  placeholder,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
}) {
  const [input, setInput] = useState('');

  const addTag = (value: string) => {
    const trimmed = value.trim().toLowerCase();
    if (!trimmed || tags.includes(trimmed)) return;
    onChange([...tags, trimmed]);
    setInput('');
  };

  const removeTag = (tag: string) => {
    onChange(tags.filter(t => t !== tag));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag(input);
    } else if (e.key === 'Backspace' && !input && tags.length) {
      onChange(tags.slice(0, -1));
    }
  };

  return (
    <div className="flex flex-wrap gap-1.5 min-h-[40px] px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-transparent bg-white dark:bg-gray-700 dark:bg-gray-800">
      {tags.map(tag => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-100 dark:bg-gray-600 text-gray-700 dark:text-gray-300 text-xs rounded-full dark:bg-gray-700"
        >
          {tag}
          <button
            type="button"
            onClick={() => removeTag(tag)}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 dark:text-gray-500"
          >
            <X className="w-3 h-3" />
          </button>
        </span>
      ))}
      <input
        type="text"
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => addTag(input)}
        placeholder={tags.length === 0 ? placeholder : ''}
        className="flex-1 min-w-[100px] text-sm outline-none bg-transparent text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 dark:text-gray-100"
      />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 dark:bg-gray-900">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
      </div>
      <div className="px-6 py-5 space-y-4">{children}</div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-start">
      <div>
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</p>
        {hint && <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{hint}</p>}
      </div>
      <div className="sm:col-span-2">{children}</div>
    </div>
  );
}

function inputClass() {
  return 'w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent';
}

export default function AdminConfig() {
  const { data: remoteConfig, isLoading } = useQuery<SystemConfig>({
    queryKey: ['admin', 'config'],
    queryFn: async () => {
      const res = await adminApi.getConfig() as any;
      return res?.config ?? res;
    },
    staleTime: 60_000,
  });

  const [config, setConfig] = useState<SystemConfig>({
    defaultQuotaGB: 10,
    maxFoldersPerDir: 1000,
    registrationMode: 'open',
    fileTypeBlacklist: [],
    verificationCodeTTL: 600,
    loginFailLockCount: 5,
    loginLockDuration: 900,
    shareDefaultExpireDays: 7,
    cfWorkersUrl: '',
    smtp: { host: '', port: 587, user: '', pass: '', from: '' },
    sms: {
      provider: 'none',
      accountSid: '',
      authToken: '',
      accessKeyId: '',
      accessKeySecret: '',
      signName: '',
      templateCode: '',
      region: 'us-east-1',
      botToken: '',
      from: '',
    },
  });

  const [saving, setSaving] = useState(false);
  const [testingEmail, setTestingEmail] = useState(false);
  const [testEmailTarget, setTestEmailTarget] = useState('');
  const [emailVerifyCode, setEmailVerifyCode] = useState('');
  const [verifyingEmail, setVerifyingEmail] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  const [testingSms, setTestingSms] = useState(false);
  const [testSmsTarget, setTestSmsTarget] = useState('');
  const [smsVerifyCode, setSmsVerifyCode] = useState('');
  const [verifyingSms, setVerifyingSms] = useState(false);
  const [smsSent, setSmsSent] = useState(false);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [showSmtpPass, setShowSmtpPass] = useState(false);
  const [showSmsSecret, setShowSmsSecret] = useState(false);

  useEffect(() => {
    if (remoteConfig) setConfig(remoteConfig);
  }, [remoteConfig]);

  const set = (partial: Partial<SystemConfig>) => setConfig(c => ({ ...c, ...partial }));
  const setSmtp = (partial: Partial<SystemConfig['smtp']>) =>
    setConfig(c => ({ ...c, smtp: { ...c.smtp, ...partial } }));
  const setSms = (partial: Partial<SystemConfig['sms']>) =>
    setConfig(c => ({ ...c, sms: { ...c.sms, ...partial } }));

  const validate = (): boolean => {
    if (config.defaultQuotaGB < 1) { toast.error(t('admin.config.validation.quotaMin')); return false; }
    if (config.maxFoldersPerDir < 1) { toast.error(t('admin.config.validation.maxFoldersMin')); return false; }
    if (config.loginFailLockCount < 1) { toast.error(t('admin.config.validation.lockCountMin')); return false; }
    if (config.loginLockDuration < 1) { toast.error(t('admin.config.validation.lockDurationMin')); return false; }
    if (config.shareDefaultExpireDays < 0) { toast.error(t('admin.config.validation.shareExpiryNegative')); return false; }
    if (config.smtp.port < 1 || config.smtp.port > 65535) { toast.error(t('admin.config.validation.smtpPortRange')); return false; }
    return true;
  };

  const handleSave = () => {
    if (!validate()) return;
    setConfirmOpen(true);
  };

  const submitConfig = async (pw: string) => {
    setSaving(true);
    try {
      await adminApi.updateConfig({ ...config, confirmPassword: pw });
      toast.success(t('admin.config.saved'));
    } finally {
      setSaving(false);
    }
  };

  const handleTestEmail = async () => {
    if (!testEmailTarget.trim()) {
      toast.error(t('admin.config.validation.enterEmail'));
      return;
    }
    setTestingEmail(true);
    try {
      const res = await adminApi.testEmail({ to: testEmailTarget, smtpConfig: config.smtp }) as any;
      const dev = res?.devCode;
      if (dev) {
        toast.success(t('admin.config.emailSentDev', { code: dev }), { duration: 15_000 });
      } else {
        toast.success(t('admin.config.emailSent'));
      }
      setEmailSent(true);
      setEmailVerifyCode('');
    } catch {
    } finally {
      setTestingEmail(false);
    }
  };

  const handleVerifyEmail = async () => {
    if (!/^\d{6}$/.test(emailVerifyCode)) {
      toast.error(t('admin.config.validation.enterCode'));
      return;
    }
    setVerifyingEmail(true);
    try {
      await adminApi.testVerifyCode({ channel: 'email', code: emailVerifyCode });
      toast.success(t('admin.config.emailVerified'));
      setEmailSent(false);
      setEmailVerifyCode('');
    } catch {
    } finally {
      setVerifyingEmail(false);
    }
  };

  const handleTestSms = async () => {
    if (!testSmsTarget.trim()) {
      toast.error(t('admin.config.validation.enterPhone'));
      return;
    }
    setTestingSms(true);
    try {
      const res = await adminApi.testSms({ to: testSmsTarget }) as any;
      const dev = res?.devCode;
      if (dev) {
        toast.success(t('admin.config.emailSentDev', { code: dev }), { duration: 15_000 });
      } else {
        toast.success(t('admin.config.smsSent'));
      }
      setSmsSent(true);
      setSmsVerifyCode('');
    } catch {
    } finally {
      setTestingSms(false);
    }
  };

  const handleVerifySms = async () => {
    if (!/^\d{6}$/.test(smsVerifyCode)) {
      toast.error(t('admin.config.validation.enterCode'));
      return;
    }
    setVerifyingSms(true);
    try {
      await adminApi.testVerifyCode({ channel: 'sms', code: smsVerifyCode });
      toast.success(t('admin.config.smsVerified'));
      setSmsSent(false);
      setSmsVerifyCode('');
    } catch {
    } finally {
      setVerifyingSms(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  const regModeOptions = [
    { value: 'open', label: t('admin.config.regOpen') },
    { value: 'invite', label: t('admin.config.regInvite') },
    { value: 'closed', label: t('admin.config.regClosed') },
  ];

  const smsProviderOptions: { value: SmsProvider; label: string }[] = [
    { value: 'none', label: t('admin.config.smsNone') },
    { value: 'twilio', label: 'Twilio' },
    { value: 'aliyun', label: t('admin.config.smsAliyun') },
    { value: 'aws-sns', label: 'AWS SNS' },
    { value: 'telegram-bot', label: 'Telegram Bot' },
  ];

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">{t('admin.config.title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{t('admin.config.subtitle')}</p>
        </div>
      </div>

      <Section title={t('admin.config.sectionStorage')}>
        <Field label={t('admin.config.fieldDefaultQuota')} hint={t('admin.config.hintDefaultQuota')}>
          <input type="number" min={1} max={10000} value={config.defaultQuotaGB} onChange={e => set({ defaultQuotaGB: Number(e.target.value) })} className={inputClass()} />
        </Field>
        <Field label={t('admin.config.fieldMaxFolders')} hint={t('admin.config.hintMaxFolders')}>
          <input type="number" min={10} max={100000} value={config.maxFoldersPerDir} onChange={e => set({ maxFoldersPerDir: Number(e.target.value) })} className={inputClass()} />
        </Field>
        <Field label={t('admin.config.fieldFileBlacklist')} hint={t('admin.config.hintFileBlacklist')}>
          <TagInput tags={config.fileTypeBlacklist} onChange={tags => set({ fileTypeBlacklist: tags })} placeholder={t('admin.config.blacklistPlaceholder')} />
        </Field>
      </Section>

      <Section title={t('admin.config.sectionRegistration')}>
        <Field label={t('admin.config.fieldRegMode')} hint={t('admin.config.hintRegMode')}>
          <div className="flex gap-4 flex-wrap">
            {regModeOptions.map(opt => (
              <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="registrationMode" value={opt.value} checked={config.registrationMode === opt.value} onChange={() => set({ registrationMode: opt.value as SystemConfig['registrationMode'] })} className="w-4 h-4 text-blue-600" />
                <span className="text-sm text-gray-700 dark:text-gray-300">{opt.label}</span>
              </label>
            ))}
          </div>
        </Field>
        <Field label={t('admin.config.fieldCodeTTL')} hint={t('admin.config.hintCodeTTL')}>
          <input type="number" min={60} max={3600} value={config.verificationCodeTTL} onChange={e => set({ verificationCodeTTL: Number(e.target.value) })} className={inputClass()} />
        </Field>
      </Section>

      <Section title={t('admin.config.sectionSecurity')}>
        <Field label={t('admin.config.fieldLoginLockCount')} hint={t('admin.config.hintLoginLockCount')}>
          <input type="number" min={3} max={20} value={config.loginFailLockCount} onChange={e => set({ loginFailLockCount: Number(e.target.value) })} className={inputClass()} />
        </Field>
        <Field label={t('admin.config.fieldLockDuration')} hint={t('admin.config.hintLockDuration')}>
          <input type="number" min={60} max={86400} value={config.loginLockDuration} onChange={e => set({ loginLockDuration: Number(e.target.value) })} className={inputClass()} />
        </Field>
        <Field label={t('admin.config.fieldShareExpiry')} hint={t('admin.config.hintShareExpiry')}>
          <input type="number" min={0} max={365} value={config.shareDefaultExpireDays} onChange={e => set({ shareDefaultExpireDays: Number(e.target.value) })} className={inputClass()} />
        </Field>
      </Section>

      <Section title={t('admin.config.sectionWorkers')}>
        <Field label={t('admin.config.fieldWorkersUrl')} hint={t('admin.config.hintWorkersUrl')}>
          <input type="url" value={config.cfWorkersUrl} onChange={e => set({ cfWorkersUrl: e.target.value })} placeholder="https://your-worker.your-subdomain.workers.dev" className={inputClass()} />
        </Field>
      </Section>

      <Section title={t('admin.config.sectionSmtp')}>
        <Field label={t('admin.config.fieldSmtpHost')}>
          <input type="text" value={config.smtp.host} onChange={e => setSmtp({ host: e.target.value })} placeholder="smtp.example.com" className={inputClass()} />
        </Field>
        <Field label={t('admin.config.fieldSmtpPort')}>
          <input type="number" min={1} max={65535} value={config.smtp.port} onChange={e => setSmtp({ port: Number(e.target.value) })} placeholder="587" className={inputClass()} />
        </Field>
        <Field label={t('admin.config.fieldSmtpUser')}>
          <input type="text" value={config.smtp.user} onChange={e => setSmtp({ user: e.target.value })} placeholder="noreply@example.com" className={inputClass()} />
        </Field>
        <Field label={t('admin.config.fieldSmtpPass')}>
          <div className="relative">
            <input type={showSmtpPass ? 'text' : 'password'} value={config.smtp.pass} onChange={e => setSmtp({ pass: e.target.value })} placeholder="••••••••" autoComplete="new-password" className={`${inputClass()} pr-10`} />
            <button type="button" onClick={() => setShowSmtpPass(v => !v)} title={showSmtpPass ? t('admin.config.hidePassword') : t('admin.config.showPassword')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-200">
              {showSmtpPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </Field>
        <Field label={t('admin.config.fieldSmtpFrom')}>
          <input type="email" value={config.smtp.from} onChange={e => setSmtp({ from: e.target.value })} placeholder={t('admin.config.smtpFromPlaceholder')} className={inputClass()} />
        </Field>

        <div className="pt-2 border-t border-gray-100 dark:border-gray-700 space-y-3">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('admin.config.testEmailTitle')}</p>
          <div className="flex gap-2">
            <input type="email" value={testEmailTarget} onChange={e => setTestEmailTarget(e.target.value)} placeholder={t('admin.config.testEmailPlaceholder')} className={`flex-1 ${inputClass()}`} />
            <button onClick={handleTestEmail} disabled={testingEmail} className="flex items-center gap-2 px-4 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap">
              {testingEmail ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
              {emailSent ? t('admin.config.resend') : t('admin.config.sendTest')}
            </button>
          </div>
          {emailSent && (
            <div className="flex gap-2">
              <input type="text" inputMode="numeric" maxLength={6} value={emailVerifyCode} onChange={e => setEmailVerifyCode(e.target.value.replace(/\D/g, ''))} placeholder={t('admin.config.verifyCodePlaceholder')} className={`flex-1 ${inputClass()}`} />
              <button onClick={handleVerifyEmail} disabled={verifyingEmail || emailVerifyCode.length !== 6} className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap">
                {verifyingEmail ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                {t('admin.config.verifyCode')}
              </button>
            </div>
          )}
        </div>
      </Section>

      <Section title={t('admin.config.sectionSms')}>
        <Field label={t('admin.config.fieldSmsProvider')} hint={t('admin.config.hintSmsProvider')}>
          <div className="flex gap-4 flex-wrap">
            {smsProviderOptions.map(opt => (
              <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="smsProvider" value={opt.value} checked={config.sms.provider === opt.value} onChange={() => setSms({ provider: opt.value })} className="w-4 h-4 text-blue-600" />
                <span className="text-sm text-gray-700 dark:text-gray-300">{opt.label}</span>
              </label>
            ))}
          </div>
        </Field>

        {config.sms.provider === 'twilio' && (
          <>
            <Field label={t('admin.config.fieldAccountSid')} hint={t('admin.config.hintAccountSid')}>
              <input type="text" value={config.sms.accountSid} onChange={e => setSms({ accountSid: e.target.value })} placeholder="AC..." className={inputClass()} />
            </Field>
            <Field label={t('admin.config.fieldAuthToken')}>
              <div className="relative">
                <input type={showSmsSecret ? 'text' : 'password'} value={config.sms.authToken} onChange={e => setSms({ authToken: e.target.value })} placeholder={t('admin.config.keepPlaceholder')} autoComplete="new-password" className={`${inputClass()} pr-10`} />
                <button type="button" onClick={() => setShowSmsSecret(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-200">
                  {showSmsSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </Field>
            <Field label={t('admin.config.fieldFrom')} hint={t('admin.config.hintFrom')}>
              <input type="text" value={config.sms.from} onChange={e => setSms({ from: e.target.value })} placeholder="+1xxxxxxxxxx" className={inputClass()} />
            </Field>
          </>
        )}

        {config.sms.provider === 'aliyun' && (
          <>
            <Field label={t('admin.config.fieldAccessKeyId')}>
              <input type="text" value={config.sms.accessKeyId} onChange={e => setSms({ accessKeyId: e.target.value })} placeholder="LTAI..." className={inputClass()} />
            </Field>
            <Field label={t('admin.config.fieldAccessKeySecret')}>
              <div className="relative">
                <input type={showSmsSecret ? 'text' : 'password'} value={config.sms.accessKeySecret} onChange={e => setSms({ accessKeySecret: e.target.value })} placeholder={t('admin.config.keepPlaceholder')} autoComplete="new-password" className={`${inputClass()} pr-10`} />
                <button type="button" onClick={() => setShowSmsSecret(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-200">
                  {showSmsSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </Field>
            <Field label={t('admin.config.fieldSignName')} hint={t('admin.config.hintSignName')}>
              <input type="text" value={config.sms.signName} onChange={e => setSms({ signName: e.target.value })} placeholder={t('admin.config.signNamePlaceholder')} className={inputClass()} />
            </Field>
            <Field label={t('admin.config.fieldTemplateId')} hint={t('admin.config.hintTemplateId')}>
              <input type="text" value={config.sms.templateCode} onChange={e => setSms({ templateCode: e.target.value })} placeholder="SMS_xxxxxxxx" className={inputClass()} />
            </Field>
          </>
        )}

        {config.sms.provider === 'aws-sns' && (
          <>
            <Field label={t('admin.config.fieldAccessKeyId')}>
              <input type="text" value={config.sms.accessKeyId} onChange={e => setSms({ accessKeyId: e.target.value })} placeholder="AKIA..." className={inputClass()} />
            </Field>
            <Field label={t('admin.config.fieldAccessKeySecret')}>
              <div className="relative">
                <input type={showSmsSecret ? 'text' : 'password'} value={config.sms.accessKeySecret} onChange={e => setSms({ accessKeySecret: e.target.value })} placeholder={t('admin.config.keepPlaceholder')} autoComplete="new-password" className={`${inputClass()} pr-10`} />
                <button type="button" onClick={() => setShowSmsSecret(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-200">
                  {showSmsSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </Field>
            <Field label={t('admin.config.fieldRegion')} hint={t('admin.config.hintRegion')}>
              <input type="text" value={config.sms.region} onChange={e => setSms({ region: e.target.value })} placeholder="us-east-1" className={inputClass()} />
            </Field>
          </>
        )}

        {config.sms.provider === 'telegram-bot' && (
          <>
            <Field label={t('admin.config.fieldBotToken')} hint={t('admin.config.hintBotToken')}>
              <div className="relative">
                <input type={showSmsSecret ? 'text' : 'password'} value={config.sms.botToken} onChange={e => setSms({ botToken: e.target.value })} placeholder={t('admin.config.keepPlaceholder')} autoComplete="new-password" className={`${inputClass()} pr-10`} />
                <button type="button" onClick={() => setShowSmsSecret(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-200">
                  {showSmsSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </Field>
          </>
        )}

        {config.sms.provider === 'none' && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            {t('admin.config.smsNoneHint')}
          </p>
        )}

        <div className="pt-2 border-t border-gray-100 dark:border-gray-700 space-y-3">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('admin.config.testSmsTitle')}</p>
          <div className="flex gap-2">
            <input type="tel" value={testSmsTarget} onChange={e => setTestSmsTarget(e.target.value)} placeholder={t('admin.config.testSmsPlaceholder')} className={`flex-1 ${inputClass()}`} />
            <button onClick={handleTestSms} disabled={testingSms} className="flex items-center gap-2 px-4 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap">
              {testingSms ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
              {smsSent ? t('admin.config.resend') : t('admin.config.sendTest')}
            </button>
          </div>
          {smsSent && (
            <div className="flex gap-2">
              <input type="text" inputMode="numeric" maxLength={6} value={smsVerifyCode} onChange={e => setSmsVerifyCode(e.target.value.replace(/\D/g, ''))} placeholder={t('admin.config.verifyCodePlaceholder')} className={`flex-1 ${inputClass()}`} />
              <button onClick={handleVerifySms} disabled={verifyingSms || smsVerifyCode.length !== 6} className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap">
                {verifyingSms ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                {t('admin.config.verifyCode')}
              </button>
            </div>
          )}
        </div>
      </Section>

      <div className="flex justify-end pb-4">
        <button onClick={handleSave} disabled={saving} className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-xl transition-colors disabled:opacity-50">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
          {t('admin.config.saveAll')}
        </button>
      </div>

      {confirmOpen && (
        <ConfirmPasswordDialog
          title={t('admin.config.confirmTitle')}
          confirmLabel={t('admin.config.confirmLabel')}
          destructive
          description={
            <>
              {t('admin.config.confirmBody')}
            </>
          }
          onConfirm={submitConfig}
          onClose={() => setConfirmOpen(false)}
        />
      )}
    </div>
  );
}
