/**
 * End-to-end API tests against running backend (local or Docker).
 * Requires backend running on localhost:3000.
 */
describe('API E2E (requires running backend)', () => {
  const BASE = process.env.API_BASE || 'http://localhost:3000';
  const testUser = `e2e${Date.now()}`;
  const testPassword = 'Integration!234';
  let accessToken: string;

  const post = (path: string, body: any) =>
    fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(r => r.json());

  const get = (path: string, token?: string) =>
    fetch(`${BASE}${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }).then(r => r.json());

  it('GET /api/health — ok', async () => {
    const r = await fetch(`${BASE}/api/health`).then(r => r.json());
    expect(r.ok).toBe(true);
    expect(r.data.status).toBe('ok');
  });

  it('register → login → authenticated request', async () => {
    // 1. Send verification code
    const codeRes = await post('/api/verification/send', {
      target: `${testUser}@test.com`, purpose: 'register',
    });
    expect(codeRes.ok).toBe(true);
    const code = codeRes.data.code;

    // 2. Register
    const regRes = await post('/api/auth/register', {
      username: testUser, password: testPassword,
      email: `${testUser}@test.com`, code,
    });
    expect(regRes.ok).toBe(true);

    // 3. Login
    const loginRes = await post('/api/auth/login', {
      identifier: testUser, password: testPassword,
    });
    expect(loginRes.ok).toBe(true);
    expect(loginRes.data.accessToken).toBeDefined();
    accessToken = loginRes.data.accessToken;

    // 4. Authenticated file listing
    const filesRes = await get('/api/files', accessToken);
    expect(filesRes.ok).toBe(true);
    expect(Array.isArray(filesRes.data)).toBe(true);
  }, 30000);

  it('GET /api/admin/dashboard — requires admin role', async () => {
    const r = await get('/api/admin/dashboard', accessToken);
    // Should fail because test user is not admin
    expect(r.ok).toBe(false);
  });

  it('rejects invalid token', async () => {
    const r = await get('/api/files', 'invalid-token');
    expect(r.ok).toBe(false);
  });
});
