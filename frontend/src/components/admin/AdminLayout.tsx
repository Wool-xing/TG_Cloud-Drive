import { NavLink, Outlet, Link } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  FolderOpen,
  Settings,
  ArrowLeft,
  Cloud,
  Shield,
} from 'lucide-react';
import { useAuthStore } from '../../stores/auth.store';

const NAV_ITEMS = [
  { to: '/admin', label: '仪表盘', icon: <LayoutDashboard className="w-4 h-4" />, end: true },
  { to: '/admin/users', label: '用户管理', icon: <Users className="w-4 h-4" />, end: false },
  { to: '/admin/files', label: '文件管理', icon: <FolderOpen className="w-4 h-4" />, end: false },
  { to: '/admin/config', label: '系统配置', icon: <Settings className="w-4 h-4" />, end: false },
];

export default function AdminLayout() {
  const user = useAuthStore(s => s.user);

  return (
    <div className="flex h-screen overflow-hidden bg-gray-950">
      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 flex flex-col bg-gray-900 border-r border-gray-800">
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-5 py-5 border-b border-gray-800">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center flex-shrink-0">
            <Shield className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-sm font-bold text-white leading-tight">管理后台</p>
            <p className="text-xs text-gray-400 leading-tight dark:text-gray-500">TG 云盘</p>
          </div>
        </div>

        {/* Back to drive */}
        <div className="px-3 py-3 border-b border-gray-800">
          <Link
            to="/"
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-gray-800 transition-colors dark:text-gray-500"
          >
            <ArrowLeft className="w-4 h-4" />
            返回云盘
          </Link>
        </div>

        {/* Nav */}
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-400 hover:text-white hover:bg-gray-800'
                }`
              }
            >
              {item.icon}
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* User info */}
        <div className="px-4 py-4 border-t border-gray-800">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0">
              <span className="text-xs font-bold text-white">
                {(user?.nickname ?? user?.username ?? 'A')[0].toUpperCase()}
              </span>
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-gray-300 truncate">
                {user?.nickname ?? user?.username}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">管理员</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden bg-gray-50 dark:bg-gray-900">
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
