import axios, { AxiosError } from 'axios';
import toast from 'react-hot-toast';

const api = axios.create({
  baseURL: '/api',
  timeout: 60_000,
  withCredentials: true,
});

let isRefreshing = false;
let refreshQueue: Array<(token: string) => void> = [];

api.interceptors.request.use(config => {
  const token = localStorage.getItem('accessToken');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  res => res.data?.data !== undefined ? res.data.data : res.data,
  async (error: AxiosError<any>) => {
    const original = error.config as any;
    if (error.response?.status === 401 && !original._retry && original.url !== '/auth/refresh') {
      if (isRefreshing) {
        return new Promise(resolve => {
          refreshQueue.push(token => {
            original.headers.Authorization = `Bearer ${token}`;
            resolve(api(original));
          });
        });
      }
      original._retry = true;
      isRefreshing = true;
      try {
        const refreshToken = localStorage.getItem('refreshToken');
        if (!refreshToken) throw new Error('no refresh token');
        const res = await api.post('/auth/refresh', { refreshToken });
        const newToken = (res as any).accessToken || (res as any).data?.accessToken;
        localStorage.setItem('accessToken', newToken);
        refreshQueue.forEach(cb => cb(newToken));
        refreshQueue = [];
        original.headers.Authorization = `Bearer ${newToken}`;
        return api(original);
      } catch {
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        window.location.href = '/login';
        return Promise.reject(error);
      } finally {
        isRefreshing = false;
      }
    }
    const msg = error.response?.data?.message || error.message || '请求失败';
    // P1-I7: admin MFA errors are surfaced by ConfirmPasswordDialog inline
    // (with code-specific text). Don't double up with a global toast.
    const code = error.response?.data?.code as string | undefined;
    const isAdminConfirm = typeof code === 'string' && code.startsWith('ADMIN_CONFIRM_');
    if (error.response?.status !== 401 && !isAdminConfirm) toast.error(msg);
    return Promise.reject(error);
  },
);

export default api;

// Auth APIs
export const authApi = {
  register: (data: any) => api.post('/auth/register', data),
  login: (data: any) => api.post('/auth/login', data),
  logout: () => api.post('/auth/logout'),
  logoutAll: () => api.post('/auth/logout-all'),
  me: () => api.get('/auth/me'),
  // P1-F2: dedicated reset-password endpoint. Pre-fix the forgot-password
  // form called /auth/login with a `type: 'reset'` field that the backend
  // didn't understand — every reset attempt was a no-op login failure.
  resetPassword: (data: { target: string; code: string; newPassword: string }) =>
    api.post('/auth/reset-password', data),
};

// Verification
export const verificationApi = {
  sendCode: (target: string, purpose: string) => api.post('/verification/send', { target, purpose }),
};

// Files APIs
export const filesApi = {
  list: (params: any) => api.get('/files', { params }),
  createFolder: (data: any) => api.post('/files/folder', data),
  rename: (nodeId: string, name: string) => api.patch(`/files/${nodeId}/rename`, { name }),
  move: (nodeId: string, targetParentId: string) => api.patch(`/files/${nodeId}/move`, { targetParentId }),
  copy: (nodeId: string, targetParentId: string) => api.post(`/files/${nodeId}/copy`, { targetParentId }),
  delete: (nodeIds: string[]) => api.delete('/files', { data: { nodeIds } }),
  trash: () => api.get('/files/trash'),
  restore: (nodeIds: string[]) => api.post('/files/trash/restore', { nodeIds }),
  permanentDelete: (nodeIds: string[]) => api.delete('/files/trash/permanent', { data: { nodeIds } }),
  setLock: (nodeId: string, password: string) => api.patch(`/files/${nodeId}/lock`, { password }),
  verifyLock: (nodeId: string, password: string) => api.post(`/files/${nodeId}/verify-lock`, { password }),
  // P1-B12 (frontend half): DELETE /:nodeId/lock replaces the old empty-password setLock pattern.
  removeLock: (nodeId: string, password: string) => api.delete(`/files/${nodeId}/lock`, { data: { password } }),
  moveToPrivate: (nodeIds: string[], priv: boolean) => api.post('/files/move-private', { nodeIds, private: priv }),
  recent: (limit?: number) => api.get('/files/recent', { params: limit ? { limit } : {} }),
  search: (params: any) => api.get('/files/search', { params }),
  star: (nodeId: string) => api.patch(`/files/${nodeId}/star`),
  starred: () => api.get('/files/starred'),
  getPath: (nodeId: string) => api.get(`/files/${nodeId}/path`),
  // P1-B14: password 走 body (POST) 避免 URL / access log / 浏览器历史泄露
  getDownloadInfo: (nodeId: string, password?: string) =>
    api.post(`/files/download/${nodeId}`, password ? { password } : {}),
  // P1-F9: signal lets the upload store abort an in-flight chunk on pause /
  // cancel — pre-fix the axios request kept burning bytes after the UI
  // showed "paused", and a real cancel just deleted the task while bytes
  // continued uploading server-side.
  uploadChunk: (formData: FormData, onProgress: (p: number) => void, signal?: AbortSignal) =>
    api.post('/files/upload-chunk', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: e => onProgress(e.loaded),
      timeout: 120_000,
      signal,
    }),
};

// Shares APIs
export const sharesApi = {
  create: (data: any) => api.post('/shares', data),
  list: () => api.get('/shares/my'),
  delete: (id: string) => api.delete(`/shares/${id}`),
  access: (token: string, password?: string) => api.get(`/shares/access/${token}`, { params: { password } }),
};

// Users APIs
export const usersApi = {
  profile: () => api.get('/users/profile'),
  updateProfile: (data: any) => api.patch('/users/profile', data),
  changePassword: (data: any) => api.post('/users/change-password', data),
  sendChangePasswordCode: () => api.post('/users/change-password/send-code', {}),
  devices: () => api.get('/users/devices'),
  revokeDevice: (deviceId: string) => api.delete(`/users/devices/${deviceId}`),
  setupPrivateSpace: (data: any) => api.post('/users/private-space/setup', data),
  verifyPrivateSpace: (password: string) => api.post('/users/private-space/verify', { password }),
  auditLogs: (params: any) => api.get('/users/audit-logs', { params }),
  stats: () => api.get('/users/stats'),
};

// Admin APIs
// P1-I7: high-risk endpoints carry the admin's own password in the body so
// the backend can re-verify identity before deleting / force-logging-out /
// changing roles / wiping config — see admin.service.ts#requireConfirm.
export const adminApi = {
  users: (params: any) => api.get('/admin/users', { params }),
  createUser: (data: any) => api.post('/admin/users', data),
  updateUser: (id: string, data: any) => api.patch(`/admin/users/${id}`, data),
  deleteUser: (id: string, confirmPassword: string) =>
    api.delete(`/admin/users/${id}`, { data: { confirmPassword } }),
  forceLogout: (id: string, confirmPassword: string) =>
    api.post(`/admin/users/${id}/force-logout`, { confirmPassword }),
  dashboard: () => api.get('/admin/dashboard'),
  files: (params: any) => api.get('/admin/files', { params }),
  deleteFile: (nodeId: string, confirmPassword: string) =>
    api.delete(`/admin/files/${nodeId}`, { data: { confirmPassword } }),
  auditLogs: (params: any) => api.get('/admin/audit-logs', { params }),
  getConfig: () => api.get('/admin/config'),
  updateConfig: (data: any) => api.patch('/admin/config', data),
  testEmail: (data: any) => api.post('/admin/test-email', data),
};
