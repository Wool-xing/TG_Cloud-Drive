import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as crypto from 'crypto';
import { AuthService } from './auth.service';
import { User, UserRole, UserStatus } from '../users/entities/user.entity';
import { Device } from '../users/entities/device.entity';
import { AuditLog } from '../users/entities/audit-log.entity';
import { Subscription } from '../payment/entities/subscription.entity';
import { REDIS_CLIENT } from '../common/redis/redis.module';
import { VerificationService } from '../verification/verification.service';

// Mock encryption module — bcrypt is slow in tests, use fast compare
jest.mock('../common/encryption', () => {
  const actual = jest.requireActual('../common/encryption');
  return {
    ...actual,
    hashPassword: jest.fn().mockResolvedValue('$2b$12$dummyhash'),
    comparePassword: jest.fn(),
    generateSalt: actual.generateSalt,
    encryptField: actual.encryptField,
    decryptField: actual.decryptField,
    hashIdentifier: actual.hashIdentifier,
    normalizeEmail: actual.normalizeEmail,
    normalizePhone: actual.normalizePhone,
    generateSecureToken: actual.generateSecureToken,
  };
});

const { comparePassword, hashPassword } = require('../common/encryption');

const makeUser = (overrides: Partial<User> = {}): User =>
  ({
    id: 'u-1', username: 'alice', nickname: 'Alice', avatar: null,
    role: UserRole.USER, status: UserStatus.ACTIVE, quotaBytes: 10n * 1024n ** 3n,
    usedBytes: 0n, passwordHash: '$2b$12$realhash', mekSalt: 'deadbeef',
    loginAttempts: 0, lockedUntil: null,
    emailEncrypted: null, emailHash: null, phoneEncrypted: null, phoneHash: null,
    oauthProvider: null, oauthId: null,
    ...overrides,
  } as User);

