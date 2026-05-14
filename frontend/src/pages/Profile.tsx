import { useState, useEffect } from 'react';
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

// P1-F1: hoisted out of SecurityTab. Pre-fix this component was defined
// inside the function body, so React saw a fresh function identity on every
// parent render — unmount/remount the <input>, losing focus on every keystroke.
// Moving the declaration to module scope keeps the component identity stable.
function PwInput({
  label,
  value,
  show,
  onChange,
  onToggle,
}: {
  label: string;
  value: string;
  show: boolean;
  onChange: (v: string) => void;
  onToggle: () => void;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-gray-300">{label}</label>
      <div className="relative">
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={e => onChange(e.target.value)}
          className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600"
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
  { id: 'profile', label: '基本信息', icon: <User className="w-4 h-4" /> },
  { id: 'security', label: '安全设置', icon: <Shield className="w-4 h-4" /> },
  { id: 'devices', label: '登录设备', icon: <Monitor className="w-4 h-4" /> },
  { id: 'logs', label: '操作日志', icon: <ClipboardList className="w-4 h-4" /> },
  { id: 'storage', label: '存储统计', icon: <BarChart2 className="w-4 h-4" /> },
];

// ── Profile Tab ────────────────────────────────────────────────
function ProfileTab() {
  const { user, setUser } = useAuthStore();
  const [username, setUsername] = useState(user?.username ?? '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await usersApi.updateProfile({ username }) as any;
      setUser(res ?? { ...user!, username });
      toast.success('个人信息已更新');
    } catch {
      // interceptor
    } finally {
      setSaving(false);
    }
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
            {user.role === 'admin' ? '管理员' : '用户'}
          </span>
        </div>
      </div>

      {/* Form */}
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-gray-300">用户名</label>
          <input
            type="text"
            value={username}
            onChange={e => setUsername(e.target.value)}
            placeholder="登录用户名"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600"
          />
          <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">修改后需重新登录</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-gray-300">存储使用</label>
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
          保存修改
        </button>
      </div>
    </div>
  );
}

