import { useState, ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { t } from '../../i18n/translations';
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

  const needsConfirm = () => form.role !== user.role || form.status !== (user.status ?? 'active');

  const handleSave = async () => {
    if (form.quotaGB < 1) {
      toast.error(t('admin.users.quotaMin'));
      return;
    }
    if (needsConfirm()) {
      setConfirmPending({ dto: buildDto() });
      return;
    }
    setSaving(true);
    try {
      await adminApi.updateUser(user.id, buildDto());
      toast.success(t('admin.users.updated'));
      onSuccess();
    } catch {
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
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('admin.users.editTitle', { name: user.username })}</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"><X className="w-5 h-5 text-gray-400 dark:text-gray-500" /></button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('admin.users.fieldUsername')}</label>
            <input
              type="text"
              value={form.username}
              onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('admin.users.fieldRole')}</label>
            <select
              value={form.role}
              onChange={e => setForm(f => ({ ...f, role: e.target.value as 'user' | 'admin' }))}
              className={inputCls}
            >
              <option value="user">{t('admin.users.roleUser')}</option>
              <option value="admin">{t('admin.users.roleAdmin')}</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('admin.users.fieldStatus')}</label>
            <select
              value={form.status}
              onChange={e => setForm(f => ({ ...f, status: e.target.value as 'active' | 'disabled' }))}
              className={inputCls}
            >
              <option value="active">{t('admin.users.statusActive')}</option>
              <option value="disabled">{t('admin.users.statusDisabled')}</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('admin.users.fieldQuota')}</label>
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
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg">{t('common.cancel')}</button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {t('common.save') || t('admin.users.save')}
          </button>
        </div>
      </div>
    </div>
    {confirmPending && (
      <ConfirmPasswordDialog
        title={t('admin.users.confirmRoleTitle')}
        description={
          <>
            {t('admin.users.confirmRoleBody', { name: user.username })}
          </>
        }
        confirmLabel={t('admin.users.confirmRoleBtn')}
        destructive
        onConfirm={async (pw) => {
          await adminApi.updateUser(user.id, { ...confirmPending.dto, confirmPassword: pw });
          toast.success(t('admin.users.updated'));
          onSuccess();
        }}
        onClose={() => setConfirmPending(null)}
      />
    )}
    </>
  );
}

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
      toast.error(t('admin.users.usernamePasswordRequired'));
      return;
    }
    setSaving(true);
    try {
      await adminApi.createUser(form);
      toast.success(t('admin.users.created'));
      onSuccess();
    } catch {
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('admin.users.createTitle')}</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"><X className="w-5 h-5 text-gray-400 dark:text-gray-500" /></button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('admin.users.fieldUsernameReq')}</label>
            <input
              type="text"
              value={form.username}
              onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
              placeholder={t('admin.users.usernamePlaceholder')}
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('admin.users.fieldPassword')}</label>
            <div className="relative">
              <input
                type={showPw ? 'text' : 'password'}
                value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                placeholder={t('admin.users.passwordPlaceholder')}
                className={`${inputCls} pr-10`}
              />
              <button
                type="button"
                onClick={() => setShowPw(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-200"
              >
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('admin.users.fieldEmail')}</label>
            <input
              type="email"
              value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              placeholder="user@example.com"
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('admin.users.fieldRole')}</label>
            <select
              value={form.role}
              onChange={e => setForm(f => ({ ...f, role: e.target.value as 'user' | 'admin' }))}
              className={inputCls}
            >
              <option value="user">{t('admin.users.roleUser')}</option>
              <option value="admin">{t('admin.users.roleAdmin')}</option>
            </select>
          </div>
        </div>
        <div className="flex gap-3 justify-end mt-6">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg">{t('common.cancel')}</button>
          <button
            onClick={handleCreate}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {t('admin.users.create')}
          </button>
        </div>
      </div>
    </div>
  );
}

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

  const handleForceLogout = (user: AdminUser) => {
    setConfirmAction({
      title: t('admin.users.forceLogoutTitle'),
      destructive: false,
      confirmLabel: t('admin.users.forceLogoutTitle'),
      description: (
        <>
          {t('admin.users.forceLogoutBody', { name: user.username })}
        </>
      ),
      run: async (pw) => {
        await adminApi.forceLogout(user.id, pw);
        toast.success(t('admin.users.forceLogoutDone', { name: user.username }));
      },
    });
  };

  const handleDelete = (user: AdminUser) => {
    setConfirmAction({
      title: t('admin.users.deleteUserTitle'),
      destructive: true,
      confirmLabel: t('common.delete'),
      description: (
        <>
          {t('admin.users.deleteUserBody', { name: user.username })}
        </>
      ),
      run: async (pw) => {
        await adminApi.deleteUser(user.id, pw);
        invalidate();
        toast.success(t('admin.users.deleted'));
      },
    });
  };

  const handleToggleStatus = (user: AdminUser) => {
    const newStatus = user.status === 'active' ? 'disabled' : 'active';
    const action = newStatus === 'active' ? t('admin.users.unban') : t('admin.users.ban');
    setConfirmAction({
      title: t('admin.users.banTitle', { action }),
      destructive: newStatus === 'disabled',
      confirmLabel: t('common.confirm') + action,
      description: (
        <>
          {t('admin.users.banBody', { action, name: user.username })}
        </>
      ),
      run: async (pw) => {
        await adminApi.updateUser(user.id, { status: newStatus, confirmPassword: pw });
        invalidate();
        toast.success(newStatus === 'active' ? t('admin.users.unbanDone') : t('admin.users.banDone'));
      },
    });
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">{t('admin.users.title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{t('admin.users.subtitle', { total })}</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          {t('admin.users.createUser')}
        </button>
      </div>

      {/* Search */}
      <div className="relative max-w-xs">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
        <input
          type="text"
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
          placeholder={t('admin.users.searchPlaceholder')}
          className="w-full pl-9 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-gray-100"
        />
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700 dark:bg-gray-900">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('admin.users.colUsername')}</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase hidden md:table-cell">{t('admin.users.colRole')}</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('admin.users.colStatus')}</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase hidden lg:table-cell">{t('admin.users.colStorage')}</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase hidden xl:table-cell">{t('admin.users.colRegistered')}</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('admin.users.colActions')}</th>
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
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <div className="w-7 h-7 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center flex-shrink-0">
                              <span className="text-xs font-bold text-blue-600 dark:text-blue-400">
                                {(user.nickname ?? user.username)[0].toUpperCase()}
                              </span>
                            </div>
                            <div>
                              <p className="font-medium text-gray-800 dark:text-gray-200 dark:text-gray-100">{user.username}</p>
                              {user.nickname && <p className="text-xs text-gray-400 dark:text-gray-500">{user.nickname}</p>}
                            </div>
                          </div>
                        </td>

                        <td className="px-4 py-3 hidden md:table-cell">
                          <span className={`inline-block px-2 py-0.5 text-xs rounded-full font-medium ${
                            user.role === 'admin'
                              ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400'
                              : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
                          }`}>
                            {user.role === 'admin' ? t('admin.users.roleAdmin') : t('admin.users.roleUser')}
                          </span>
                        </td>

                        <td className="px-4 py-3">
                          <button
                            onClick={() => handleToggleStatus(user)}
                            className={`inline-flex items-center px-2 py-0.5 text-xs rounded-full font-medium transition-colors ${
                              user.status === 'active'
                                ? 'bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900/40 dark:text-green-400 dark:hover:bg-green-900/60'
                                : 'bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/40 dark:text-red-400 dark:hover:bg-red-900/60'
                            }`}
                          >
                            {user.status === 'active' ? t('admin.users.statusActive') : t('admin.users.statusDisabled')}
                          </button>
                        </td>

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

                        <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs hidden xl:table-cell">
                          {new Date(user.createdAt).toLocaleDateString('zh-CN')}
                        </td>

                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => setEditUser(user)}
                              className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors"
                              title={t('admin.users.tooltipEdit')}
                            >
                              <Edit className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleForceLogout(user)}
                              className="p-1.5 rounded-lg text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-900/30 transition-colors"
                              title={t('admin.users.tooltipForceLogout')}
                            >
                              <LogOut className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleDelete(user)}
                              className="p-1.5 rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
                              title={t('admin.users.tooltipDelete')}
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

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/30 dark:bg-gray-900">
            <p className="text-xs text-gray-500 dark:text-gray-400">{t('admin.users.pagination', { total, page, totalPages })}</p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="p-1.5 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-40 transition-colors text-gray-600 dark:text-gray-400 dark:text-gray-300"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="p-1.5 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-40 transition-colors text-gray-600 dark:text-gray-400 dark:text-gray-300"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

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
