import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { createTestApp, setAuthGate } from '../__tests__/test-utils';

describe('UsersController', () => {
  let app: INestApplication;
  let svc: Record<string, jest.Mock>;

  beforeEach(async () => {
    setAuthGate(true);
    svc = {
      getProfile: jest.fn(), updateProfile: jest.fn(),
      changePassword: jest.fn(), sendChangePasswordCode: jest.fn(),
      sendBindEmailCode: jest.fn(), sendBindEmailOldCode: jest.fn(),
      bindEmail: jest.fn(),
      sendBindPhoneCode: jest.fn(), sendBindPhoneOldCode: jest.fn(),
      bindPhone: jest.fn(),
      getDevices: jest.fn(), revokeDevice: jest.fn(),
      setPrivateSpacePassword: jest.fn(), verifyPrivateSpace: jest.fn(),
      getAuditLogs: jest.fn(), getUserStats: jest.fn(),
    };
    app = await createTestApp(UsersController, [{ provide: UsersService, useValue: svc }]);
  });

  afterEach(() => app.close());

  // ── Auth gate ────────────────────────────────────────────────────────

  describe('Auth gate', () => {
    it('returns 401 without token', async () => {
      setAuthGate(false);
      const res = await request(app.getHttpServer()).get('/users/profile');
      expect(res.status).toBe(401);
    });
  });

  // ── Profile ─────────────────────────────────────────────────────────

  describe('GET /users/profile', () => {
    it('returns profile with envelope', async () => {
      svc.getProfile.mockResolvedValue({ id: 'u-1', username: 'tester', usedBytes: 0 });
      const res = await request(app.getHttpServer()).get('/users/profile');
      expect(res.status).toBe(200);
      expect(res.body.data.username).toBe('tester');
    });

    it('returns 404 when user not found', async () => {
      svc.getProfile.mockRejectedValue(new (require('@nestjs/common').NotFoundException)('用户不存在'));
      const res = await request(app.getHttpServer()).get('/users/profile');
      expect(res.status).toBe(404);
    });
  });

  // ── Change password ─────────────────────────────────────────────────

  describe('POST /users/change-password', () => {
    it('returns 400 when newPassword too short', async () => {
      const res = await request(app.getHttpServer())
        .post('/users/change-password').send({ oldPassword: 'old', newPassword: 'short' });
      expect(res.status).toBe(400);
    });

    it('handles wrong old password', async () => {
      svc.changePassword.mockRejectedValue(new (require('@nestjs/common').BadRequestException)('原密码错误'));
      const res = await request(app.getHttpServer())
        .post('/users/change-password').send({ oldPassword: 'WrongOld1!', newPassword: 'NewPass1!' });
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('原密码错误');
    });
  });

  // ── Email bind ──────────────────────────────────────────────────────

  describe('Email bind', () => {
    it('POST /users/bind-email/send-code → 400 invalid email', async () => {
      const res = await request(app.getHttpServer())
        .post('/users/bind-email/send-code').send({ email: 'notanemail' });
      expect(res.status).toBe(400);
    });

    it('POST /users/bind-email → 400 invalid code length', async () => {
      const res = await request(app.getHttpServer())
        .post('/users/bind-email').send({ email: 'a@b.com', code: '12345' });
      expect(res.status).toBe(400);
    });

    it('POST /users/bind-email → handles expired code', async () => {
      svc.bindEmail.mockRejectedValue(new (require('@nestjs/common').BadRequestException)('验证码已过期'));
      const res = await request(app.getHttpServer())
        .post('/users/bind-email').send({ email: 'a@b.com', code: '123456' });
      expect(res.status).toBe(400);
    });
  });

  // ── Phone bind ──────────────────────────────────────────────────────

  describe('Phone bind', () => {
    it('POST /users/bind-phone/send-code → 400 invalid phone', async () => {
      const res = await request(app.getHttpServer())
        .post('/users/bind-phone/send-code').send({ phone: '123' });
      expect(res.status).toBe(400);
    });

    it('POST /users/bind-phone → 400 missing code', async () => {
      const res = await request(app.getHttpServer())
        .post('/users/bind-phone').send({ phone: '13800138000' });
      expect(res.status).toBe(400);
    });
  });

  // ── Private space ───────────────────────────────────────────────────

  describe('Private space', () => {
    it('POST /users/private-space/setup → 400 short password', async () => {
      const res = await request(app.getHttpServer())
        .post('/users/private-space/setup').send({ password: '1234567' });
      expect(res.status).toBe(400);
    });

    it('POST /users/private-space/verify → handles wrong password', async () => {
      svc.verifyPrivateSpace.mockRejectedValue(new (require('@nestjs/common').UnauthorizedException)('密码错误'));
      const res = await request(app.getHttpServer())
        .post('/users/private-space/verify').send({ password: 'WrongPass1!' });
      expect(res.status).toBe(401);
    });
  });

  // ── Devices ─────────────────────────────────────────────────────────

  describe('Devices', () => {
    it('GET /users/devices → lists devices', async () => {
      svc.getDevices.mockResolvedValue([{ id: 'dev-1', browser: 'Chrome' }]);
      const res = await request(app.getHttpServer()).get('/users/devices');
      expect(res.status).toBe(200);
    });

    it('DELETE /users/devices/:id → handles bad UUID', async () => {
      const res = await request(app.getHttpServer()).delete('/users/devices/not-a-uuid');
      expect(res.status).toBe(400);
    });
  });

  // ── Audit + Stats ───────────────────────────────────────────────────

  describe('Audit + Stats', () => {
    it('GET /users/audit-logs → pagination', async () => {
      svc.getAuditLogs.mockResolvedValue({ items: [], total: 0 });
      const res = await request(app.getHttpServer()).get('/users/audit-logs?page=2&limit=10');
      expect(res.status).toBe(200);
    });

    it('GET /users/stats → storage stats', async () => {
      svc.getUserStats.mockResolvedValue({ usedBytes: 1024, quotaBytes: 10737418240 });
      const res = await request(app.getHttpServer()).get('/users/stats');
      expect(res.status).toBe(200);
    });
  });
});
