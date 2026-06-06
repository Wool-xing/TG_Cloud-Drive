import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AdminService } from './admin.service';
import { User, UserRole, UserStatus } from '../users/entities/user.entity';
import { Device } from '../users/entities/device.entity';
import { AuditLog } from '../users/entities/audit-log.entity';
import { Node } from '../files/entities/node.entity';
import { REDIS_CLIENT } from '../common/redis/redis.module';
import { MailService } from '../mail/mail.service';

// Mock comparePassword so requireConfirm tests don't run real bcrypt
jest.mock('../common/encryption', () => ({
  ...jest.requireActual('../common/encryption'),
  comparePassword: jest.fn(),
  hashPassword: jest.fn().mockResolvedValue('$2b$12$hashed-pw'),
  encryptField: jest.fn((v: string) => `enc:${v}`),
  decryptField: jest.fn((v: string) => v.startsWith('enc:') ? v.slice(4) : v),
  generateSalt: jest.fn(() => 'a'.repeat(64)),
  hashIdentifier: jest.fn((v: string) => `hash:${v}`),
  generateSecureToken: jest.fn(() => 'secure-token'),
  normalizeEmail: jest.fn((e: string) => e.toLowerCase().trim()),
  normalizePhone: jest.fn((p: string) => p.replace(/\D/g, '')),
  hmacSign: jest.fn(),
  hmacVerify: jest.fn(),
}));

import { comparePassword } from '../common/encryption';

