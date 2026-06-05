import { Test, TestingModule } from '@nestjs/testing';
import { ValidationPipe, CanActivate, ExecutionContext, INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { REFRESH_COOKIE_NAME } from '../common/cookie.constants';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter';
import { TransformInterceptor } from '../common/interceptors/transform.interceptor';
import { Reflector } from '@nestjs/core';

// ── helpers ──────────────────────────────────────────────────────────────

const cookies = (res: request.Response): string[] => {
  const raw = res.headers['set-cookie'];
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
};

// ── mock guard: toggle auth per test ─────────────────────────────────────

let __authGate = true; // true = pass, false = reject

class MockAuthGuard implements CanActivate {
  canActivate(_ctx: ExecutionContext): boolean {
    if (!__authGate) throw new (require('@nestjs/common').UnauthorizedException)('请先登录');
    // Inject fake user for @CurrentUser decorators
    const req = _ctx.switchToHttp().getRequest();
    req.user = { id: 'u-1', username: 'tester', deviceId: 'dev-1' };
    return true;
  }
}

// ── test harness ─────────────────────────────────────────────────────────

function buildApp(authMock: Record<string, jest.Mock>): Promise<INestApplication> {
  return Test.createTestingModule({
    controllers: [AuthController],
    providers: [
      { provide: AuthService, useValue: authMock },
      { provide: Reflector, useValue: { getAllAndOverride: () => false } },
    ],
  })
    .compile()
    .then(mod => {
      const app = mod.createNestApplication();
      app.use(cookieParser());
      app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
      app.useGlobalFilters(new HttpExceptionFilter());
      app.useGlobalInterceptors(new TransformInterceptor());
      app.useGlobalGuards(new MockAuthGuard());
      return app.init();
    });
}

// ── tests ────────────────────────────────────────────────────────────────

describe('AuthController — integration (supertest)', () => {
  let app: INestApplication;
  let auth: Record<string, jest.Mock>;

  beforeEach(async () => {
    __authGate = true;
    auth = {
      register: jest.fn(),
      login: jest.fn(),
      refresh: jest.fn(),
      resetPassword: jest.fn(),
      logout: jest.fn(),
      logoutAll: jest.fn(),
    };
    app = await buildApp(auth);
  });

  afterEach(() => app.close());

  // ── POST /api/auth/register ──────────────────────────────────────────

  describe('POST /api/auth/register', () => {
    const validBody = { username: 'neo42', password: 'Test1234!', email: 'neo@test.com', code: '111111' };

    it('returns 400 on missing required fields (ValidationPipe)', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ username: 'x' });
      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
      expect(res.body.message).toBeDefined();
    });

    it('returns 200 with ok envelope on success', async () => {
      auth.register.mockResolvedValue({ id: 'u-new', username: 'neo42' });
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send(validBody);
      expect(res.status).toBe(201);
      expect(res.body.ok).toBe(true);
      expect(res.body.data).toEqual({ id: 'u-new', username: 'neo42' });
      expect(res.body.timestamp).toBeDefined();
      expect(auth.register).toHaveBeenCalledWith(validBody);
    });

    it('propagates service errors through exception filter', async () => {
      auth.register.mockRejectedValue(new (require('@nestjs/common').BadRequestException)('用户名已存在'));
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send(validBody);
      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
      expect(res.body.message).toBe('用户名已存在');
    });
  });

  // ── POST /api/auth/login ─────────────────────────────────────────────

  describe('POST /api/auth/login', () => {
    it('returns 400 on empty body', async () => {
      const res = await request(app.getHttpServer()).post('/auth/login').send({});
      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
    });

    it('sets Set-Cookie with refresh token', async () => {
      auth.login.mockResolvedValue({
        accessToken: 'at', refreshToken: 'rt', user: { id: 'u-1', username: 'neo' },
      });
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ identifier: 'neo42', password: 'Test1234!' });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data).not.toHaveProperty('refreshToken');
      expect(res.body.data).toEqual({ accessToken: 'at', user: { id: 'u-1', username: 'neo' } });
      expect(cookies(res).some((c: string) => c.startsWith(REFRESH_COOKIE_NAME))).toBe(true);
    });

    it('rememberMe=true sets longer cookie maxAge', async () => {
      auth.login.mockResolvedValue({
        accessToken: 'at', refreshToken: 'rt', user: { id: 'u-1' },
      });
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ identifier: 'neo42', password: 'Test1234!', rememberMe: true });
      const cookie = cookies(res).find((c: string) => c.startsWith(REFRESH_COOKIE_NAME)) || '';
      expect(cookie).toContain('Max-Age='); // long-lived
    });
  });

  // ── POST /api/auth/refresh ───────────────────────────────────────────

  describe('POST /api/auth/refresh', () => {
    it('reads refresh token from cookie and returns new access token', async () => {
      auth.refresh.mockResolvedValue({ accessToken: 'at2' });
      const res = await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', `${REFRESH_COOKIE_NAME}=rt-old`);
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data).toEqual({ accessToken: 'at2' });
      expect(auth.refresh).toHaveBeenCalledWith('rt-old', expect.any(String), expect.any(String));
    });

    it('passes undefined when cookie missing', async () => {
      auth.refresh.mockResolvedValue({ accessToken: 'at2' });
      await request(app.getHttpServer()).post('/auth/refresh');
      expect(auth.refresh).toHaveBeenCalledWith(undefined, expect.any(String), expect.any(String));
    });
  });

  // ── POST /api/auth/reset-password ────────────────────────────────────

  describe('POST /api/auth/reset-password', () => {
    it('returns 400 on short newPassword (ValidationPipe)', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({ target: 'a@b.com', code: '123456', newPassword: 'short' });
      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
    });

    it('returns 200 on valid reset', async () => {
      auth.resetPassword.mockResolvedValue({ success: true });
      const res = await request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({ target: 'a@b.com', code: '123456', newPassword: 'NewPass1!' });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(auth.resetPassword).toHaveBeenCalledWith(
        expect.objectContaining({ target: 'a@b.com' }),
        expect.any(String), expect.any(String),
      );
    });
  });

  // ── POST /api/auth/logout (auth required) ────────────────────────────

  describe('POST /api/auth/logout', () => {
    it('returns 401 when auth gate rejects', async () => {
      __authGate = false;
      const res = await request(app.getHttpServer()).post('/auth/logout');
      expect(res.status).toBe(401);
      expect(res.body.ok).toBe(false);
      expect(res.body.message).toBe('请先登录');
    });

    it('returns 200 and clears refresh cookie', async () => {
      auth.logout.mockResolvedValue({ success: true });
      const res = await request(app.getHttpServer()).post('/auth/logout');
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(cookies(res).length).toBeGreaterThan(0);
      expect(cookies(res).some((c: string) => c.startsWith(`${REFRESH_COOKIE_NAME}=;`))).toBe(true);
      expect(auth.logout).toHaveBeenCalledWith('dev-1');
    });
  });

  // ── POST /api/auth/logout-all ────────────────────────────────────────

  describe('POST /api/auth/logout-all', () => {
    it('returns 401 when auth gate rejects', async () => {
      __authGate = false;
      const res = await request(app.getHttpServer()).post('/auth/logout-all');
      expect(res.status).toBe(401);
    });

    it('clears cookie and delegates to service', async () => {
      auth.logoutAll.mockResolvedValue({ success: true });
      const res = await request(app.getHttpServer()).post('/auth/logout-all');
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(auth.logoutAll).toHaveBeenCalledWith('u-1');
      expect(cookies(res).some((c: string) => c.startsWith(`${REFRESH_COOKIE_NAME}=;`))).toBe(true);
    });
  });

  // ── GET /api/auth/me ─────────────────────────────────────────────────

  describe('GET /api/auth/me', () => {
    it('returns 401 when no auth', async () => {
      __authGate = false;
      const res = await request(app.getHttpServer()).get('/auth/me');
      expect(res.status).toBe(401);
      expect(res.body.ok).toBe(false);
    });

    it('returns current user with ok envelope', async () => {
      const res = await request(app.getHttpServer()).get('/auth/me');
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data).toEqual({ id: 'u-1', username: 'tester', deviceId: 'dev-1' });
    });
  });
});
