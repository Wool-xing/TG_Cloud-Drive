import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
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

// ── Tag Input ──────────────────────────────────────────────────
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

// ── Section Wrapper ────────────────────────────────────────────
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

// ── Form Field ─────────────────────────────────────────────────
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

// ── Main Config Page ────────────────────────────────────────────
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
    if (config.defaultQuotaGB < 1) { toast.error('默认配额不能小于1GB'); return false; }
    if (config.maxFoldersPerDir < 1) { toast.error('每目录最大文件夹数不能小于1'); return false; }
    if (config.loginFailLockCount < 1) { toast.error('登录失败锁定次数不能小于1'); return false; }
    if (config.loginLockDuration < 1) { toast.error('锁定时长不能小于1秒'); return false; }
    if (config.shareDefaultExpireDays < 0) { toast.error('分享有效期不能为负数'); return false; }
    if (config.smtp.port < 1 || config.smtp.port > 65535) { toast.error('SMTP端口需在1-65535范围内'); return false; }
    return true;
  };

  // P1-I7: system config writes (SMTP / registration / share defaults …)
  // affect every user, so the backend gates them behind requireConfirm. The
  // top-level Save button only opens the confirm dialog; the actual PATCH
  // ships from inside the dialog's onConfirm so the admin password rides on
  // the same request.
  const handleSave = () => {
    if (!validate()) return;
    setConfirmOpen(true);
  };

  const submitConfig = async (pw: string) => {
    setSaving(true);
    try {
      await adminApi.updateConfig({ ...config, confirmPassword: pw });
      toast.success('配置已保存');
    } finally {
      setSaving(false);
    }
  };

  const handleTestEmail = async () => {
    if (!testEmailTarget.trim()) {
      toast.error('请输入测试邮箱地址');
      return;
    }
    setTestingEmail(true);
    try {
      const res = await adminApi.testEmail({ to: testEmailTarget, smtpConfig: config.smtp }) as any;
      const dev = res?.devCode;
      if (dev) {
        toast.success(`已生成测试验证码 (dev): ${dev}`, { duration: 15_000 });
      } else {
        toast.success('测试邮件已发送，请检查收件箱并输入收到的验证码');
      }
      setEmailSent(true);
      setEmailVerifyCode('');
    } catch {
      // interceptor
    } finally {
      setTestingEmail(false);
    }
  };

  const handleVerifyEmail = async () => {
    if (!/^\d{6}$/.test(emailVerifyCode)) {
      toast.error('请输入 6 位数字验证码');
      return;
    }
    setVerifyingEmail(true);
    try {
      await adminApi.testVerifyCode({ channel: 'email', code: emailVerifyCode });
      toast.success('✓ 邮件通道核对成功，验证码正确');
      setEmailSent(false);
      setEmailVerifyCode('');
    } catch {
      // interceptor
    } finally {
      setVerifyingEmail(false);
    }
  };

  const handleTestSms = async () => {
    if (!testSmsTarget.trim()) {
      toast.error('请输入测试手机号');
      return;
    }
    setTestingSms(true);
    try {
      // Backend returns `devCode` in dev / when provider=none so admin can
      // close the verify loop even before a real gateway is wired.
      const res = await adminApi.testSms({ to: testSmsTarget }) as any;
      const dev = res?.devCode;
      if (dev) {
        toast.success(`已生成测试验证码 (dev): ${dev}`, { duration: 15_000 });
      } else {
        toast.success('测试短信已发送，请检查手机并输入收到的验证码');
      }
      setSmsSent(true);
      setSmsVerifyCode('');
    } catch {
      // interceptor
    } finally {
      setTestingSms(false);
    }
  };

  const handleVerifySms = async () => {
    if (!/^\d{6}$/.test(smsVerifyCode)) {
      toast.error('请输入 6 位数字验证码');
      return;
    }
    setVerifyingSms(true);
    try {
      await adminApi.testVerifyCode({ channel: 'sms', code: smsVerifyCode });
      toast.success('✓ 短信通道核对成功，验证码正确');
      setSmsSent(false);
      setSmsVerifyCode('');
    } catch {
      // interceptor
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

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">系统配置</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">管理全局系统设置</p>
        </div>
      </div>

      {/* ── Storage & Limits ─────────────────────────────── */}
      <Section title="存储与限制">
        <Field label="默认配额 (GB)" hint="新用户注册时分配的默认存储空间">
          <input
            type="number"
            min={1}
            max={10000}
            value={config.defaultQuotaGB}
            onChange={e => set({ defaultQuotaGB: Number(e.target.value) })}
            className={inputClass()}
          />
        </Field>
        <Field label="每目录最大文件夹数" hint="单个目录下允许创建的最大文件夹数量">
          <input
            type="number"
            min={10}
            max={100000}
            value={config.maxFoldersPerDir}
            onChange={e => set({ maxFoldersPerDir: Number(e.target.value) })}
            className={inputClass()}
          />
        </Field>
        <Field label="文件类型黑名单" hint="禁止上传的文件扩展名（回车或逗号分隔）">
          <TagInput
            tags={config.fileTypeBlacklist}
            onChange={tags => set({ fileTypeBlacklist: tags })}
            placeholder="如: exe, bat, sh ..."
          />
        </Field>
      </Section>

      {/* ── Registration ─────────────────────────────────── */}
      <Section title="注册与访问">
        <Field label="注册模式" hint="控制用户注册权限">
          <div className="flex gap-4 flex-wrap">
            {[
              { value: 'open', label: '开放注册' },
              { value: 'invite', label: '仅邀请' },
              { value: 'closed', label: '关闭注册' },
            ].map(opt => (
              <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="registrationMode"
                  value={opt.value}
                  checked={config.registrationMode === opt.value}
                  onChange={() => set({ registrationMode: opt.value as SystemConfig['registrationMode'] })}
                  className="w-4 h-4 text-blue-600"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">{opt.label}</span>
              </label>
            ))}
          </div>
        </Field>
        <Field label="验证码有效期 (秒)" hint="邮件/短信验证码的有效时间">
          <input
            type="number"
            min={60}
            max={3600}
            value={config.verificationCodeTTL}
            onChange={e => set({ verificationCodeTTL: Number(e.target.value) })}
            className={inputClass()}
          />
        </Field>
      </Section>

      {/* ── Security ─────────────────────────────────────── */}
      <Section title="安全策略">
        <Field label="登录失败锁定次数" hint="连续失败多少次后锁定账号">
          <input
            type="number"
            min={3}
            max={20}
            value={config.loginFailLockCount}
            onChange={e => set({ loginFailLockCount: Number(e.target.value) })}
            className={inputClass()}
          />
        </Field>
        <Field label="锁定时长 (秒)" hint="账号被锁定后需等待的时间">
          <input
            type="number"
            min={60}
            max={86400}
            value={config.loginLockDuration}
            onChange={e => set({ loginLockDuration: Number(e.target.value) })}
            className={inputClass()}
          />
        </Field>
        <Field label="分享默认有效期 (天)" hint="创建分享链接时的默认过期天数，0 表示永不过期">
          <input
            type="number"
            min={0}
            max={365}
            value={config.shareDefaultExpireDays}
            onChange={e => set({ shareDefaultExpireDays: Number(e.target.value) })}
            className={inputClass()}
          />
        </Field>
      </Section>

      {/* ── Cloudflare Workers ───────────────────────────── */}
      <Section title="Cloudflare Workers">
        <Field label="Workers URL" hint="用于文件代理下载的 Cloudflare Workers 地址">
          <input
            type="url"
            value={config.cfWorkersUrl}
            onChange={e => set({ cfWorkersUrl: e.target.value })}
            placeholder="https://your-worker.your-subdomain.workers.dev"
            className={inputClass()}
          />
        </Field>
      </Section>

      {/* ── SMTP ─────────────────────────────────────────── */}
      <Section title="SMTP 邮件配置">
        <Field label="SMTP 主机">
          <input
            type="text"
            value={config.smtp.host}
            onChange={e => setSmtp({ host: e.target.value })}
            placeholder="smtp.example.com"
            className={inputClass()}
          />
        </Field>
        <Field label="SMTP 端口">
          <input
            type="number"
            min={1}
            max={65535}
            value={config.smtp.port}
            onChange={e => setSmtp({ port: Number(e.target.value) })}
            placeholder="587"
            className={inputClass()}
          />
        </Field>
        <Field label="SMTP 用户名">
          <input
            type="text"
            value={config.smtp.user}
            onChange={e => setSmtp({ user: e.target.value })}
            placeholder="noreply@example.com"
            className={inputClass()}
          />
        </Field>
        <Field label="SMTP 密码">
          <div className="relative">
            <input
              type={showSmtpPass ? 'text' : 'password'}
              value={config.smtp.pass}
              onChange={e => setSmtp({ pass: e.target.value })}
              placeholder="••••••••"
              autoComplete="new-password"
              className={`${inputClass()} pr-10`}
            />
            <button
              type="button"
              onClick={() => setShowSmtpPass(v => !v)}
              title={showSmtpPass ? '隐藏密码' : '显示密码'}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-200"
            >
              {showSmtpPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </Field>
        <Field label="发件人地址 (From)">
          <input
            type="email"
            value={config.smtp.from}
            onChange={e => setSmtp({ from: e.target.value })}
            placeholder="TG 云盘 <noreply@example.com>"
            className={inputClass()}
          />
        </Field>

        {/* Test email — two-step: send a real 6-digit code, then admin types
            what they received so we verify the round trip. Pre-fix the
            button only said "邮件已发送" even when the relay had silently
            dropped the message; now the admin must close the loop. */}
        <div className="pt-2 border-t border-gray-100 dark:border-gray-700 space-y-3">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">发送测试邮件（验证码 5 分钟内有效）</p>
          <div className="flex gap-2">
            <input
              type="email"
              value={testEmailTarget}
              onChange={e => setTestEmailTarget(e.target.value)}
              placeholder="输入接收测试邮件的地址"
              className={`flex-1 ${inputClass()}`}
            />
            <button
              onClick={handleTestEmail}
              disabled={testingEmail}
              className="flex items-center gap-2 px-4 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap"
            >
              {testingEmail ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
              {emailSent ? '重新发送' : '发送测试'}
            </button>
          </div>
          {emailSent && (
            <div className="flex gap-2">
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={emailVerifyCode}
                onChange={e => setEmailVerifyCode(e.target.value.replace(/\D/g, ''))}
                placeholder="输入收到的 6 位验证码"
                className={`flex-1 ${inputClass()}`}
              />
              <button
                onClick={handleVerifyEmail}
                disabled={verifyingEmail || emailVerifyCode.length !== 6}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap"
              >
                {verifyingEmail ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                核对验证码
              </button>
            </div>
          )}
        </div>
      </Section>

      {/* ── SMS Provider ─────────────────────────────────────── */}
      <Section title="短信 SMS Provider 配置">
        <Field
          label="SMS Provider"
          hint="选择短信网关。'none' 时验证码走 dev 模式（前端 toast 显示）。"
        >
          <div className="flex gap-4 flex-wrap">
            {([
              { value: 'none', label: '不启用 (dev toast)' },
              { value: 'twilio', label: 'Twilio' },
              { value: 'aliyun', label: '阿里云' },
              { value: 'aws-sns', label: 'AWS SNS' },
              { value: 'telegram-bot', label: 'Telegram Bot' },
            ] as { value: SmsProvider; label: string }[]).map(opt => (
              <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="smsProvider"
                  value={opt.value}
                  checked={config.sms.provider === opt.value}
                  onChange={() => setSms({ provider: opt.value })}
                  className="w-4 h-4 text-blue-600"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">{opt.label}</span>
              </label>
            ))}
          </div>
        </Field>

        {/* Twilio */}
        {config.sms.provider === 'twilio' && (
          <>
            <Field label="Account SID" hint="Twilio 控制台 → Account Info">
              <input
                type="text"
                value={config.sms.accountSid}
                onChange={e => setSms({ accountSid: e.target.value })}
                placeholder="AC..."
                className={inputClass()}
              />
            </Field>
            <Field label="Auth Token">
              <div className="relative">
                <input
                  type={showSmsSecret ? 'text' : 'password'}
                  value={config.sms.authToken}
                  onChange={e => setSms({ authToken: e.target.value })}
                  placeholder="留空保留已配置值"
                  autoComplete="new-password"
                  className={`${inputClass()} pr-10`}
                />
                <button
                  type="button"
                  onClick={() => setShowSmsSecret(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-200"
                >
                  {showSmsSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </Field>
            <Field label="发送号码 (From)" hint="E.164 格式，如 +15005550006">
              <input
                type="text"
                value={config.sms.from}
                onChange={e => setSms({ from: e.target.value })}
                placeholder="+1xxxxxxxxxx"
                className={inputClass()}
              />
            </Field>
          </>
        )}

        {/* Aliyun */}
        {config.sms.provider === 'aliyun' && (
          <>
            <Field label="AccessKey ID">
              <input
                type="text"
                value={config.sms.accessKeyId}
                onChange={e => setSms({ accessKeyId: e.target.value })}
                placeholder="LTAI..."
                className={inputClass()}
              />
            </Field>
            <Field label="AccessKey Secret">
              <div className="relative">
                <input
                  type={showSmsSecret ? 'text' : 'password'}
                  value={config.sms.accessKeySecret}
                  onChange={e => setSms({ accessKeySecret: e.target.value })}
                  placeholder="留空保留已配置值"
                  autoComplete="new-password"
                  className={`${inputClass()} pr-10`}
                />
                <button
                  type="button"
                  onClick={() => setShowSmsSecret(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-200"
                >
                  {showSmsSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </Field>
            <Field label="签名 SignName" hint="已备案的短信签名">
              <input
                type="text"
                value={config.sms.signName}
                onChange={e => setSms({ signName: e.target.value })}
                placeholder="如：TG云盘"
                className={inputClass()}
              />
            </Field>
            <Field label="模板 ID" hint="如 SMS_xxxxxxxx，模板需含 ${code} 变量">
              <input
                type="text"
                value={config.sms.templateCode}
                onChange={e => setSms({ templateCode: e.target.value })}
                placeholder="SMS_xxxxxxxx"
                className={inputClass()}
              />
            </Field>
          </>
        )}

        {/* AWS SNS */}
        {config.sms.provider === 'aws-sns' && (
          <>
            <Field label="AccessKey ID">
              <input
                type="text"
                value={config.sms.accessKeyId}
                onChange={e => setSms({ accessKeyId: e.target.value })}
                placeholder="AKIA..."
                className={inputClass()}
              />
            </Field>
            <Field label="Secret AccessKey">
              <div className="relative">
                <input
                  type={showSmsSecret ? 'text' : 'password'}
                  value={config.sms.accessKeySecret}
                  onChange={e => setSms({ accessKeySecret: e.target.value })}
                  placeholder="留空保留已配置值"
                  autoComplete="new-password"
                  className={`${inputClass()} pr-10`}
                />
                <button
                  type="button"
                  onClick={() => setShowSmsSecret(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-200"
                >
                  {showSmsSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </Field>
            <Field label="Region" hint="如 us-east-1 / ap-northeast-1">
              <input
                type="text"
                value={config.sms.region}
                onChange={e => setSms({ region: e.target.value })}
                placeholder="us-east-1"
                className={inputClass()}
              />
            </Field>
          </>
        )}

        {/* Telegram Bot */}
        {config.sms.provider === 'telegram-bot' && (
          <>
            <Field
              label="Bot Token"
              hint="@BotFather 申请。用户须先 /start 该 bot 并绑定账号才能收到 OTP。"
            >
              <div className="relative">
                <input
                  type={showSmsSecret ? 'text' : 'password'}
                  value={config.sms.botToken}
                  onChange={e => setSms({ botToken: e.target.value })}
                  placeholder="留空保留已配置值"
                  autoComplete="new-password"
                  className={`${inputClass()} pr-10`}
                />
                <button
                  type="button"
                  onClick={() => setShowSmsSecret(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-200"
                >
                  {showSmsSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </Field>
          </>
        )}

        {config.sms.provider === 'none' && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            未启用任何短信通道。开发环境下，所有验证码会在前端以 toast 直接显示
            （后端 verification.service.ts L64-67）。生产环境请选择并配置真实
            provider。
          </p>
        )}

        {/* Test SMS — same two-step flow as email */}
        <div className="pt-2 border-t border-gray-100 dark:border-gray-700 space-y-3">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">发送测试短信（验证码 5 分钟内有效）</p>
          <div className="flex gap-2">
            <input
              type="tel"
              value={testSmsTarget}
              onChange={e => setTestSmsTarget(e.target.value)}
              placeholder="输入测试手机号（含国际区号，如 +8613800000000）"
              className={`flex-1 ${inputClass()}`}
            />
            <button
              onClick={handleTestSms}
              disabled={testingSms}
              className="flex items-center gap-2 px-4 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap"
            >
              {testingSms ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
              {smsSent ? '重新发送' : '发送测试'}
            </button>
          </div>
          {smsSent && (
            <div className="flex gap-2">
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={smsVerifyCode}
                onChange={e => setSmsVerifyCode(e.target.value.replace(/\D/g, ''))}
                placeholder="输入收到的 6 位验证码"
                className={`flex-1 ${inputClass()}`}
              />
              <button
                onClick={handleVerifySms}
                disabled={verifyingSms || smsVerifyCode.length !== 6}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap"
              >
                {verifyingSms ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                核对验证码
              </button>
            </div>
          )}
        </div>
      </Section>

      {/* Bottom save */}
      <div className="flex justify-end pb-4">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-xl transition-colors disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
          保存所有配置
        </button>
      </div>

      {confirmOpen && (
        <ConfirmPasswordDialog
          title="确认系统配置变更"
          confirmLabel="确认保存"
          destructive
          description={
            <>
              您正在修改全局系统配置（SMTP、注册策略、分享默认值等），变更将<strong>影响所有用户</strong>。请输入您的管理员密码以确认。
            </>
          }
          onConfirm={submitConfig}
          onClose={() => setConfirmOpen(false)}
        />
      )}
    </div>
  );
}