describe('AuthService', () => {
  let service: AuthService;
  let userRepo: any;
  let deviceRepo: any;
  let jwtService: JwtService;

  const mockRedis = { get: jest.fn(), set: jest.fn(), incr: jest.fn(), expire: jest.fn(), del: jest.fn() };
  const mockConfig = { get: jest.fn((key: string) => {
    if (key === 'ENCRYPTION_MASTER_KEY') return 'test-master-key-32-bytes-here!!';
    if (key === 'JWT_REFRESH_SECRET') return 'test-refresh-secret-32bytes!!';
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
    jest.clearAllMocks();

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

  // ── login ──────────────────────────────────────────────────────────────

  describe('login', () => {
    const dto = { identifier: 'alice', password: 'correct-horse' };

    it('returns accessToken + refreshToken + user + mekSalt on success', async () => {
      const user = makeUser();
      userRepo.findOne.mockResolvedValue(user);
      (comparePassword as jest.Mock).mockResolvedValue(true);
      deviceRepo.create.mockReturnValue({ id: 'dev-1' });
      deviceRepo.save.mockResolvedValue(undefined);
      deviceRepo.update.mockResolvedValue(undefined);

      const result = await service.login(dto, '1.2.3.4', 'Mozilla/5.0');

      expect(result.accessToken).toBe('jwt-token');
      expect(result.refreshToken).toBe('jwt-token');
      expect(result.user.username).toBe('alice');
      expect(result.mekSalt).toBe('deadbeef');
      expect(deviceRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u-1' }),
      );
      expect(jwtService.sign).toHaveBeenCalledTimes(2);
    });

    it('throws UnauthorizedException for wrong password', async () => {
      const user = makeUser();
      userRepo.findOne.mockResolvedValue(user);
      (comparePassword as jest.Mock).mockResolvedValue(false);

      await expect(service.login(dto, '1.2.3.4', '')).rejects.toThrow('用户名或密码错误');
      expect(userRepo.update).toHaveBeenCalledWith('u-1', expect.objectContaining({ loginAttempts: 1 }));
    });

    it('throws UnauthorizedException when user not found', async () => {
      userRepo.findOne.mockResolvedValue(null);
      (comparePassword as jest.Mock).mockResolvedValue(false);

      await expect(service.login(dto, '1.2.3.4', '')).rejects.toThrow('用户名或密码错误');
    });

    it('throws ForbiddenException when user is disabled', async () => {
      const user = makeUser({ status: UserStatus.DISABLED });
      userRepo.findOne.mockResolvedValue(user);

      await expect(service.login(dto, '1.2.3.4', '')).rejects.toThrow('账号已被禁用');
    });

    it('throws ForbiddenException when account is locked', async () => {
      const future = new Date(Date.now() + 10 * 60_000);
      const user = makeUser({ lockedUntil: future, loginAttempts: 5 });
      userRepo.findOne.mockResolvedValue(user);

      await expect(service.login(dto, '1.2.3.4', '')).rejects.toThrow('账号已锁定');
    });

    it('resets loginAttempts on successful login', async () => {
      const user = makeUser({ loginAttempts: 3 });
      userRepo.findOne.mockResolvedValue(user);
      (comparePassword as jest.Mock).mockResolvedValue(true);
      deviceRepo.create.mockReturnValue({ id: 'dev-1' });

      await service.login(dto, '1.2.3.4', '');

      expect(userRepo.update).toHaveBeenCalledWith('u-1', { loginAttempts: 0, lockedUntil: null });
    });

    it('locks account after max failed attempts', async () => {
      const user = makeUser({ loginAttempts: 4 });
      userRepo.findOne.mockResolvedValue(user);
      (comparePassword as jest.Mock).mockResolvedValue(false);

      await expect(service.login(dto, '1.2.3.4', '')).rejects.toThrow();
      expect(userRepo.update).toHaveBeenCalledWith('u-1', expect.objectContaining({
        lockedUntil: expect.any(Date),
        loginAttempts: 0,
      }));
    });
  });

  // ── refresh ────────────────────────────────────────────────────────────

  describe('refresh', () => {
    const validPayload = { sub: 'u-1', deviceId: 'dev-1', type: 'refresh' };

    beforeEach(() => {
      (jwtService.verify as jest.Mock).mockReturnValue(validPayload);
    });

    it('returns new accessToken for valid refresh token', async () => {
      const device = { id: 'dev-1', refreshTokenHash: 'deadbeef', expiresAt: new Date(Date.now() + 86400000) };
      deviceRepo.findOne.mockResolvedValue(device);
      userRepo.findOne.mockResolvedValue(makeUser());
      // Match the HMAC-SHA256 hash that auth.service computes
      const expectedHash = crypto.createHmac('sha256', 'test-refresh-secret-32bytes!!').update('valid-token').digest('hex');
      device.refreshTokenHash = expectedHash;

      const result = await service.refresh('valid-token', '1.2.3.4', '');

      expect(result.accessToken).toBe('jwt-token');
      expect(deviceRepo.update).toHaveBeenCalledWith('dev-1', expect.objectContaining({ lastActiveAt: expect.any(Date) }));
    });

    it('throws UnauthorizedException for invalid JWT', async () => {
      (jwtService.verify as jest.Mock).mockImplementation(() => { throw new Error('jwt expired'); });

      await expect(service.refresh('bad-token', '', '')).rejects.toThrow('刷新令牌无效');
    });

    it('throws UnauthorizedException when type is not refresh', async () => {
      (jwtService.verify as jest.Mock).mockReturnValue({ sub: 'u-1', deviceId: 'dev-1', type: 'access' });

      await expect(service.refresh('token', '', '')).rejects.toThrow('令牌类型无效');
    });

    it('throws UnauthorizedException when device not found', async () => {
      deviceRepo.findOne.mockResolvedValue(null);

      await expect(service.refresh('token', '', '')).rejects.toThrow('登录已过期');
    });

    it('throws UnauthorizedException when device expired', async () => {
      deviceRepo.findOne.mockResolvedValue({
        id: 'dev-1', refreshTokenHash: 'hash', expiresAt: new Date(Date.now() - 1000),
      });

      await expect(service.refresh('token', '', '')).rejects.toThrow('登录已过期');
    });

    it('throws UnauthorizedException when user is disabled', async () => {
      const device = { id: 'dev-1', refreshTokenHash: 'hash', expiresAt: new Date(Date.now() + 86400000) };
      deviceRepo.findOne.mockResolvedValue(device);
      userRepo.findOne.mockResolvedValue(makeUser({ status: UserStatus.DISABLED }));

      await expect(service.refresh('token', '', '')).rejects.toThrow();
    });
  });

  // ── issueTokens (private, tested via login) ────────────────────────────

  describe('issueTokens (via login)', () => {
    it('signs refresh token with type:refresh + deviceId', async () => {
      const user = makeUser();
      userRepo.findOne.mockResolvedValue(user);
      (comparePassword as jest.Mock).mockResolvedValue(true);
      deviceRepo.create.mockReturnValue({ id: 'dev-x' });

      await service.login({ identifier: 'alice', password: 'pw' }, '', '');

      const calls = (jwtService.sign as jest.Mock).mock.calls;
      // First call: access token, second: refresh token
      const refreshCall = calls.find((c: any[]) => c[1]?.secret === 'test-refresh-secret-32bytes!!');
      expect(refreshCall).toBeDefined();
      expect(refreshCall[0]).toMatchObject({ sub: 'u-1', type: 'refresh', deviceId: 'dev-x' });
    });

    it('stores refreshTokenHash on device after signing', async () => {
      const user = makeUser();
      userRepo.findOne.mockResolvedValue(user);
      (comparePassword as jest.Mock).mockResolvedValue(true);
      deviceRepo.create.mockReturnValue({ id: 'dev-x' });

      await service.login({ identifier: 'alice', password: 'pw' }, '', '');

      expect(deviceRepo.update).toHaveBeenCalledWith(
        'dev-x',
        expect.objectContaining({ refreshTokenHash: expect.any(String) }),
      );
    });
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
