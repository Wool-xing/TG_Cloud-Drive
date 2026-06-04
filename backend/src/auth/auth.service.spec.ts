import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuthService } from './auth.service';
import { User, UserRole, UserStatus } from '../users/entities/user.entity';
import { Device } from '../users/entities/device.entity';
import { AuditLog } from '../users/entities/audit-log.entity';
import { Subscription } from '../payment/entities/subscription.entity';
import { REDIS_CLIENT } from '../common/redis/redis.module';
import { VerificationService } from '../verification/verification.service';

describe('AuthService', () => {
  let service: AuthService;
  let userRepo: any;
  let deviceRepo: any;
  let jwtService: JwtService;

  const mockRedis = { get: jest.fn(), set: jest.fn(), incr: jest.fn(), expire: jest.fn(), del: jest.fn() };
  const mockConfig = { get: jest.fn((key: string) => {
    if (key === 'ENCRYPTION_MASTER_KEY') return 'test-master-key-32-bytes-here!!';
    if (key === 'JWT_REFRESH_SECRET') return 'test-refresh-secret';
    if (key === 'LOGIN_LOCK_ATTEMPTS') return 5;
    if (key === 'LOGIN_LOCK_MINUTES') return 15;
    if (key === 'JWT_EXPIRES_IN') return '2h';
    return null;
  })};

  beforeEach(async () => {
    userRepo = { findOne: jest.fn(), findOneBy: jest.fn(), create: jest.fn(), save: jest.fn(), update: jest.fn(), count: jest.fn() };
    deviceRepo = { findOne: jest.fn(), create: jest.fn(), save: jest.fn(), update: jest.fn(), delete: jest.fn() };
    const auditRepo = { create: jest.fn(), save: jest.fn() };
    const subRepo = { create: jest.fn(), save: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(Device), useValue: deviceRepo },
        { provide: getRepositoryToken(AuditLog), useValue: auditRepo },
        { provide: getRepositoryToken(Subscription), useValue: subRepo },
        { provide: REDIS_CLIENT, useValue: mockRedis },
        { provide: JwtService, useValue: { sign: jest.fn().mockReturnValue('jwt-token'), verify: jest.fn() } },
        { provide: ConfigService, useValue: mockConfig },
        { provide: VerificationService, useValue: { verify: jest.fn() } },
      ],
    }).compile();

    service = module.get(AuthService);
    jwtService = module.get(JwtService);
  });

  describe('parseDeviceName', () => {
    it('returns "未知设备" for empty UA', () => {
      expect((service as any).parseDeviceName('')).toBe('未知设备');
    });

    it('returns "未知设备" for null UA', () => {
      expect((service as any).parseDeviceName(null)).toBe('未知设备');
    });

    it('returns "移动端" for mobile UA', () => {
      expect((service as any).parseDeviceName('Mozilla/5.0 Mobile Safari')).toBe('移动端');
    });

    it('returns "Windows" for Windows UA', () => {
      expect((service as any).parseDeviceName('Mozilla/5.0 Windows NT 10.0')).toBe('Windows');
    });

    it('returns "macOS" for Mac UA', () => {
      expect((service as any).parseDeviceName('Mozilla/5.0 Macintosh')).toBe('macOS');
    });

    it('returns "Linux" for Linux UA', () => {
      expect((service as any).parseDeviceName('X11; Linux x86_64')).toBe('Linux');
    });

    it('returns "浏览器" for unrecognized UA', () => {
      expect((service as any).parseDeviceName('SomeRandomBrowser/1.0')).toBe('浏览器');
    });
  });

  describe('safeUser', () => {
    it('returns sanitized user object without sensitive fields', () => {
      const user = {
        id: 'u-1', username: 'alice', nickname: 'Alice', avatar: null,
        role: UserRole.USER, quotaBytes: 10737418240, usedBytes: 1024,
        createdAt: new Date('2025-01-01'),
      } as User;
      const safe = service.safeUser(user);
      expect(safe).toMatchObject({ id: 'u-1', username: 'alice', role: UserRole.USER });
      expect(safe).not.toHaveProperty('passwordHash');
      expect(safe).not.toHaveProperty('mekSalt');
      expect(safe.quotaBytes).toBe(10737418240);
      expect(safe.usedBytes).toBe(1024);
    });
  });

  describe('logout', () => {
    it('throws if deviceId is missing', async () => {
      await expect(service.logout('')).rejects.toThrow('登录令牌缺少设备标识');
    });

    it('deletes device by id', async () => {
      deviceRepo.delete.mockResolvedValue({ affected: 1 });
      const r = await service.logout('device-1');
      expect(deviceRepo.delete).toHaveBeenCalledWith({ id: 'device-1' });
      expect(r.message).toContain('退出');
    });
  });

  describe('logoutAll', () => {
    it('deletes all devices for user', async () => {
      deviceRepo.delete.mockResolvedValue({ affected: 3 });
      const r = await service.logoutAll('user-1');
      expect(deviceRepo.delete).toHaveBeenCalledWith({ userId: 'user-1' });
      expect(r.message).toContain('退出');
    });
  });

  describe('hashRefreshToken', () => {
    it('produces consistent HMAC-SHA256 hash', () => {
      const h1 = (service as any).hashRefreshToken('token-abc');
      const h2 = (service as any).hashRefreshToken('token-abc');
      expect(h1).toBe(h2);
      expect(h1).toHaveLength(64); // SHA-256 hex = 64 chars
    });

    it('produces different hashes for different tokens', () => {
      const h1 = (service as any).hashRefreshToken('token-a');
      const h2 = (service as any).hashRefreshToken('token-b');
      expect(h1).not.toBe(h2);
    });
  });
});
