import { Test } from '@nestjs/testing';
import { ValidationPipe, CanActivate, ExecutionContext, INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter';
import { TransformInterceptor } from '../common/interceptors/transform.interceptor';

// ── mock guard: toggle auth per test ─────────────────────────────────────

let __authGate = true;

class MockAuthGuard implements CanActivate {
  canActivate(_ctx: ExecutionContext): boolean {
    if (!__authGate) throw new (require('@nestjs/common').UnauthorizedException)('请先登录');
    const req = _ctx.switchToHttp().getRequest();
    req.user = { id: 'u-1', username: 'tester', deviceId: 'dev-1' };
    return true;
  }
}

function buildApp(usersMock: Record<string, jest.Mock>): Promise<INestApplication> {
  return Test.createTestingModule({
    controllers: [UsersController],
    providers: [{ provide: UsersService, useValue: usersMock }],
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

describe('UsersController — integration (supertest)', () => {
  let app: INestApplication;
  let svc: Record<string, jest.Mock>;

  beforeEach(async () => {
    __authGate = true;
    svc = {
      getProfile: jest.fn(),
      updateProfile: jest.fn(),
      changePassword: jest.fn(),
      sendChangePasswordCode: jest.fn(),
      sendBindEmailCode: jest.fn(),
      sendBindEmailOldCode: jest.fn(),
      bindEmail: jest.fn(),
      sendBindPhoneCode: jest.fn(),
      sendBindPhoneOldCode: jest.fn(),
      bindPhone: jest.fn(),
      getDevices: jest.fn(),
      revokeDevice: jest.fn(),
      setPrivateSpacePassword: jest.fn(),
      verifyPrivateSpace: jest.fn(),
      getAuditLogs: jest.fn(),
      getUserStats: jest.fn(),
    };
    app = await buildApp(svc);
  });

  afterEach(() => app.close());

  // ── GET /users/profile ────────────────────────────────────────────────

  describe('GET /users/profile', () => {
    it('returns 401 without auth', async () => {
      __authGate = false;
      const res = await request(app.getHttpServer()).get('/users/profile');
      expect(res.status).toBe(401);
    });

    it('returns profile with ok envelope', async () => {
      svc.getProfile.mockResolvedValue({ id: 'u-1', username: 'tester', usedBytes: 0 });
      const res = await request(app.getHttpServer()).get('/users/profile');
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data).toEqual({ id: 'u-1', username: 'tester', usedBytes: 0 });
    });
  });

  // ── PATCH /users/profile ──────────────────────────────────────────────

  describe('PATCH /users/profile', () => {
    it('returns 400 on overlong nickname', async () => {
      const res = await request(app.getHttpServer())
        .patch('/users/profile')
        .send({ nickname: 'x'.repeat(256) });
      expect(res.status).toBe(400);
    });

    it('updates profile with valid payload', async () => {
      svc.updateProfile.mockResolvedValue({ success: true });
      const res = await request(app.getHttpServer())
        .patch('/users/profile')
        .send({ nickname: 'Neo', avatar: 'https://img.url/avatar.png' });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(svc.updateProfile).toHaveBeenCalledWith('u-1', { nickname: 'Neo', avatar: 'https://img.url/avatar.png' });
    });
  });

  // ── POST /users/change-password ───────────────────────────────────────

  describe('POST /users/change-password', () => {
    it('returns 400 when newPassword too short', async () => {
      const res = await request(app.getHttpServer())
        .post('/users/change-password')
        .send({ oldPassword: 'old', newPassword: 'short' });
      expect(res.status).toBe(400);
    });

    it('returns 400 when newPassword missing special char', async () => {
      const res = await request(app.getHttpServer())
        .post('/users/change-password')
        .send({ oldPassword: 'old', newPassword: 'NoSpecial1' });
      expect(res.status).toBe(400);
    });

    it('changes password with valid DTO', async () => {
      svc.changePassword.mockResolvedValue({ success: true });
      const res = await request(app.getHttpServer())
        .post('/users/change-password')
        .send({ oldPassword: 'OldPass1!', newPassword: 'NewPass1!' });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(svc.changePassword).toHaveBeenCalledWith('u-1', expect.any(Object), '::ffff:127.0.0.1', undefined);
    });
  });

  // ── Email bind ────────────────────────────────────────────────────────

  describe('POST /users/bind-email/send-code', () => {
    it('returns 400 on invalid email', async () => {
      const res = await request(app.getHttpServer())
        .post('/users/bind-email/send-code')
        .send({ email: 'notanemail' });
      expect(res.status).toBe(400);
    });

    it('sends code to valid email', async () => {
      svc.sendBindEmailCode.mockResolvedValue({ sent: true });
      const res = await request(app.getHttpServer())
        .post('/users/bind-email/send-code')
        .send({ email: 'a@b.com' });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(svc.sendBindEmailCode).toHaveBeenCalledWith('u-1', 'a@b.com');
    });
  });

  describe('POST /users/bind-email', () => {
    it('returns 400 on invalid email', async () => {
      const res = await request(app.getHttpServer())
        .post('/users/bind-email')
        .send({ email: 'bad', code: '123456' });
      expect(res.status).toBe(400);
    });

    it('returns 400 when code too short', async () => {
      const res = await request(app.getHttpServer())
        .post('/users/bind-email')
        .send({ email: 'a@b.com', code: '12345' });
      expect(res.status).toBe(400);
    });

    it('binds email with valid DTO', async () => {
      svc.bindEmail.mockResolvedValue({ success: true });
      const res = await request(app.getHttpServer())
        .post('/users/bind-email')
        .send({ email: 'a@b.com', code: '123456' });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });
  });

  describe('POST /users/bind-email/send-code-old', () => {
    it('sends code to old email', async () => {
      svc.sendBindEmailOldCode.mockResolvedValue({ sent: true });
      const res = await request(app.getHttpServer())
        .post('/users/bind-email/send-code-old');
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });
  });

  // ── Phone bind ────────────────────────────────────────────────────────

  describe('POST /users/bind-phone/send-code', () => {
    it('returns 400 on invalid phone', async () => {
      const res = await request(app.getHttpServer())
        .post('/users/bind-phone/send-code')
        .send({ phone: '123' });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /users/bind-phone', () => {
    it('returns 400 when code missing', async () => {
      const res = await request(app.getHttpServer())
        .post('/users/bind-phone')
        .send({ phone: '13800138000' });
      expect(res.status).toBe(400);
    });

    it('binds phone with valid DTO', async () => {
      svc.bindPhone.mockResolvedValue({ success: true });
      const res = await request(app.getHttpServer())
        .post('/users/bind-phone')
        .send({ phone: '13800138000', code: '123456' });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });
  });

  // ── Devices ───────────────────────────────────────────────────────────

  describe('GET /users/devices', () => {
    it('lists devices', async () => {
      svc.getDevices.mockResolvedValue([{ id: 'dev-1', browser: 'Chrome' }]);
      const res = await request(app.getHttpServer()).get('/users/devices');
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([{ id: 'dev-1', browser: 'Chrome' }]);
    });
  });

  describe('DELETE /users/devices/:deviceId', () => {
    it('revokes device', async () => {
      svc.revokeDevice.mockResolvedValue({ success: true });
      const res = await request(app.getHttpServer()).delete('/users/devices/00000000-0000-0000-0000-000000000001');
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });
  });

  // ── Private space ─────────────────────────────────────────────────────

  describe('POST /users/private-space/setup', () => {
    it('returns 400 on short password', async () => {
      const res = await request(app.getHttpServer())
        .post('/users/private-space/setup')
        .send({ password: '1234567' });
      expect(res.status).toBe(400);
    });

    it('sets private space password', async () => {
      svc.setPrivateSpacePassword.mockResolvedValue({ success: true });
      const res = await request(app.getHttpServer())
        .post('/users/private-space/setup')
        .send({ password: 'Test1234!' });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it('passes currentPassword for change', async () => {
      svc.setPrivateSpacePassword.mockResolvedValue({ success: true });
      const res = await request(app.getHttpServer())
        .post('/users/private-space/setup')
        .send({ password: 'NewPass1!', currentPassword: 'OldPass1!' });
      expect(res.status).toBe(200);
      expect(svc.setPrivateSpacePassword).toHaveBeenCalledWith(
        'u-1', { password: 'NewPass1!', currentPassword: 'OldPass1!' },
        '::ffff:127.0.0.1', undefined,
      );
    });
  });

  describe('POST /users/private-space/verify', () => {
    it('returns 400 on empty password', async () => {
      const res = await request(app.getHttpServer())
        .post('/users/private-space/verify')
        .send({ password: '' });
      expect(res.status).toBe(400);
    });

    it('verifies private space password', async () => {
      svc.verifyPrivateSpace.mockResolvedValue({ token: 'ps-token' });
      const res = await request(app.getHttpServer())
        .post('/users/private-space/verify')
        .send({ password: 'Test1234!' });
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ token: 'ps-token' });
    });
  });

  // ── Audit logs ────────────────────────────────────────────────────────

  describe('GET /users/audit-logs', () => {
    it('returns paginated audit logs', async () => {
      svc.getAuditLogs.mockResolvedValue({ items: [{ id: 'log-1' }], total: 1 });
      const res = await request(app.getHttpServer()).get('/users/audit-logs?page=2&limit=10');
      expect(res.status).toBe(200);
      expect(svc.getAuditLogs).toHaveBeenCalledWith('u-1', 2, 10);
    });
  });

  // ── Stats ─────────────────────────────────────────────────────────────

  describe('GET /users/stats', () => {
    it('returns storage stats', async () => {
      svc.getUserStats.mockResolvedValue({ usedBytes: 1024, quotaBytes: 10737418240 });
      const res = await request(app.getHttpServer()).get('/users/stats');
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ usedBytes: 1024, quotaBytes: 10737418240 });
    });
  });
});
