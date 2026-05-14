import { useQuery } from '@tanstack/react-query';
import {
  Users,
  Upload,
  HardDrive,
  Activity,
  Loader2,
  TrendingUp,
  CheckCircle,
} from 'lucide-react';

import { adminApi } from '../../api/client';
import { AuditLog } from '../../types';
import { formatBytes } from '../../utils/crypto';

interface DashboardData {
  totalUsers: number;
  todayUploads: number;
  totalStorageBytes: number;
  tgApiSuccessRate: number;
  recentLogs: AuditLog[];
  topStorageUsers: Array<{
    id: string;
    username: string;
    nickname?: string;
    usedBytes: number;
    quotaBytes: number;
  }>;
}

function StatCard({
  title,
  value,
  subtitle,
  icon,
  color,
  darkColor,
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ReactNode;
  color: string;
  darkColor: string;
}) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">{title}</p>
          <p className="text-3xl font-bold text-gray-900 dark:text-white mt-1.5 dark:text-gray-100">{value}</p>
          {subtitle && <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{subtitle}</p>}
        </div>
        <div className={`w-12 h-12 ${color} ${darkColor} rounded-xl flex items-center justify-center flex-shrink-0`}>
          {icon}
        </div>
      </div>
    </div>
  );
}

function formatDate(d: string) {
  return new Date(d).toLocaleString('zh-CN', {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function actionColor(action: string): string {
  if (action.includes('upload')) return 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400';
  if (action.includes('download')) return 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400';
  if (action.includes('delete')) return 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400';
  if (action.includes('login')) return 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400';
  if (action.includes('share')) return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400';
  return 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400';
}

export default function AdminDashboard() {
  const { data, isLoading, error } = useQuery<DashboardData>({
    queryKey: ['admin', 'dashboard'],
    queryFn: async () => {
      const res = await adminApi.dashboard() as any;
      return res?.dashboard ?? res;
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex items-center justify-center h-64 text-red-500">
        <p>加载失败，请刷新重试</p>
      </div>
    );
  }

  const apiRate = data.tgApiSuccessRate ?? 0;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-white dark:text-gray-100">仪表盘</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">系统运行概览</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          title="总用户数"
          value={data.totalUsers.toLocaleString()}
          icon={<Users className="w-6 h-6 text-blue-600 dark:text-blue-400" />}
          color="bg-blue-100"
          darkColor="dark:bg-blue-900/40"
        />
        <StatCard
          title="今日上传"
          value={data.todayUploads.toLocaleString()}
          subtitle="个文件"
          icon={<Upload className="w-6 h-6 text-green-600 dark:text-green-400" />}
          color="bg-green-100"
          darkColor="dark:bg-green-900/40"
        />
        <StatCard
          title="总存储量"
          value={formatBytes(data.totalStorageBytes)}
          subtitle="全部用户"
          icon={<HardDrive className="w-6 h-6 text-purple-600 dark:text-purple-400" />}
          color="bg-purple-100"
          darkColor="dark:bg-purple-900/40"
        />
        <StatCard
          title="Telegram API 成功率"
          value={`${apiRate.toFixed(1)}%`}
          subtitle="近 24 小时"
          icon={
            apiRate >= 99
              ? <CheckCircle className="w-6 h-6 text-teal-600 dark:text-teal-400" />
              : <Activity className="w-6 h-6 text-orange-600 dark:text-orange-400" />
          }
          color={apiRate >= 99 ? 'bg-teal-100' : 'bg-orange-100'}
          darkColor={apiRate >= 99 ? 'dark:bg-teal-900/40' : 'dark:bg-orange-900/40'}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Recent audit logs */}
        <div className="xl:col-span-2 bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white dark:text-gray-100">最近操作日志</h2>
            <span className="text-xs text-gray-400 dark:text-gray-500">最近 20 条</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700 dark:bg-gray-900">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">操作</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase hidden md:table-cell">用户</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase hidden lg:table-cell">文件</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">时间</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {(data.recentLogs ?? []).slice(0, 20).map(log => (
                  <tr key={log.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-4 py-2.5">
                      <span className={`inline-block px-2 py-0.5 text-xs rounded-full font-medium ${actionColor(log.action)}`}>
                        {log.action}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400 hidden md:table-cell dark:text-gray-300">
                      <span className="text-xs">{(log as any).username ?? '—'}</span>
                    </td>
                    <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400 hidden lg:table-cell dark:text-gray-300">
                      <span className="text-xs truncate max-w-[140px] block">{log.nodeName ?? '—'}</span>
                    </td>
                    <td className="px-4 py-2.5 text-gray-500 dark:text-gray-500 text-xs dark:text-gray-400">{formatDate(log.createdAt)}</td>
                  </tr>
                ))}
                {(!data.recentLogs || data.recentLogs.length === 0) && (
                  <tr>
                    <td colSpan={4} className="text-center py-8 text-gray-400 dark:text-gray-600 text-sm dark:text-gray-500">暂无日志</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Top storage users */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white dark:text-gray-100">存储使用 Top 10</h2>
            <TrendingUp className="w-4 h-4 text-gray-400 dark:text-gray-500" />
          </div>
          <div className="p-4 space-y-3">
            {(data.topStorageUsers ?? []).slice(0, 10).map((u, i) => {
              const pct = u.quotaBytes > 0 ? Math.min(100, (u.usedBytes / u.quotaBytes) * 100) : 0;
              return (
                <div key={u.id} className="flex items-center gap-3">
                  <span className="w-5 text-xs text-gray-400 dark:text-gray-500 font-medium text-right flex-shrink-0">
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="font-medium text-gray-700 dark:text-gray-300 truncate">{u.nickname ?? u.username}</span>
                      <span className="text-gray-400 dark:text-gray-500 ml-2 flex-shrink-0">{formatBytes(u.usedBytes)}</span>
                    </div>
                    <div className="w-full bg-gray-100 dark:bg-gray-700 rounded-full h-1.5">
                      <div
                        className={`h-1.5 rounded-full ${pct > 90 ? 'bg-red-500' : pct > 70 ? 'bg-orange-500' : 'bg-blue-500'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
            {(!data.topStorageUsers || data.topStorageUsers.length === 0) && (
              <p className="text-center text-gray-400 dark:text-gray-600 text-sm py-4 dark:text-gray-500">暂无数据</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
