import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { REFRESH_COOKIE_NAME } from '../common/cookie.constants';
import { createTestApp, setAuthGate } from '../__tests__/test-utils';

const cookies = (res: request.Response): string[] => {
  const raw = res.headers['set-cookie'];
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
};

describe('AuthController', () => {
  let app: INestApplication;
  let auth: Record<string, jest.Mock>;

  beforeEach(async () => {
    setAuthGate(true);
    auth = {
      register: jest.fn(),
      login: jest.fn(),
      refresh: jest.fn(),
      resetPassword: jest.fn(),
      logout: jest.fn(),
      logoutAll: jest.fn(),
    };
    app = await createTestApp(AuthController, [
      { provide: AuthService, useValue: auth },
    ]);
  });

  afterEach(() => app.close());

  // ── POST /auth/register ──────────────────────────────────────────────

  describe('POST /auth/register', () => {
    const validBody = { username: 'neo42', password: 'Test1234!', email: 'neo@test.com', code: '111111' };

    it('returns 400 on missing required fields', async () => {
      const res = await request(app.getHttpServer()).post('/auth/register').send({ username: 'x' });
      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
    });

    it('returns 201 with ok envelope', async () => {
      auth.register.mockResolvedValue({ id: 'u-new', username: 'neo42' });
      const res = await request(app.getHttpServer()).post('/auth/register').send(validBody);
      expect(res.status).toBe(201);
      expect(res.body.ok).toBe(true);
      expect(res.body.timestamp).toBeDefined();
    });

    it('propagates service error through exception filter', async () => {
      auth.register.mockRejectedValue(new (require('@nestjs/common').BadRequestException)('用户名已存在'));
      const res = await request(app.getHttpServer()).post('/auth/register').send(validBody);
      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
      expect(res.body.message).toBe('用户名已存在');
    });
  });

  // ── POST /auth/login ─────────────────────────────────────────────────

  describe('POST /auth/login', () => {
    it('returns 400 on empty body', async () => {
      const res = await request(app.getHttpServer()).post('/auth/login').send({});
      expect(res.status).toBe(400);
    });

    it('sets Set-Cookie, strips refreshToken from body', async () => {
      auth.login.mockResolvedValue({ accessToken: 'at', refreshToken: 'rt', user: { id: 'u-1' } });
      const res = await request(app.getHttpServer())
        .post('/auth/login').send({ identifier: 'neo42', password: 'Test1234!' });
      expect(res.status).toBe(200);
      expect(res.body.data).not.toHaveProperty('refreshToken');
      expect(cookies(res).some(c => c.startsWith(REFRESH_COOKIE_NAME))).toBe(true);
    });

    it('handles login failure (wrong password)', async () => {
      auth.login.mockRejectedValue(new (require('@nestjs/common').UnauthorizedException)('密码错误'));
      const res = await request(app.getHttpServer())
        .post('/auth/login').send({ identifier: 'neo42', password: 'WrongPass1!' });
      expect(res.status).toBe(401);
      expect(res.body.ok).toBe(false);
    });
  });

  // ── POST /auth/refresh ───────────────────────────────────────────────

  describe('POST /auth/refresh', () => {
    it('reads refresh token from cookie', async () => {
      auth.refresh.mockResolvedValue({ accessToken: 'at2' });
      const res = await request(app.getHttpServer())
        .post('/auth/refresh').set('Cookie', `${REFRESH_COOKIE_NAME}=rt-old`);
      expect(res.status).toBe(200);
    });

    it('handles expired refresh token', async () => {
      auth.refresh.mockRejectedValue(new (require('@nestjs/common').UnauthorizedException)('refresh token 已过期'));
      const res = await request(app.getHttpServer())
        .post('/auth/refresh').set('Cookie', `${REFRESH_COOKIE_NAME}=expired`);
      expect(res.status).toBe(401);
      expect(res.body.ok).toBe(false);
    });
  });

  // ── POST /auth/reset-password ────────────────────────────────────────

  describe('POST /auth/reset-password', () => {
    it('returns 400 on short newPassword', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/reset-password').send({ target: 'a@b.com', code: '123456', newPassword: 'short' });
      expect(res.status).toBe(400);
    });

    it('returns 200 on valid reset', async () => {
      auth.resetPassword.mockResolvedValue({ success: true });
      const res = await request(app.getHttpServer())
        .post('/auth/reset-password').send({ target: 'a@b.com', code: '123456', newPassword: 'NewPass1!' });
      expect(res.status).toBe(200);
    });

    it('handles invalid verification code', async () => {
      auth.resetPassword.mockRejectedValue(new (require('@nestjs/common').BadRequestException)('验证码错误'));
      const res = await request(app.getHttpServer())
        .post('/auth/reset-password').send({ target: 'a@b.com', code: '000000', newPassword: 'NewPass1!' });
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('验证码错误');
    });
  });

  // ── Auth gate ────────────────────────────────────────────────────────

  describe('Auth gate (protected endpoints)', () => {
    it('POST /auth/logout → 401 when no token', async () => {
      setAuthGate(false);
      const res = await request(app.getHttpServer()).post('/auth/logout');
      expect(res.status).toBe(401);
      expect(res.body.message).toBe('请先登录');
    });

    it('GET /auth/me → 401 when no token', async () => {
      setAuthGate(false);
      const res = await request(app.getHttpServer()).get('/auth/me');
      expect(res.status).toBe(401);
    });

    it('POST /auth/logout → clears cookie on success', async () => {
      setAuthGate(true);
      auth.logout.mockResolvedValue({ success: true });
      const res = await request(app.getHttpServer()).post('/auth/logout');
      expect(res.status).toBe(200);
      expect(cookies(res).some(c => c.startsWith(`${REFRESH_COOKIE_NAME}=;`))).toBe(true);
    });

    it('POST /auth/logout-all → clears cookie', async () => {
      auth.logoutAll.mockResolvedValue({ success: true });
      const res = await request(app.getHttpServer()).post('/auth/logout-all');
      expect(res.status).toBe(200);
      expect(cookies(res).some(c => c.startsWith(`${REFRESH_COOKIE_NAME}=;`))).toBe(true);
    });
  });

  // ── GET /auth/me ─────────────────────────────────────────────────────

  describe('GET /auth/me', () => {
    it('returns user from guard-injected request', async () => {
      const res = await request(app.getHttpServer()).get('/auth/me');
      expect(res.status).toBe(200);
      expect(res.body.data.username).toBe('tester');
    });
  });
});