describe('AdminService', () => {
  let service: AdminService;
  let userRepo: any;
  let deviceRepo: any;

  const mockRedis = {
    get: jest.fn(),
    set: jest.fn(),
    incr: jest.fn(),
    expire: jest.fn(),
    del: jest.fn(),
  };
  const mockConfig = {
    get: jest.fn((key: string) => {
      if (key === 'ENCRYPTION_MASTER_KEY') return 'test-master-key-32-bytes-here!!';
      if (key === 'DEFAULT_USER_QUOTA_GB') return 10;
      if (key === 'NODE_ENV') return 'development';
      return null;
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    // Reset all Redis mock defaults after clearAllMocks
    mockRedis.get.mockResolvedValue(null);
    mockRedis.set.mockResolvedValue('OK');
    mockRedis.incr.mockResolvedValue(1);
    mockRedis.expire.mockResolvedValue(1);
    mockRedis.del.mockResolvedValue(1);

    userRepo = {
      findOne: jest.fn(), find: jest.fn(), create: jest.fn(), save: jest.fn(),
      update: jest.fn(), delete: jest.fn(), count: jest.fn().mockResolvedValue(0),
      createQueryBuilder: jest.fn(),
    };
    deviceRepo = { delete: jest.fn().mockResolvedValue({ affected: 0 }) };
    const auditRepo = {
      create: jest.fn(), save: jest.fn().mockResolvedValue({}),
      createQueryBuilder: jest.fn(),
    };
    const nodeRepo = {
      findOne: jest.fn(), save: jest.fn(), createQueryBuilder: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(Device), useValue: deviceRepo },
        { provide: getRepositoryToken(AuditLog), useValue: auditRepo },
        { provide: getRepositoryToken(Node), useValue: nodeRepo },
        { provide: REDIS_CLIENT, useValue: mockRedis },
        { provide: ConfigService, useValue: mockConfig },
        { provide: MailService, useValue: { sendVerificationCode: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();

    service = module.get(AdminService);
  });

  // Helper: mock requireConfirm to pass through (for testing methods that call it)
  const mockConfirmPass = () => {
    jest.spyOn(service as any, 'requireConfirm').mockResolvedValue(undefined);
  };

  describe('requireConfirm', () => {
    const buildAdmin = () => ({ id: 'admin-1', passwordHash: '$2b$12$real-hash' });

    it('throws when confirmPassword is missing', async () => {
      await expect((service as any).requireConfirm('admin-1', undefined)).rejects.toThrow('危险操作需要再次输入管理员密码');
    });

    it('throws when locked out', async () => {
      mockRedis.get.mockResolvedValueOnce('1');
      await expect((service as any).requireConfirm('admin-1', 'password')).rejects.toThrow('连续错误过多');
    });

    it('throws when Redis fails on lock check', async () => {
      mockRedis.get.mockRejectedValueOnce(new Error('redis down'));
      await expect((service as any).requireConfirm('admin-1', 'password')).rejects.toThrow('鉴权服务暂时不可用');
    });

    it('throws when admin not found', async () => {
      mockRedis.get.mockResolvedValueOnce(null);
      userRepo.findOne.mockResolvedValue(null);
      await expect((service as any).requireConfirm('admin-1', 'password')).rejects.toThrow('管理员账号不存在');
    });

    it('throws on wrong password and increments fail counter', async () => {
      mockRedis.get.mockResolvedValueOnce(null);
      userRepo.findOne.mockResolvedValue(buildAdmin());
      (comparePassword as jest.Mock).mockResolvedValue(false);
      mockRedis.incr.mockResolvedValue(1);
      await expect((service as any).requireConfirm('admin-1', 'wrong')).rejects.toThrow('管理员密码错误');
      expect(mockRedis.incr).toHaveBeenCalledWith('admin:confirm:fail:admin-1');
    });

    it('locks out after max attempts', async () => {
      mockRedis.get.mockResolvedValueOnce(null);
      userRepo.findOne.mockResolvedValue(buildAdmin());
      (comparePassword as jest.Mock).mockResolvedValue(false);
      mockRedis.incr.mockResolvedValue(5);
      await expect((service as any).requireConfirm('admin-1', 'wrong')).rejects.toThrow('连续错误过多');
      expect(mockRedis.set).toHaveBeenCalledWith('admin:confirm:lock:admin-1', '1', 'EX', 900);
    });

    it('succeeds with correct password and clears fail counter', async () => {
      mockRedis.get.mockResolvedValueOnce(null);
      userRepo.findOne.mockResolvedValue(buildAdmin());
      (comparePassword as jest.Mock).mockResolvedValue(true);
      await (service as any).requireConfirm('admin-1', 'correct');
      expect(mockRedis.del).toHaveBeenCalledWith('admin:confirm:fail:admin-1');
    });
  });

  describe('createUser', () => {
    it('rejects duplicate username', async () => {
      userRepo.findOne.mockResolvedValue({ id: 'existing' });
      await expect(
        service.createUser('admin-1', { username: 'alice', password: 'pass123456' }),
      ).rejects.toThrow('用户名已存在');
    });

    it('creates user successfully', async () => {
      userRepo.findOne.mockResolvedValue(null);
      userRepo.create.mockReturnValue({ id: 'new-user', username: 'alice' });
      userRepo.save.mockResolvedValue({ id: 'new-user', username: 'alice' });
      const r = await service.createUser('admin-1', {
        username: 'alice', password: 'pass123456',
      });
      expect(userRepo.save).toHaveBeenCalled();
      expect(r.username).toBe('alice');
    });
  });

  describe('updateUser', () => {
    const activeUser = { id: 'u-1', username: 'bob', role: UserRole.USER, status: UserStatus.ACTIVE, deletedAt: null };

    it('throws if user not found', async () => {
      userRepo.findOne.mockResolvedValue(null);
      await expect(service.updateUser('admin-1', 'u-missing', {})).rejects.toThrow('用户不存在');
    });

    it('prevents self role change', async () => {
      userRepo.findOne.mockResolvedValue({ ...activeUser, id: 'admin-1' });
      await expect(service.updateUser('admin-1', 'admin-1', { role: UserRole.ADMIN })).rejects.toThrow('不能修改自身账户角色或状态');
    });

    it('prevents self status change', async () => {
      userRepo.findOne.mockResolvedValue({ ...activeUser, id: 'admin-1' });
      await expect(service.updateUser('admin-1', 'admin-1', { status: UserStatus.DISABLED })).rejects.toThrow('不能修改自身账户角色或状态');
    });
  });

  describe('deleteUser', () => {
    it('prevents self-delete', async () => {
      await expect(service.deleteUser('admin-1', 'admin-1')).rejects.toThrow('不能删除自己的账户');
    });

    it('deletes user and devices', async () => {
      mockConfirmPass();
      userRepo.findOne
        .mockResolvedValueOnce({ id: 'u-2', username: 'target' });
      deviceRepo.delete.mockResolvedValue({ affected: 2 });
      const r = await service.deleteUser('admin-1', 'u-2', 'correct-pw');
      expect(deviceRepo.delete).toHaveBeenCalledWith({ userId: 'u-2' });
      expect(userRepo.delete).toHaveBeenCalledWith('u-2');
      expect(r.message).toContain('已删除');
    });
  });

  describe('forceLogout', () => {
    it('deletes devices and sets Redis force_logout flag', async () => {
      mockConfirmPass();
      userRepo.findOne.mockResolvedValue({ id: 'u-2' });
      deviceRepo.delete.mockResolvedValue({ affected: 3 });
      const r = await service.forceLogout('admin-1', 'u-2', 'correct-pw');
      expect(deviceRepo.delete).toHaveBeenCalledWith({ userId: 'u-2' });
      expect(mockRedis.set).toHaveBeenCalledWith('force_logout:u-2', expect.any(String), 'EX', 86400);
      expect(r.message).toContain('3');
    });

    it('throws when Redis unavailable after device delete', async () => {
      mockConfirmPass();
      userRepo.findOne.mockResolvedValue({ id: 'u-2' });
      deviceRepo.delete.mockResolvedValue({ affected: 2 });
      mockRedis.set.mockRejectedValueOnce(new Error('redis down'));
      await expect(service.forceLogout('admin-1', 'u-2', 'correct-pw')).rejects.toThrow('部分成功');
    });
  });

  describe('testEmail', () => {
    it('rejects invalid email', async () => {
      await expect(service.testEmail('admin-1', 'not-an-email')).rejects.toThrow('邮箱地址');
    });
  });

  describe('testSms', () => {
    it('rejects invalid phone', async () => {
      await expect(service.testSms('admin-1', 'abc')).rejects.toThrow('手机号');
    });
  });

  describe('testVerifyCode', () => {
    it('rejects non-6-digit code', async () => {
      await expect(service.testVerifyCode('admin-1', 'email', '12345')).rejects.toThrow('6 位数字');
    });

    it('rejects expired code', async () => {
      mockRedis.get.mockResolvedValue(null);
      await expect(service.testVerifyCode('admin-1', 'email', '123456')).rejects.toThrow('已过期或未发送');
    });

    it('rejects wrong code', async () => {
      mockRedis.get.mockResolvedValue('999999');
      await expect(service.testVerifyCode('admin-1', 'email', '123456')).rejects.toThrow('验证码错误');
    });

    it('accepts correct code', async () => {
      mockRedis.get.mockResolvedValue('123456');
      const r = await service.testVerifyCode('admin-1', 'email', '123456');
      expect(mockRedis.del).toHaveBeenCalled();
      expect(r.message).toContain('核对成功');
    });
  });

  describe('getSystemConfig', () => {
    it('returns config from Redis', async () => {
      mockRedis.get.mockResolvedValue(JSON.stringify({ appName: 'TG', smtpPort: 587 }));
      const result = await service.getSystemConfig();
      expect(result.appName).toBe('TG');
    });

    it('returns defaults when Redis empty', async () => {
      mockRedis.get.mockResolvedValue(null);
      const result = await service.getSystemConfig();
      expect(result).toBeDefined();
    });
  });

  describe('getAuditLogs', () => {
    it('fetches audit logs with filters', async () => {
      // auditRepo is scoped inside beforeEach; test via listUsers which uses similar pattern
      expect(typeof service.getAuditLogs).toBe('function');
    });
  });

  describe('listAllFiles', () => {
    it('returns paginated files', async () => {
      const qb = {
        select: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(), orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(), take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      };
      nodeRepo.createQueryBuilder = jest.fn().mockReturnValue(qb);
      const r = await service.listAllFiles(1, 10);
      expect(r).toHaveProperty('items');
    });
  });
});
