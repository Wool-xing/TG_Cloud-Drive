import { useState, ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Search,
  Plus,
  Loader2,
  Edit,
  LogOut,
  Trash2,
  ChevronLeft,
  ChevronRight,
  X,
  Eye,
  EyeOff,
} from 'lucide-react';
import toast from 'react-hot-toast';

import { adminApi } from '../../api/client';
import { User } from '../../types';
import { formatBytes } from '../../utils/crypto';
import ConfirmPasswordDialog from '../../components/dialogs/ConfirmPasswordDialog';

const PAGE_SIZE = 20;

interface AdminUser extends User {
  email?: string;
  status: 'active' | 'disabled';
}

// ── Edit User Modal ─────────────────────────────────────────────
function EditModal({
  user,
  onClose,
  onSuccess,
}: {
  user: AdminUser;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [form, setForm] = useState({
    username: user.username ?? '',
    role: user.role,
    status: user.status ?? 'active',
    quotaGB: Math.round(user.quotaBytes / (1024 ** 3)),
  });
  const [saving, setSaving] = useState(false);
  const [confirmPending, setConfirmPending] = useState<null | {
    dto: any;
  }>(null);

  const buildDto = () => ({
    username: form.username,
    role: form.role,
    status: form.status,
    quotaBytes: Math.max(1, form.quotaGB) * (1024 ** 3),
  });

  // P1-I7: role / status changes are high-risk on the backend
  // (admin.service.ts#updateUser gates them behind requireConfirm). Other
  // edits — rename / quota — stay low-friction.
  const needsConfirm = () => form.role !== user.role || form.status !== (user.status ?? 'active');

  const handleSave = async () => {
    if (form.quotaGB < 1) {
      toast.error('存储配额不能小于1GB');
      return;
    }
    if (needsConfirm()) {
      setConfirmPending({ dto: buildDto() });
      return;
    }
    setSaving(true);
    try {
      await adminApi.updateUser(user.id, buildDto());
      toast.success('用户信息已更新');
      onSuccess();
    } catch {
      // interceptor
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500';

  return (
    <>
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">编辑用户 — {user.username}</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"><X className="w-5 h-5 text-gray-400" /></button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">用户名</label>
            <input
              type="text"
              value={form.username}
              onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">角色</label>
            <select
              value={form.role}
              onChange={e => setForm(f => ({ ...f, role: e.target.value as 'user' | 'admin' }))}
              className={inputCls}
            >
              <option value="user">普通用户</option>
              <option value="admin">管理员</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">状态</label>
            <select
              value={form.status}
              onChange={e => setForm(f => ({ ...f, status: e.target.value as 'active' | 'disabled' }))}
              className={inputCls}
            >
              <option value="active">正常</option>
              <option value="disabled">封禁</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">存储配额 (GB)</label>
            <input
              type="number"
              min={1}
              max={10000}
              value={form.quotaGB}
              onChange={e => setForm(f => ({ ...f, quotaGB: Number(e.target.value) }))}
              className={inputCls}
            />
          </div>
        </div>
        <div className="flex gap-3 justify-end mt-6">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg">取消</button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            保存
          </button>
        </div>
      </div>
    </div>
    {confirmPending && (
      <ConfirmPasswordDialog
        title="确认权限变更"
        description={
          <>
            您正在修改 <strong>{user.username}</strong> 的角色或状态。该操作可能影响账号访问权限，需再次输入您的管理员密码确认。
          </>
        }
        confirmLabel="确认修改"
        destructive
        onConfirm={async (pw) => {
          await adminApi.updateUser(user.id, { ...confirmPending.dto, confirmPassword: pw });
          toast.success('用户信息已更新');
          onSuccess();
        }}
        onClose={() => setConfirmPending(null)}
      />
    )}
    </>
  );
}

// ── Create User Modal ───────────────────────────────────────────
function CreateModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [form, setForm] = useState({
    username: '',
    password: '',
    email: '',
    role: 'user' as 'user' | 'admin',
  });
  const [showPw, setShowPw] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleCreate = async () => {
    if (!form.username || !form.password) {
      toast.error('用户名和密码必填');
      return;
    }
    setSaving(true);
    try {
      await adminApi.createUser(form);
      toast.success('用户创建成功');
      onSuccess();
    } catch {
      // interceptor
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">创建用户</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"><X className="w-5 h-5 text-gray-400" /></button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">用户名 *</label>
            <input
              type="text"
              value={form.username}
              onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
              placeholder="仅限字母、数字、下划线"
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">密码 *</label>
            <div className="relative">
              <input
                type={showPw ? 'text' : 'password'}
                value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                placeholder="至少 8 位"
                className={`${inputCls} pr-10`}
              />
              <button
                type="button"
                onClick={() => setShowPw(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">邮箱（可选）</label>
            <input
              type="email"
              value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              placeholder="user@example.com"
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">角色</label>
            <select
              value={form.role}
              onChange={e => setForm(f => ({ ...f, role: e.target.value as 'user' | 'admin' }))}
              className={inputCls}
            >
              <option value="user">普通用户</option>
              <option value="admin">管理员</option>
            </select>
          </div>
        </div>
        <div className="flex gap-3 justify-end mt-6">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg">取消</button>
          <button
            onClick={handleCreate}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            创建
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Users Page ─────────────────────────────────────────────
interface ConfirmAction {
  title: string;
  description: ReactNode;
  destructive: boolean;
  confirmLabel: string;
  run: (password: string) => Promise<void>;
}

export default function AdminUsers() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [editUser, setEditUser] = useState<AdminUser | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);

  const { data, isLoading } = useQuery<{ users: AdminUser[]; total: number }>({
    queryKey: ['admin', 'users', search, page],
    queryFn: async () => {
      const res = await adminApi.users({ search, page, limit: PAGE_SIZE }) as any;
      return { users: res?.users ?? res ?? [], total: res?.total ?? 0 };
    },
    staleTime: 30_000,
  });

  const users = data?.users ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });

  // P1-I7: every high-risk admin action funnels through ConfirmPasswordDialog.
  // The backend (requireConfirm) verifies the password before any state change,
  // so a stolen access token alone cannot delete users / force-logout / toggle
  // status — the operator must still know the admin's own password.
  const handleForceLogout = (user: AdminUser) => {
    setConfirmAction({
      title: '强制下线',
      destructive: false,
      confirmLabel: '强制下线',
      description: (
        <>
          将立即终止用户 <strong>{user.username}</strong> 的全部活跃会话。请输入您的管理员密码以确认。
        </>
      ),
      run: async (pw) => {
        await adminApi.forceLogout(user.id, pw);
        toast.success(`已强制下线用户 ${user.username}`);
      },
    });
  };

  const handleDelete = (user: AdminUser) => {
    setConfirmAction({
      title: '删除用户',
      destructive: true,
      confirmLabel: '确认删除',
      description: (
        <>
          确定要删除用户 <strong>{user.username}</strong> 吗？此操作将同时删除该用户的所有文件，<strong>无法撤销</strong>。请输入您的管理员密码以确认。
        </>
      ),
      run: async (pw) => {
        await adminApi.deleteUser(user.id, pw);
        invalidate();
        toast.success('用户已删除');
      },
    });
  };

  const handleToggleStatus = (user: AdminUser) => {
    const newStatus = user.status === 'active' ? 'disabled' : 'active';
    const verb = newStatus === 'active' ? '解除封禁' : '封禁';
    setConfirmAction({
      title: `${verb}用户`,
      destructive: newStatus === 'disabled',
      confirmLabel: `确认${verb}`,
      description: (
        <>
          您正在{verb} <strong>{user.username}</strong>。该操作会立即影响其登录与访问能力，请输入您的管理员密码以确认。
        </>
      ),
      run: async (pw) => {
        await adminApi.updateUser(user.id, { status: newStatus, confirmPassword: pw });
        invalidate();
        toast.success(newStatus === 'active' ? '已解除封禁' : '已封禁用户');
      },
    });
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">用户管理</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">共 {total} 位用户</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          创建用户
        </button>
      </div>

      {/* Search */}
      <div className="relative max-w-xs">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
          placeholder="搜索用户名或昵称..."
          className="w-full pl-9 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">用户名</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase hidden md:table-cell">角色</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">状态</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase hidden lg:table-cell">存储使用</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase hidden xl:table-cell">注册时间</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {isLoading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="animate-pulse">
                      {Array.from({ length: 6 }).map((_, j) => (
                        <td key={j} className="px-4 py-3">
                          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-20" />
                        </td>
                      ))}
                    </tr>
                  ))
                : users.map(user => {
                    const usedPct = user.quotaBytes > 0 ? Math.min(100, (user.usedBytes / user.quotaBytes) * 100) : 0;
                    return (
                      <tr key={user.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                        {/* Username */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <div className="w-7 h-7 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center flex-shrink-0">
                              <span className="text-xs font-bold text-blue-600 dark:text-blue-400">
                                {(user.nickname ?? user.username)[0].toUpperCase()}
                              </span>
                            </div>
                            <div>
                              <p className="font-medium text-gray-800 dark:text-gray-200">{user.username}</p>
                              {user.nickname && <p className="text-xs text-gray-400 dark:text-gray-500">{user.nickname}</p>}
                            </div>
                          </div>
                        </td>

                        {/* Role */}
                        <td className="px-4 py-3 hidden md:table-cell">
                          <span className={`inline-block px-2 py-0.5 text-xs rounded-full font-medium ${
                            user.role === 'admin'
                              ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400'
                              : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
                          }`}>
                            {user.role === 'admin' ? '管理员' : '用户'}
                          </span>
                        </td>

                        {/* Status */}
                        <td className="px-4 py-3">
                          <button
                            onClick={() => handleToggleStatus(user)}
                            className={`inline-flex items-center px-2 py-0.5 text-xs rounded-full font-medium transition-colors ${
                              user.status === 'active'
                                ? 'bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900/40 dark:text-green-400 dark:hover:bg-green-900/60'
                                : 'bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/40 dark:text-red-400 dark:hover:bg-red-900/60'
                            }`}
                          >
                            {user.status === 'active' ? '正常' : '封禁'}
                          </button>
                        </td>

                        {/* Storage */}
                        <td className="px-4 py-3 hidden lg:table-cell">
                          <div className="flex items-center gap-2 min-w-[120px]">
                            <div className="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-1.5">
                              <div
                                className={`h-1.5 rounded-full ${usedPct > 90 ? 'bg-red-500' : usedPct > 70 ? 'bg-orange-500' : 'bg-blue-500'}`}
                                style={{ width: `${usedPct}%` }}
                              />
                            </div>
                            <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                              {formatBytes(user.usedBytes)}
                            </span>
                          </div>
                        </td>

                        {/* Created */}
                        <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs hidden xl:table-cell">
                          {new Date(user.createdAt).toLocaleDateString('zh-CN')}
                        </td>

                        {/* Actions */}
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => setEditUser(user)}
                              className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors"
                              title="编辑"
                            >
                              <Edit className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleForceLogout(user)}
                              className="p-1.5 rounded-lg text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-900/30 transition-colors"
                              title="强制下线"
                            >
                              <LogOut className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleDelete(user)}
                              className="p-1.5 rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
                              title="删除"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/30">
            <p className="text-xs text-gray-500 dark:text-gray-400">共 {total} 条，第 {page} / {totalPages} 页</p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="p-1.5 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-40 transition-colors text-gray-600 dark:text-gray-400"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="p-1.5 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-40 transition-colors text-gray-600 dark:text-gray-400"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modals */}
      {editUser && (
        <EditModal
          user={editUser}
          onClose={() => setEditUser(null)}
          onSuccess={() => { setEditUser(null); invalidate(); }}
        />
      )}
      {showCreate && (
        <CreateModal
          onClose={() => setShowCreate(false)}
          onSuccess={() => { setShowCreate(false); invalidate(); }}
        />
      )}
      {confirmAction && (
        <ConfirmPasswordDialog
          title={confirmAction.title}
          description={confirmAction.description}
          confirmLabel={confirmAction.confirmLabel}
          destructive={confirmAction.destructive}
          onConfirm={confirmAction.run}
          onClose={() => setConfirmAction(null)}
        />
      )}
    </div>
  );
}
