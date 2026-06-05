import { Test } from '@nestjs/testing';
import { ValidationPipe, CanActivate, ExecutionContext, INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter';
import { TransformInterceptor } from '../common/interceptors/transform.interceptor';

let __authGate = true;

class MockAuthGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    if (!__authGate) throw new (require('@nestjs/common').UnauthorizedException)('请先登录');
    const req = ctx.switchToHttp().getRequest();
    req.user = { id: 'admin-1', username: 'admin', deviceId: 'dev-1' };
    return true;
  }
}

function buildApp(svcMock: Record<string, jest.Mock>): Promise<INestApplication> {
  return Test.createTestingModule({
    controllers: [AdminController],
    providers: [{ provide: AdminService, useValue: svcMock }],
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

describe('AdminController — integration (supertest)', () => {
  let app: INestApplication;
  let svc: Record<string, jest.Mock>;

  beforeEach(async () => {
    __authGate = true;
    svc = {
      getDashboard: jest.fn(),
      listUsers: jest.fn(),
      createUser: jest.fn(),
      updateUser: jest.fn(),
      deleteUser: jest.fn(),
      forceLogout: jest.fn(),
      listAllFiles: jest.fn(),
      deleteFileAdmin: jest.fn(),
      getAuditLogs: jest.fn(),
      getSystemConfig: jest.fn(),
      updateSystemConfig: jest.fn(),
      testEmail: jest.fn(),
      testSms: jest.fn(),
      testVerifyCode: jest.fn(),
    };
    app = await buildApp(svc);
  });

  afterEach(() => app.close());

  // ── GET /admin/dashboard ─────────────────────────────────────────────

  describe('GET /admin/dashboard', () => {
    it('returns 401 without auth', async () => {
      __authGate = false;
      const res = await request(app.getHttpServer()).get('/admin/dashboard');
      expect(res.status).toBe(401);
    });

    it('returns dashboard stats', async () => {
      svc.getDashboard.mockResolvedValue({ users: 100, files: 500, usedBytes: 1073741824 });
      const res = await request(app.getHttpServer()).get('/admin/dashboard');
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ users: 100, files: 500, usedBytes: 1073741824 });
    });
  });

  // ── GET /admin/users ─────────────────────────────────────────────────

  describe('GET /admin/users', () => {
    it('lists users with default pagination', async () => {
      svc.listUsers.mockResolvedValue({ items: [], total: 0 });
      const res = await request(app.getHttpServer()).get('/admin/users');
      expect(res.status).toBe(200);
      expect(svc.listUsers).toHaveBeenCalledWith(1, 20, undefined);
    });

    it('passes page, limit, search params', async () => {
      svc.listUsers.mockResolvedValue({ items: [], total: 0 });
      const res = await request(app.getHttpServer()).get('/admin/users?page=3&limit=10&search=neo');
      expect(res.status).toBe(200);
      expect(svc.listUsers).toHaveBeenCalledWith(3, 10, 'neo');
    });
  });

  // ── POST /admin/users ────────────────────────────────────────────────

  describe('POST /admin/users', () => {
    it('creates user (admin auth)', async () => {
      svc.createUser.mockResolvedValue({ id: 'u-new' });
      const res = await request(app.getHttpServer())
        .post('/admin/users')
        .send({ username: 'newuser', password: 'Test1234!', role: 'user' });
      expect(res.status).toBe(201);
      expect(res.body.data).toEqual({ id: 'u-new' });
    });
  });

  // ── PATCH /admin/users/:id ───────────────────────────────────────────

  describe('PATCH /admin/users/:id', () => {
    it('updates user with admin creds', async () => {
      svc.updateUser.mockResolvedValue({ success: true });
      const res = await request(app.getHttpServer())
        .patch('/admin/users/00000000-0000-0000-0000-000000000001')
        .send({ role: 'admin', status: 'active' });
      expect(res.status).toBe(200);
      expect(svc.updateUser).toHaveBeenCalledWith(
        'admin-1', '00000000-0000-0000-0000-000000000001',
        expect.any(Object), '::ffff:127.0.0.1', undefined,
      );
    });
  });

  // ── DELETE /admin/users/:id ──────────────────────────────────────────

  describe('DELETE /admin/users/:id', () => {
    it('deletes user with confirmPassword', async () => {
      svc.deleteUser.mockResolvedValue({ success: true });
      const res = await request(app.getHttpServer())
        .delete('/admin/users/00000000-0000-0000-0000-000000000001')
        .send({ confirmPassword: 'AdminPass1!' });
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ success: true });
    });
  });

  // ── POST /admin/users/:id/force-logout ───────────────────────────────

  describe('POST /admin/users/:id/force-logout', () => {
    it('force logs out user', async () => {
      svc.forceLogout.mockResolvedValue({ success: true });
      const res = await request(app.getHttpServer())
        .post('/admin/users/00000000-0000-0000-0000-000000000001/force-logout')
        .send({ confirmPassword: 'AdminPass1!' });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });
  });

  // ── GET /admin/files ────────────────────────────────────────────────

  describe('GET /admin/files', () => {
    it('lists all files with filters', async () => {
      svc.listAllFiles.mockResolvedValue({ items: [], total: 0 });
      const res = await request(app.getHttpServer()).get(
        '/admin/files?page=1&limit=50&userId=u-1&type=image&sort=createdAt&order=ASC',
      );
      expect(res.status).toBe(200);
      expect(svc.listAllFiles).toHaveBeenCalledWith(1, 50, 'u-1', undefined, 'image', 'createdAt', 'ASC');
    });
  });

  // ── DELETE /admin/files/:nodeId ─────────────────────────────────────

  describe('DELETE /admin/files/:nodeId', () => {
    it('deletes any file with confirmPassword', async () => {
      svc.deleteFileAdmin.mockResolvedValue({ success: true });
      const res = await request(app.getHttpServer())
        .delete('/admin/files/00000000-0000-0000-0000-000000000001')
        .send({ confirmPassword: 'AdminPass1!' });
      expect(res.status).toBe(200);
    });
  });

  // ── GET /admin/audit-logs ────────────────────────────────────────────

  describe('GET /admin/audit-logs', () => {
    it('fetches audit logs with filters', async () => {
      svc.getAuditLogs.mockResolvedValue({ items: [], total: 0 });
      const res = await request(app.getHttpServer()).get(
        '/admin/audit-logs?page=1&limit=20&userId=u-1&action=LOGIN',
      );
      expect(res.status).toBe(200);
      expect(svc.getAuditLogs).toHaveBeenCalledWith(1, 20, 'u-1', 'LOGIN');
    });
  });

  // ── Config ───────────────────────────────────────────────────────────

  describe('GET /admin/config', () => {
    it('returns system config', async () => {
      svc.getSystemConfig.mockResolvedValue({ appName: 'TG云盘', maxUploadSize: 104857600 });
      const res = await request(app.getHttpServer()).get('/admin/config');
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ appName: 'TG云盘', maxUploadSize: 104857600 });
    });
  });

  describe('PATCH /admin/config', () => {
    it('updates config with confirmPassword', async () => {
      svc.updateSystemConfig.mockResolvedValue({ success: true });
      const res = await request(app.getHttpServer())
        .patch('/admin/config')
        .send({ appName: 'New Name', confirmPassword: 'AdminPass1!' });
      expect(res.status).toBe(200);
      expect(svc.updateSystemConfig).toHaveBeenCalledWith(
        'admin-1', { appName: 'New Name', confirmPassword: 'AdminPass1!' },
        '::ffff:127.0.0.1', undefined,
      );
    });
  });

  // ── Test email / SMS / verify ────────────────────────────────────────

  describe('POST /admin/test-email', () => {
    it('sends test email', async () => {
      svc.testEmail.mockResolvedValue({ sent: true });
      const res = await request(app.getHttpServer())
        .post('/admin/test-email')
        .send({ to: 'admin@test.com' });
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ sent: true });
    });
  });

  describe('POST /admin/test-sms', () => {
    it('sends test SMS with dev code', async () => {
      svc.testSms.mockResolvedValue({ sent: true, devCode: '123456' });
      const res = await request(app.getHttpServer())
        .post('/admin/test-sms')
        .send({ to: '13800138000' });
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ sent: true, devCode: '123456' });
    });
  });

  describe('POST /admin/test-verify', () => {
    it('verifies test code', async () => {
      svc.testVerifyCode.mockResolvedValue({ valid: true });
      const res = await request(app.getHttpServer())
        .post('/admin/test-verify')
        .send({ channel: 'email', code: '123456' });
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ valid: true });
    });

    it('handles SMS channel', async () => {
      svc.testVerifyCode.mockResolvedValue({ valid: true });
      const res = await request(app.getHttpServer())
        .post('/admin/test-verify')
        .send({ channel: 'sms', code: '654321' });
      expect(res.status).toBe(200);
    });
  });
});
