import axios, { AxiosError } from 'axios';
import toast from 'react-hot-toast';
import { t } from '../i18n/translations';

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
  res => {
    const body = res.data?.data !== undefined ? res.data.data : res.data;
    // Dev-mode verification codes: backend returns `code` in body when
    // NODE_ENV=development (verification.service.ts L64-67). Surface as a
    // toast so testers don't need to dig docker logs or psql when SMTP/SMS
    // is not configured. Prod backend never sets body.code → this is a
    // no-op outside development.
    if (
      body &&
      typeof body === 'object' &&
      typeof (body as any).code === 'string' &&
      /^\d{6}$/.test((body as any).code)
    ) {
      toast.success(t('common.devCode', { code: (body as any).code }), { duration: 15_000 });
    }
    return body;
  },
  async (error: AxiosError<any>) => {
    const original = error.config as any;
    // Don't run the refresh dance for unauthenticated auth-entry endpoints.
    // A 401 there means "wrong credentials" / "invalid code", not "token
    // expired". Pre-fix the 401 path swallowed login failures: refresh would
    // 401 too → redirect to /login → user already on /login → no toast, the
    // UI looked like a no-op.
    const url = original.url as string | undefined;
    const isAuthEntry =
      url === '/auth/login' ||
      url === '/auth/register' ||
      url === '/auth/refresh' ||
      url === '/auth/reset-password';
    if (error.response?.status === 401 && !original._retry && !isAuthEntry) {
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
    const msg = error.response?.data?.message || error.message || t('common.requestFailed');
    // P1-I7: admin MFA errors are surfaced by ConfirmPasswordDialog inline
    // (with code-specific text). Don't double up with a global toast.
    const code = error.response?.data?.code as string | undefined;
    const isAdminConfirm = typeof code === 'string' && code.startsWith('ADMIN_CONFIRM_');
    // Pre-fix the toast was also skipped for any 401 to avoid double toasts
    // on the refresh-then-retry path. But the refresh path already returns
    // (api(original) on success, Promise.reject + redirect on fail), so by
    // the time we reach here a 401 is either from an auth-entry endpoint
    // (login / register / reset — user-facing error, MUST toast) or the
    // refresh call itself failed (still worth toasting). Drop the `!== 401`
    // guard so login failures surface.
    if (!isAdminConfirm) toast.error(msg);
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
  createDocument: (data: any) => api.post('/files/document', data),
  updateContent: (nodeId: string, data: any) => api.put(`/files/${nodeId}/content`, data),
  myShares: () => api.get('/shares/my'),
  deleteShare: (shareId: string) => api.delete(`/shares/${shareId}`),
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
  listTags: () => api.get('/files/tags'),
  createTag: (name: string, color?: string) => api.post('/files/tags', { name, color }),
  deleteTag: (tagId: string) => api.delete(`/files/tags/${tagId}`),
  addTag: (nodeId: string, tagId: string) => api.post(`/files/${nodeId}/tags`, { tagId }),
  removeTag: (nodeId: string, tagId: string) => api.delete(`/files/${nodeId}/tags/${tagId}`),
  getPath: (nodeId: string) => api.get(`/files/${nodeId}/path`),
  getFolderDownloadList: (nodeId: string) => api.get(`/files/folder/${nodeId}/download-list`),
  createVersion: (nodeId: string) => api.post(`/files/${nodeId}/versions`),
  getVersions: (nodeId: string) => api.get(`/files/${nodeId}/versions`),
  getVersionDownloadInfo: (nodeId: string, versionId: string) => api.get(`/files/${nodeId}/versions/${versionId}/download`),
  createFileRequest: (nodeId: string, maxFiles: number, ttlHours: number) =>
    api.post(`/files/${nodeId}/file-request`, { maxFiles, ttlHours }),
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
  setNote: (nodeId: string, note: string) => api.put(`/files/${nodeId}/note`, { note }),
  offlineDownload: (url: string, parentId: string, name: string) =>
    api.post('/files/offline-download', { url, parentId, name }),
  listTemplates: () => api.get('/files/templates'),
  createTemplate: (data: { name: string; description: string; category: string; content: string }) =>
    api.post('/files/templates', data),
  deleteTemplate: (templateId: string) => api.delete(`/files/templates/${templateId}`),
  getTemplateContent: (templateId: string) => api.get(`/files/templates/${templateId}/content`),
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
  sendBindEmailCode: (email: string) => api.post('/users/bind-email/send-code', { email }),
  sendBindEmailOldCode: () => api.post('/users/bind-email/send-code-old', {}),
  bindEmail: (data: { email: string; code: string; oldEmailCode?: string }) =>
    api.post('/users/bind-email', data),
  sendBindPhoneCode: (phone: string) => api.post('/users/bind-phone/send-code', { phone }),
  sendBindPhoneOldCode: () => api.post('/users/bind-phone/send-code-old', {}),
  bindPhone: (data: { phone: string; code: string; oldPhoneCode?: string }) =>
    api.post('/users/bind-phone', data),
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
  testSms: (data: { to: string }) => api.post('/admin/test-sms', data),
  testVerifyCode: (data: { channel: 'email' | 'sms'; code: string }) =>
    api.post('/admin/test-verify', data),
};
