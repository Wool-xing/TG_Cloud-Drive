import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Save,
  Mail,
  Loader2,
  X,
  CheckCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';

import { adminApi } from '../../api/client';

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
    <div className="flex flex-wrap gap-1.5 min-h-[40px] px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-transparent bg-white dark:bg-gray-700">
      {tags.map(tag => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-100 dark:bg-gray-600 text-gray-700 dark:text-gray-300 text-xs rounded-full"
        >
          {tag}
          <button
            type="button"
            onClick={() => removeTag(tag)}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
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
        className="flex-1 min-w-[100px] text-sm outline-none bg-transparent text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500"
      />
    </div>
  );
}

// ── Section Wrapper ────────────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h3>
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
  });

  const [saving, setSaving] = useState(false);
  const [testingEmail, setTestingEmail] = useState(false);
  const [testEmailTarget, setTestEmailTarget] = useState('');

  useEffect(() => {
    if (remoteConfig) setConfig(remoteConfig);
  }, [remoteConfig]);

  const set = (partial: Partial<SystemConfig>) => setConfig(c => ({ ...c, ...partial }));
  const setSmtp = (partial: Partial<SystemConfig['smtp']>) =>
    setConfig(c => ({ ...c, smtp: { ...c.smtp, ...partial } }));

  const handleSave = async () => {
    if (config.defaultQuotaGB < 1) { toast.error('默认配额不能小于1GB'); return; }
    if (config.maxFoldersPerDir < 1) { toast.error('每目录最大文件夹数不能小于1'); return; }
    if (config.loginFailLockCount < 1) { toast.error('登录失败锁定次数不能小于1'); return; }
    if (config.loginLockDuration < 1) { toast.error('锁定时长不能小于1秒'); return; }
    if (config.shareDefaultExpireDays < 0) { toast.error('分享有效期不能为负数'); return; }
    if (config.smtp.port < 1 || config.smtp.port > 65535) { toast.error('SMTP端口需在1-65535范围内'); return; }
    setSaving(true);
    try {
      await adminApi.updateConfig(config);
      toast.success('配置已保存');
    } catch {
      // interceptor
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
      await adminApi.testEmail({ to: testEmailTarget, smtpConfig: config.smtp });
      toast.success('测试邮件已发送，请检查收件箱');
    } catch {
      // interceptor
    } finally {
      setTestingEmail(false);
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
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">系统配置</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">管理全局系统设置</p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          保存配置
        </button>
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
          <input
            type="password"
            value={config.smtp.pass}
            onChange={e => setSmtp({ pass: e.target.value })}
            placeholder="••••••••"
            className={inputClass()}
          />
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

        {/* Test email */}
        <div className="pt-2 border-t border-gray-100 dark:border-gray-700">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">发送测试邮件</p>
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
              发送测试
            </button>
          </div>
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
    </div>
  );
}