// ── Security Tab ───────────────────────────────────────────────
function SecurityTab() {
  const [pwForm, setPwForm] = useState({ oldPassword: '', newPassword: '', confirm: '' });
  const [showPw, setShowPw] = useState({ old: false, new: false, confirm: false });
  const [pwSaving, setPwSaving] = useState(false);

  const [ppForm, setPpForm] = useState({ newPassword: '', confirm: '' });
  const [ppSaving, setPpSaving] = useState(false);
  const [ppSetup, setPpSetup] = useState(false); // toggle for change vs setup

  const [notifs, setNotifs] = useState({ shareAccess: true, foreignLogin: true });
  const [notifSaving, setNotifSaving] = useState(false);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pwForm.newPassword !== pwForm.confirm) {
      toast.error('两次密码输入不一致');
      return;
    }
    if (pwForm.newPassword.length < 8) {
      toast.error('新密码至少 8 位');
      return;
    }
    setPwSaving(true);
    try {
      await usersApi.changePassword({
        oldPassword: pwForm.oldPassword,
        newPassword: pwForm.newPassword,
      });
      toast.success('密码修改成功，请重新登录');
      setPwForm({ oldPassword: '', newPassword: '', confirm: '' });
    } catch {
      // interceptor
    } finally {
      setPwSaving(false);
    }
  };

  const handleSetupPrivateSpace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (ppForm.newPassword !== ppForm.confirm) {
      toast.error('两次密码输入不一致');
      return;
    }
    setPpSaving(true);
    try {
      await usersApi.setupPrivateSpace({ password: ppForm.newPassword });
      toast.success('隐私空间密码设置成功');
      setPpForm({ newPassword: '', confirm: '' });
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
      toast.success('通知设置已保存');
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
        <h3 className="text-base font-semibold text-gray-900 mb-4 pb-2 border-b border-gray-200 dark:text-gray-100 dark:border-gray-700">修改登录密码</h3>
        <form onSubmit={handleChangePassword} className="space-y-4">
          <PwInput
            label="当前密码"
            value={pwForm.oldPassword}
            show={showPw.old}
            onChange={v => setPwForm(f => ({ ...f, oldPassword: v }))}
            onToggle={() => setShowPw(s => ({ ...s, old: !s.old }))}
          />
          <PwInput
            label="新密码（至少 8 位）"
            value={pwForm.newPassword}
            show={showPw.new}
            onChange={v => setPwForm(f => ({ ...f, newPassword: v }))}
            onToggle={() => setShowPw(s => ({ ...s, new: !s.new }))}
          />
          <PwInput
            label="确认新密码"
            value={pwForm.confirm}
            show={showPw.confirm}
            onChange={v => setPwForm(f => ({ ...f, confirm: v }))}
            onToggle={() => setShowPw(s => ({ ...s, confirm: !s.confirm }))}
          />
          <button
            type="submit"
            disabled={pwSaving || !pwForm.oldPassword || !pwForm.newPassword}
            className="flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
          >
            {pwSaving && <Loader2 className="w-4 h-4 animate-spin" />}
            修改密码
          </button>
        </form>
      </section>

      {/* Private Space Password */}
      <section>
        <h3 className="text-base font-semibold text-gray-900 mb-4 pb-2 border-b border-gray-200 dark:text-gray-100 dark:border-gray-700">隐私空间密码</h3>
        <p className="text-sm text-gray-500 mb-4 dark:text-gray-400">隐私空间密码用于加密访问私密文件夹，独立于登录密码。</p>
        <form onSubmit={handleSetupPrivateSpace} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-gray-300">新隐私空间密码</label>
            <input
              type="password"
              value={ppForm.newPassword}
              onChange={e => setPpForm(f => ({ ...f, newPassword: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600"
              placeholder="至少 6 位"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-gray-300">确认密码</label>
            <input
              type="password"
              value={ppForm.confirm}
              onChange={e => setPpForm(f => ({ ...f, confirm: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600"
            />
          </div>
          <button
            type="submit"
            disabled={ppSaving || !ppForm.newPassword}
            className="flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
          >
            {ppSaving && <Loader2 className="w-4 h-4 animate-spin" />}
            {ppSetup ? '修改密码' : '设置密码'}
          </button>
        </form>
      </section>

      {/* Notification Settings */}
      <section>
        <h3 className="text-base font-semibold text-gray-900 mb-4 pb-2 border-b border-gray-200 dark:text-gray-100 dark:border-gray-700">通知设置</h3>
        <div className="space-y-3">
          {[
            { key: 'shareAccess', label: '有人访问我的分享链接时通知我', icon: <Bell className="w-4 h-4 text-blue-500" /> },
            { key: 'foreignLogin', label: '异地登录时通知我', icon: <AlertTriangle className="w-4 h-4 text-orange-500" /> },
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
          保存设置
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
      toast.success('设备已下线');
    } catch {
      // interceptor
    }
  };

  if (isLoading) return <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-blue-500" /></div>;

  return (
    <div className="space-y-3 max-w-2xl">
      <p className="text-sm text-gray-500 mb-4 dark:text-gray-400">以下设备当前已登录您的账号。如有陌生设备，请立即下线并修改密码。</p>
      {devices.map(device => (
        <div
          key={device.id}
          className={`flex items-center gap-4 p-4 rounded-xl border transition-colors ${
            device.isCurrent ? 'border-blue-200 bg-blue-50' : 'border-gray-200 bg-white hover:bg-gray-50'
          }`}
        >
          <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center flex-shrink-0 dark:bg-gray-700">
            <Monitor className="w-5 h-5 text-gray-500 dark:text-gray-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-medium text-gray-800 text-sm truncate dark:text-gray-100">{device.deviceName ?? '未知设备'}</p>
              {device.isCurrent && (
                <span className="px-1.5 py-0.5 text-xs bg-blue-600 text-white rounded font-medium">当前设备</span>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-0.5 dark:text-gray-400">
              IP: {device.ipAddress ?? '—'} &nbsp;·&nbsp; 最后活跃: {formatDate(device.lastActiveAt)}
            </p>
          </div>
          {!device.isCurrent && (
            <button
              onClick={() => handleRevoke(device.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors flex-shrink-0"
            >
              <LogOut className="w-4 h-4" />
              下线
            </button>
          )}
        </div>
      ))}
      {devices.length === 0 && (
        <p className="text-center text-gray-400 py-10 dark:text-gray-500">暂无登录设备</p>
      )}
    </div>
  );
}

// ── Audit Logs Tab ─────────────────────────────────────────────
function AuditLogsTab() {
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;

  const { data, isLoading } = useQuery<{ logs: AuditLog[]; total: number }>({
    queryKey: ['audit-logs', page],
    queryFn: async () => {
      const res = await usersApi.auditLogs({ page, limit: PAGE_SIZE }) as any;
      return { logs: res?.logs ?? res ?? [], total: res?.total ?? 0 };
    },
    staleTime: 30_000,
  });

  const logs = data?.logs ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const actionBadge = (action: string) => {
    const map: Record<string, string> = {
      upload: 'bg-green-100 text-green-700',
      download: 'bg-blue-100 text-blue-700',
      delete: 'bg-red-100 text-red-700',
      login: 'bg-purple-100 text-purple-700',
      share: 'bg-yellow-100 text-yellow-700',
    };
    const key = Object.keys(map).find(k => action.toLowerCase().includes(k)) ?? '';
    return map[key] || 'bg-gray-100 text-gray-600';
  };

  if (isLoading) return <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-blue-500" /></div>;

  return (
    <div className="max-w-3xl">
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm dark:bg-gray-800 dark:border-gray-700">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200 dark:bg-gray-900 dark:border-gray-700">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase dark:text-gray-400">操作</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase hidden md:table-cell dark:text-gray-400">文件</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase hidden lg:table-cell dark:text-gray-400">IP 地址</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase dark:text-gray-400">时间</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {logs.length === 0 ? (
              <tr>
                <td colSpan={4} className="text-center py-8 text-gray-400 dark:text-gray-500">暂无操作记录</td>
              </tr>
            ) : (
              logs.map(log => (
                <tr key={log.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-0.5 text-xs rounded-full font-medium ${actionBadge(log.action)}`}>
                      {log.action}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600 hidden md:table-cell dark:text-gray-300">
                    <span className="truncate max-w-[160px] block">{log.nodeName ?? '—'}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs font-mono hidden lg:table-cell dark:text-gray-400">
                    {log.ipAddress ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs dark:text-gray-400">
                    {formatDate(log.createdAt)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-xs text-gray-500 dark:text-gray-400">共 {total} 条记录</p>
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
            <p className="text-sm text-gray-500 dark:text-gray-400">已使用存储</p>
            <p className="text-2xl font-bold text-gray-900 mt-1 dark:text-gray-100">{formatBytes(stats.usedBytes)}</p>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400">共 {formatBytes(stats.quotaBytes)}</p>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-3 dark:bg-gray-700">
          <div
            className={`h-3 rounded-full transition-all ${usedPct > 90 ? 'bg-red-500' : usedPct > 70 ? 'bg-orange-500' : 'bg-blue-500'}`}
            style={{ width: `${usedPct}%` }}
          />
        </div>
        <p className="text-xs text-gray-400 mt-1.5 text-right dark:text-gray-500">{usedPct.toFixed(1)}% 已使用</p>
      </div>

      {/* By type bars */}
      {stats.byType && stats.byType.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm dark:bg-gray-800 dark:border-gray-700">
          <h3 className="text-sm font-semibold text-gray-900 mb-4 dark:text-gray-100">按类型分布</h3>
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
export default function Profile() {
  const [activeTab, setActiveTab] = useState<Tab>('profile');

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
                ? 'bg-blue-50 text-blue-700'
                : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
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
