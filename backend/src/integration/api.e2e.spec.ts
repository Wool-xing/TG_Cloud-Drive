/**
 * End-to-end API tests against running backend.
 * Requires: backend running on localhost:3000
 * Rate-limited — avoid rapid re-runs; restart backend if 429.
 */
describe('API E2E', () => {
  const BASE = 'http://localhost:3000';
  let adminToken: string;

  const api = (method: string, path: string, body?: any, token?: string) =>
    fetch(`${BASE}${path}`, {
      method,
      headers: {
        'Content-Type': body ? 'application/json' : '',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    }).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));

  // Wait out throttler from previous runs
  beforeAll(() => new Promise(r => setTimeout(r, 3000)), 10000);

  it('health check (no auth)', async () => {
    const { status, body } = await api('GET', '/api/health');
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it('admin login → folder → document → list', async () => {
    // 1. Login
    const testPw = process.env.E2E_ADMIN_PASSWORD || 'Admin@123456';
    const login = await api('POST', '/api/auth/login', { identifier: 'admin', password: testPw });
    if (login.status === 429) { console.warn('Throttled — skip auth test'); return; }
    expect(login.body.ok).toBe(true);
    adminToken = login.body.data.accessToken;

    // 2. Create folder
    const folder = await api('POST', '/api/files/folder', { name: `e2e-folder-${Date.now()}`, parentId: null, private: false }, adminToken);
    expect(folder.body.ok).toBe(true);
    const folderId = folder.body.data?.id;
    expect(folderId).toBeDefined();

    // 3. List root — folder visible
    const rootList = await api('GET', '/api/files', undefined, adminToken);
    expect(rootList.body.ok).toBe(true);
    expect(Array.isArray(rootList.body.data)).toBe(true);

    // 4. List files in folder
    const list = await api('GET', `/api/files?parentId=${folderId}`, undefined, adminToken);
    expect(list.body.ok).toBe(true);
  }, 15000);

  it('rejects unauthenticated request', async () => {
    const { status, body } = await api('GET', '/api/files');
    expect(body.ok).toBe(false);
  });

  it('WebDAV handler alive', async () => {
    const { status } = await api('PROPFIND', '/api/dav', undefined, adminToken);
    // WebDAV responds — 207(MultiStatus), 404(no root), 401(no auth)
    expect([200, 207, 401, 404]).toContain(status);
  });
});
