import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useI18n } from '../../i18n/context';
import {
  Cloud,
  Home,
  Clock,
  Star,
  Share2,
  Trash2,
  Lock,
  ShieldCheck,
  LogOut,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../../stores/auth.store';
import { authApi } from '../../api/client';
import { formatBytes } from '../../utils/crypto';

interface NavItem {
  to: string;
  icon: React.ReactNode;
  labelKey: string;
}

export default function Sidebar() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, logout, isAdmin } = useAuthStore();
  const { t } = useI18n();

  const mainNavItems: NavItem[] = [
    { to: '/', icon: <Home className="h-4.5 w-4.5" />, labelKey: 'nav.files' },
    { to: '/recent', icon: <Clock className="h-4.5 w-4.5" />, labelKey: 'nav.recent' },
    { to: '/starred', icon: <Star className="h-4.5 w-4.5" />, labelKey: 'nav.starred' },
    { to: '/shares', icon: <Share2 className="h-4.5 w-4.5" />, labelKey: 'nav.shares' },
    { to: '/trash', icon: <Trash2 className="h-4.5 w-4.5" />, labelKey: 'nav.trash' },
    { to: '/private', icon: <Lock className="h-4.5 w-4.5" />, labelKey: 'nav.private' },
  ];

  const handleLogout = async () => {
    try {
      await authApi.logout();
    } catch { /* ignore */ }
    // Clear all cached queries so the next user doesn't see stale data
    queryClient.clear();
    logout();
    toast.success(t('auth.logout'));
    navigate('/login', { replace: true });
  };

  const usedBytes = user?.usedBytes ?? 0;
  const quotaBytes = user?.quotaBytes ?? 1;
  const usedPct = Math.min(100, Math.round((usedBytes / quotaBytes) * 100));
  const quotaBarColor =
    usedPct >= 90 ? 'bg-red-500' : usedPct >= 70 ? 'bg-yellow-400' : 'bg-blue-500';

  const navLinkCls = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
      isActive
        ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-400'
        : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-100'
    }`;

  return (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-4 py-4 border-b border-gray-100 dark:border-gray-800 dark:border-gray-700">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 shadow-sm">
          <Cloud className="h-4 w-4 text-white" />
        </div>
        <span className="text-base font-bold text-gray-900 dark:text-white tracking-tight dark:text-gray-100">{t('app.name')}</span>
      </div>

      {/* Main nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-0.5">
        {mainNavItems.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={navLinkCls}
          >
            <span className="shrink-0">{item.icon}</span>
            <span>{t(item.labelKey)}</span>
          </NavLink>
        ))}

        {/* Admin section */}
        {isAdmin() && (
          <>
            <div className="my-2 border-t border-gray-100 dark:border-gray-800 dark:border-gray-700" />
            <NavLink to="/admin" className={navLinkCls}>
              <ShieldCheck className="h-4.5 w-4.5 shrink-0" />
              <span>{t('sidebar.admin')}</span>
            </NavLink>
          </>
        )}
      </nav>

      {/* Storage quota */}
      <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-800 dark:border-gray-700">
        <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 mb-1.5">
          <span>{t('sidebar.storage')}</span>
          <span>{formatBytes(usedBytes)} / {formatBytes(quotaBytes)}</span>
        </div>
        <div className="h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${quotaBarColor}`}
            style={{ width: `${usedPct}%` }}
          />
        </div>
        <p className="mt-1 text-xs text-gray-400 dark:text-gray-600 text-right dark:text-gray-500">{t('sidebar.used', { pct: usedPct })}</p>
      </div>

      {/* User info + logout. Clicking avatar/name navigates to /profile (where
          password change, devices, audit logs, storage stats live). */}
      <div className="flex items-center gap-3 px-4 py-3 border-t border-gray-100 dark:border-gray-800 dark:border-gray-700">
        <button
          type="button"
          onClick={() => navigate('/profile')}
          title={t('nav.profileTitle')}
          className="flex-1 min-w-0 flex items-center gap-3 -mx-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/60 transition text-left dark:hover:bg-gray-700/50"
        >
          {/* Avatar */}
          <div className="shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center text-white text-sm font-bold overflow-hidden">
            {user?.avatar && /^https?:\/\//.test(user.avatar)
              ? <img src={user.avatar} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" crossOrigin="anonymous" />
              : (user?.nickname || user?.username || '?')[0].toUpperCase()
            }
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 dark:text-white truncate dark:text-gray-100">
              {user?.nickname || user?.username}
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500 truncate">
              {user?.role === 'admin' ? t('sidebar.adminRole') : t('sidebar.userRole')}
            </p>
          </div>
        </button>
        <button
          onClick={handleLogout}
          title={t('sidebar.logout')}
          className="shrink-0 p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition dark:text-gray-500"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
