import { Test, TestingModule } from '@nestjs/testing';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

describe('AdminController', () => {
  let controller: AdminController;
  let adminService: Record<string, jest.Mock>;

  const req = (overrides: any = {}) =>
    ({
      ip: '127.0.0.1',
      headers: { 'user-agent': 'jest' },
      ...overrides,
    }) as any;

  beforeEach(async () => {
    adminService = {
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

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [{ provide: AdminService, useValue: adminService }],
    }).compile();

    controller = module.get<AdminController>(AdminController);
    jest.clearAllMocks();
  });

  describe('GET /admin/dashboard', () => {
    it('delegates to adminService.getDashboard', async () => {
      adminService.getDashboard.mockResolvedValue({ users: 100, files: 500 });
      const result = await controller.getDashboard();
      expect(adminService.getDashboard).toHaveBeenCalled();
      expect(result).toEqual({ users: 100, files: 500 });
    });
  });

  describe('GET /admin/users', () => {
    it('delegates with default pagination', async () => {
      adminService.listUsers.mockResolvedValue({ items: [], total: 0 });
      const result = await controller.listUsers(1, 20, undefined);
      expect(adminService.listUsers).toHaveBeenCalledWith(1, 20, undefined);
      expect(result).toEqual({ items: [], total: 0 });
    });

    it('passes search term', async () => {
      adminService.listUsers.mockResolvedValue({ items: [], total: 0 });
      await controller.listUsers(2, 50, 'neo');
      expect(adminService.listUsers).toHaveBeenCalledWith(2, 50, 'neo');
    });
  });

  describe('POST /admin/users', () => {
    it('delegates with adminId, dto, ip, ua', async () => {
      const dto = { username: 'new', password: 'Test1234!', role: 'user' };
      adminService.createUser.mockResolvedValue({ id: 'u-new' });
      const result = await controller.createUser('admin-1', dto as any, req());
      expect(adminService.createUser).toHaveBeenCalledWith('admin-1', dto, '127.0.0.1', 'jest');
      expect(result).toEqual({ id: 'u-new' });
    });
  });

  describe('PATCH /admin/users/:id', () => {
    it('delegates with adminId, userId, dto, ip, ua', async () => {
      const dto = { role: 'admin', confirmPassword: 'pwd' };
      adminService.updateUser.mockResolvedValue({ success: true });
      const result = await controller.updateUser('admin-1', 'u-1', dto as any, req());
      expect(adminService.updateUser).toHaveBeenCalledWith('admin-1', 'u-1', dto, '127.0.0.1', 'jest');
      expect(result).toEqual({ success: true });
    });
  });

  describe('DELETE /admin/users/:id', () => {
    it('delegates with adminId, userId, confirmPassword, ip, ua', async () => {
      adminService.deleteUser.mockResolvedValue({ success: true });
      const result = await controller.deleteUser('admin-1', 'u-1', 'pwd', req());
      expect(adminService.deleteUser).toHaveBeenCalledWith('admin-1', 'u-1', 'pwd', '127.0.0.1', 'jest');
      expect(result).toEqual({ success: true });
    });
  });

  describe('POST /admin/users/:id/force-logout', () => {
    it('delegates forceLogout with adminId, userId, confirmPassword, ip, ua', async () => {
      adminService.forceLogout.mockResolvedValue({ success: true });
      const result = await controller.forceLogout('admin-1', 'u-1', 'pwd', req());
      expect(adminService.forceLogout).toHaveBeenCalledWith('admin-1', 'u-1', 'pwd', '127.0.0.1', 'jest');
      expect(result).toEqual({ success: true });
    });
  });

  describe('GET /admin/files', () => {
    it('delegates listAllFiles with all query params', async () => {
      adminService.listAllFiles.mockResolvedValue({ items: [], total: 0 });
      await controller.listFiles(1, 20, 'u-1', 'photo', 'image', 'createdAt', 'DESC');
      expect(adminService.listAllFiles).toHaveBeenCalledWith(1, 20, 'u-1', 'photo', 'image', 'createdAt', 'DESC');
    });

    it('handles undefined optional params', async () => {
      adminService.listAllFiles.mockResolvedValue({ items: [], total: 0 });
      await controller.listFiles(1, 20);
      expect(adminService.listAllFiles).toHaveBeenCalledWith(1, 20, undefined, undefined, undefined, undefined, undefined);
    });
  });

  describe('DELETE /admin/files/:nodeId', () => {
    it('delegates deleteFileAdmin with adminId, nodeId, confirmPassword, ip, ua', async () => {
      adminService.deleteFileAdmin.mockResolvedValue({ success: true });
      const result = await controller.deleteFile('admin-1', 'n-1', 'pwd', req());
      expect(adminService.deleteFileAdmin).toHaveBeenCalledWith('admin-1', 'n-1', 'pwd', '127.0.0.1', 'jest');
      expect(result).toEqual({ success: true });
    });
  });

  describe('GET /admin/audit-logs', () => {
    it('delegates with pagination and filters', async () => {
      adminService.getAuditLogs.mockResolvedValue({ items: [], total: 0 });
      await controller.getAuditLogs(1, 20, 'u-1', 'LOGIN');
      expect(adminService.getAuditLogs).toHaveBeenCalledWith(1, 20, 'u-1', 'LOGIN');
    });
  });

  describe('GET /admin/config', () => {
    it('delegates to adminService.getSystemConfig', async () => {
      adminService.getSystemConfig.mockResolvedValue({ appName: 'TG云盘' });
      const result = await controller.getConfig();
      expect(adminService.getSystemConfig).toHaveBeenCalled();
      expect(result).toEqual({ appName: 'TG云盘' });
    });
  });

  describe('PATCH /admin/config', () => {
    it('delegates updateSystemConfig with adminId, dto, ip, ua', async () => {
      const dto = { appName: 'New Name', confirmPassword: 'pwd' };
      adminService.updateSystemConfig.mockResolvedValue({ success: true });
      const result = await controller.updateConfig('admin-1', dto as any, req());
      expect(adminService.updateSystemConfig).toHaveBeenCalledWith('admin-1', dto, '127.0.0.1', 'jest');
      expect(result).toEqual({ success: true });
    });
  });

  describe('POST /admin/test-email', () => {
    it('delegates testEmail with adminId, to, ip, ua', async () => {
      adminService.testEmail.mockResolvedValue({ sent: true });
      const result = await controller.testEmail('admin-1', 'a@b.com', req());
      expect(adminService.testEmail).toHaveBeenCalledWith('admin-1', 'a@b.com', '127.0.0.1', 'jest');
      expect(result).toEqual({ sent: true });
    });
  });

  describe('POST /admin/test-sms', () => {
    it('delegates testSms with adminId, to, ip, ua', async () => {
      adminService.testSms.mockResolvedValue({ sent: true, devCode: '123456' });
      const result = await controller.testSms('admin-1', '13800138000', req());
      expect(adminService.testSms).toHaveBeenCalledWith('admin-1', '13800138000', '127.0.0.1', 'jest');
      expect(result).toEqual({ sent: true, devCode: '123456' });
    });
  });

  describe('POST /admin/test-verify', () => {
    it('delegates testVerifyCode with adminId, channel, code, ip, ua', async () => {
      const body = { channel: 'email' as const, code: '123456' };
      adminService.testVerifyCode.mockResolvedValue({ valid: true });
      const result = await controller.testVerifyCode('admin-1', body, req());
      expect(adminService.testVerifyCode).toHaveBeenCalledWith('admin-1', 'email', '123456', '127.0.0.1', 'jest');
      expect(result).toEqual({ valid: true });
    });
  });
});
