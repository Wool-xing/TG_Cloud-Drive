import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

describe('UsersController', () => {
  let controller: UsersController;
  let usersService: Record<string, jest.Mock>;

  const req = (overrides: any = {}) =>
    ({
      ip: '127.0.0.1',
      headers: { 'user-agent': 'jest' },
      ...overrides,
    }) as any;

  beforeEach(async () => {
    usersService = {
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

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: usersService }],
    }).compile();

    controller = module.get<UsersController>(UsersController);
    jest.clearAllMocks();
  });

  // ── GET /users/profile ─────────────────────────────────────────────────

  describe('GET /users/profile', () => {
    it('delegates to usersService.getProfile', async () => {
      usersService.getProfile.mockResolvedValue({ id: 'u-1', username: 'neo' });
      const result = await controller.getProfile('u-1');
      expect(usersService.getProfile).toHaveBeenCalledWith('u-1');
      expect(result).toEqual({ id: 'u-1', username: 'neo' });
    });
  });

  // ── PATCH /users/profile ───────────────────────────────────────────────

  describe('PATCH /users/profile', () => {
    it('delegates to usersService.updateProfile', async () => {
      const dto = { nickname: 'Neo' };
      usersService.updateProfile.mockResolvedValue({ success: true });
      const result = await controller.updateProfile('u-1', dto);
      expect(usersService.updateProfile).toHaveBeenCalledWith('u-1', dto);
      expect(result).toEqual({ success: true });
    });
  });

  // ── POST /users/change-password ────────────────────────────────────────

  describe('POST /users/change-password', () => {
    it('delegates to usersService.changePassword with ip and ua', async () => {
      const dto = { oldPassword: 'old', newPassword: 'New1234!', emailCode: '123456' };
      usersService.changePassword.mockResolvedValue({ success: true });
      const result = await controller.changePassword('u-1', dto as any, req());
      expect(usersService.changePassword).toHaveBeenCalledWith(
        'u-1', dto, '127.0.0.1', 'jest',
      );
      expect(result).toEqual({ success: true });
    });
  });

  // ── POST /users/change-password/send-code ──────────────────────────────

  describe('POST /users/change-password/send-code', () => {
    it('delegates to usersService.sendChangePasswordCode', async () => {
      usersService.sendChangePasswordCode.mockResolvedValue({ sent: true });
      const result = await controller.sendChangePasswordCode('u-1');
      expect(usersService.sendChangePasswordCode).toHaveBeenCalledWith('u-1');
      expect(result).toEqual({ sent: true });
    });
  });

  // ── POST /users/bind-email/send-code ───────────────────────────────────

  describe('POST /users/bind-email/send-code', () => {
    it('delegates with userId and email', async () => {
      usersService.sendBindEmailCode.mockResolvedValue({ sent: true });
      const result = await controller.sendBindEmailCode('u-1', { email: 'a@b.com' });
      expect(usersService.sendBindEmailCode).toHaveBeenCalledWith('u-1', 'a@b.com');
      expect(result).toEqual({ sent: true });
    });
  });

  // ── POST /users/bind-email/send-code-old ───────────────────────────────

  describe('POST /users/bind-email/send-code-old', () => {
    it('delegates to usersService.sendBindEmailOldCode', async () => {
      usersService.sendBindEmailOldCode.mockResolvedValue({ sent: true });
      const result = await controller.sendBindEmailOldCode('u-1');
      expect(usersService.sendBindEmailOldCode).toHaveBeenCalledWith('u-1');
      expect(result).toEqual({ sent: true });
    });
  });

  // ── POST /users/bind-email ─────────────────────────────────────────────

  describe('POST /users/bind-email', () => {
    it('delegates with email, code, oldEmailCode, ip, ua', async () => {
      const dto = { email: 'a@b.com', code: '123456' };
      usersService.bindEmail.mockResolvedValue({ success: true });
      const result = await controller.bindEmail('u-1', dto as any, req());
      expect(usersService.bindEmail).toHaveBeenCalledWith(
        'u-1', 'a@b.com', '123456', undefined, '127.0.0.1', 'jest',
      );
      expect(result).toEqual({ success: true });
    });

    it('passes oldEmailCode when changing email', async () => {
      const dto = { email: 'new@b.com', code: '123456', oldEmailCode: '654321' };
      usersService.bindEmail.mockResolvedValue({ success: true });
      await controller.bindEmail('u-1', dto as any, req());
      expect(usersService.bindEmail).toHaveBeenCalledWith(
        'u-1', 'new@b.com', '123456', '654321', '127.0.0.1', 'jest',
      );
    });
  });

  // ── POST /users/bind-phone/send-code ───────────────────────────────────

  describe('POST /users/bind-phone/send-code', () => {
    it('delegates with userId and phone', async () => {
      usersService.sendBindPhoneCode.mockResolvedValue({ sent: true });
      const result = await controller.sendBindPhoneCode('u-1', { phone: '13800138000' });
      expect(usersService.sendBindPhoneCode).toHaveBeenCalledWith('u-1', '13800138000');
      expect(result).toEqual({ sent: true });
    });
  });

  // ── POST /users/bind-phone/send-code-old ───────────────────────────────

  describe('POST /users/bind-phone/send-code-old', () => {
    it('delegates to usersService.sendBindPhoneOldCode', async () => {
      usersService.sendBindPhoneOldCode.mockResolvedValue({ sent: true });
      const result = await controller.sendBindPhoneOldCode('u-1');
      expect(usersService.sendBindPhoneOldCode).toHaveBeenCalledWith('u-1');
      expect(result).toEqual({ sent: true });
    });
  });

  // ── POST /users/bind-phone ─────────────────────────────────────────────

  describe('POST /users/bind-phone', () => {
    it('delegates with phone, code, oldPhoneCode, ip, ua', async () => {
      const dto = { phone: '13800138000', code: '123456' };
      usersService.bindPhone.mockResolvedValue({ success: true });
      const result = await controller.bindPhone('u-1', dto as any, req());
      expect(usersService.bindPhone).toHaveBeenCalledWith(
        'u-1', '13800138000', '123456', undefined, '127.0.0.1', 'jest',
      );
      expect(result).toEqual({ success: true });
    });
  });

  // ── GET /users/devices ─────────────────────────────────────────────────

  describe('GET /users/devices', () => {
    it('delegates to usersService.getDevices', async () => {
      usersService.getDevices.mockResolvedValue([{ id: 'dev-1' }]);
      const result = await controller.getDevices('u-1');
      expect(usersService.getDevices).toHaveBeenCalledWith('u-1');
      expect(result).toEqual([{ id: 'dev-1' }]);
    });
  });

  // ── DELETE /users/devices/:deviceId ────────────────────────────────────

  describe('DELETE /users/devices/:deviceId', () => {
    it('delegates to usersService.revokeDevice with ip and ua', async () => {
      usersService.revokeDevice.mockResolvedValue({ success: true });
      const result = await controller.revokeDevice('u-1', 'dev-1', req());
      expect(usersService.revokeDevice).toHaveBeenCalledWith(
        'u-1', 'dev-1', '127.0.0.1', 'jest',
      );
      expect(result).toEqual({ success: true });
    });
  });

  // ── POST /users/private-space/setup ────────────────────────────────────

  describe('POST /users/private-space/setup', () => {
    it('delegates to usersService.setPrivateSpacePassword', async () => {
      const dto = { password: 'Test1234!' };
      usersService.setPrivateSpacePassword.mockResolvedValue({ success: true });
      const result = await controller.setupPrivateSpace('u-1', dto as any, req());
      expect(usersService.setPrivateSpacePassword).toHaveBeenCalledWith(
        'u-1', dto, '127.0.0.1', 'jest',
      );
      expect(result).toEqual({ success: true });
    });
  });

  // ── POST /users/private-space/verify ───────────────────────────────────

  describe('POST /users/private-space/verify', () => {
    it('delegates to usersService.verifyPrivateSpace', async () => {
      usersService.verifyPrivateSpace.mockResolvedValue({ token: 'ps-token' });
      const result = await controller.verifyPrivateSpace('u-1', { password: 'Test1234!' } as any, req());
      expect(usersService.verifyPrivateSpace).toHaveBeenCalledWith(
        'u-1', 'Test1234!', '127.0.0.1', 'jest',
      );
      expect(result).toEqual({ token: 'ps-token' });
    });
  });

  // ── GET /users/audit-logs ──────────────────────────────────────────────

  describe('GET /users/audit-logs', () => {
    it('delegates with default pagination', async () => {
      usersService.getAuditLogs.mockResolvedValue({ items: [], total: 0 });
      const result = await controller.getAuditLogs('u-1', 1, 20);
      expect(usersService.getAuditLogs).toHaveBeenCalledWith('u-1', 1, 20);
      expect(result).toEqual({ items: [], total: 0 });
    });

    it('passes custom page and limit', async () => {
      usersService.getAuditLogs.mockResolvedValue({ items: [], total: 0 });
      await controller.getAuditLogs('u-1', 3, 50);
      expect(usersService.getAuditLogs).toHaveBeenCalledWith('u-1', 3, 50);
    });
  });

  // ── GET /users/stats ───────────────────────────────────────────────────

  describe('GET /users/stats', () => {
    it('delegates to usersService.getUserStats', async () => {
      usersService.getUserStats.mockResolvedValue({ usedBytes: 0, quotaBytes: 10737418240 });
      const result = await controller.getStats('u-1');
      expect(usersService.getUserStats).toHaveBeenCalledWith('u-1');
      expect(result).toEqual({ usedBytes: 0, quotaBytes: 10737418240 });
    });
  });
});
