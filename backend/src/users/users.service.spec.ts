import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { User, UserRole, UserStatus } from './entities/user.entity';
import { Device } from './entities/device.entity';
import { AuditLog } from './entities/audit-log.entity';
import { Node } from '../files/entities/node.entity';
import { REDIS_CLIENT } from '../common/redis/redis.module';
import { VerificationService } from '../verification/verification.service';
import { VerificationPurpose } from '../verification/verification.entity';

// ── Mock encryption ──────────────────────────────────────────────────────────
jest.mock('../common/encryption', () => {
  const actual = jest.requireActual('../common/encryption');
  return {
    ...actual,
    hashPassword: jest.fn().mockResolvedValue('$2b$12$dummyhash'),
    comparePassword: jest.fn(),
    generateSalt: actual.generateSalt,
    encryptField: jest.fn().mockReturnValue('encrypted-field-data'),
    decryptField: jest.fn().mockReturnValue('decrypted@example.com'),
    hashIdentifier: jest.fn().mockReturnValue('hashed-identifier'),
    normalizeEmail: jest.fn().mockImplementation((e: string) => e.trim().toLowerCase()),
    normalizePhone: jest.fn().mockImplementation((p: string) => p.replace(/\s/g, '')),
    generateSecureToken: actual.generateSecureToken,
  };
});

const {
  hashPassword,
  comparePassword,
  encryptField,
  decryptField,
  hashIdentifier,
  normalizeEmail,
  normalizePhone,
} = require('../common/encryption');

// ── Factory ──────────────────────────────────────────────────────────────────
const makeUser = (overrides: Partial<User> = {}): User =>
  ({
    id: 'u-1',
    username: 'alice',
    nickname: 'Alice',
    avatar: null,
    role: UserRole.USER,
    status: UserStatus.ACTIVE,
    quotaBytes: 10 * 1024**3,
    usedBytes: 0,
    passwordHash: '$2b$12$oldhash',
    mekSalt: 'deadbeef',
    privateSpaceHash: null,
    loginAttempts: 0,
    lockedUntil: null,
    emailEncrypted: null,
    emailHash: null,
    phoneEncrypted: null,
    phoneHash: null,
    notifyShareAccess: true,
    notifyForeignLogin: true,
    oauthProvider: null,
    oauthId: null,
    deletedAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    nodes: [],
    shares: [],
    auditLogs: [],
    devices: [],
    ...overrides,
  } as User);

const makeDevice = (overrides: Partial<Device> = {}): Device =>
  ({
    id: 'd-1',
    userId: 'u-1',
    refreshTokenHash: 'rt-hash',
    deviceName: 'Chrome / Windows',
    ipAddress: '127.0.0.1',
    userAgent: 'Mozilla/5.0',
    lastActiveAt: new Date(),
    expiresAt: new Date('2026-07-01'),
    createdAt: new Date(),
    user: null as any,
    ...overrides,
  } as Device);

describe('UsersService', () => {
  let service: UsersService;
  let userRepo: any;
  let deviceRepo: any;
  let auditRepo: any;
  let nodeRepo: any;

  const mockRedis = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    incr: jest.fn().mockResolvedValue(0),
    expire: jest.fn().mockResolvedValue(1),
    del: jest.fn().mockResolvedValue(1),
  };

  const mockConfig = {
    get: jest.fn((key: string) => {
      if (key === 'ENCRYPTION_MASTER_KEY') return '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      if (key === 'FORCE_LOGOUT_TTL_SECONDS') return 2592000;
      return null;
    }),
  };

  const mockVerification = {
    sendCode: jest.fn(),
    verify: jest.fn(),
  };

  beforeEach(async () => {
    userRepo = {
      findOne: jest.fn(),
      findOneBy: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    };
    deviceRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };
    auditRepo = {
      findAndCount: jest.fn(),
      create: jest.fn().mockReturnValue({}),
      save: jest.fn().mockResolvedValue({}),
    };
    nodeRepo = {
      createQueryBuilder: jest.fn(),
      count: jest.fn(),
    };
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(Device), useValue: deviceRepo },
        { provide: getRepositoryToken(AuditLog), useValue: auditRepo },
        { provide: getRepositoryToken(Node), useValue: nodeRepo },
        { provide: REDIS_CLIENT, useValue: mockRedis },
        { provide: JwtService, useValue: { sign: jest.fn().mockReturnValue('ps-jwt-token') } },
        { provide: ConfigService, useValue: mockConfig },
        { provide: VerificationService, useValue: mockVerification },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // findUserOrFail
  // ═══════════════════════════════════════════════════════════════════════════
  describe('findUserOrFail', () => {
    it('returns user when found and active', async () => {
      const user = makeUser();
      userRepo.findOne.mockResolvedValue(user);
      await expect(service.findUserOrFail('u-1')).resolves.toEqual(user);
    });

    it('throws NotFoundException when user missing', async () => {
      userRepo.findOne.mockResolvedValue(null);
      await expect(service.findUserOrFail('u-99')).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when user is disabled', async () => {
      userRepo.findOne.mockResolvedValue(makeUser({ status: UserStatus.DISABLED }));
      await expect(service.findUserOrFail('u-1')).rejects.toThrow(ForbiddenException);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // getProfile
  // ═══════════════════════════════════════════════════════════════════════════
  describe('getProfile', () => {
    it('returns safe user with contact info when master key available', async () => {
      userRepo.findOne.mockResolvedValue(makeUser({ emailEncrypted: 'enc-email' }));
      const result = await service.getProfile('u-1');
      expect(result.username).toBe('alice');
      expect(result.hasEmail).toBe(true);
      expect(result.hasPrivateSpace).toBe(false);
      expect(result.role).toBe(UserRole.USER);
    });

    it('returns safe user without decrypting when master key missing', async () => {
      mockConfig.get.mockReturnValueOnce(null); // first ENCRYPTION_MASTER_KEY call
      userRepo.findOne.mockResolvedValue(makeUser());
      const result = await service.getProfile('u-1');
      expect(result.email).toBeNull();
      expect(result.phone).toBeNull();
    });

    it('returns hasPrivateSpace=true when privateSpaceHash set', async () => {
      userRepo.findOne.mockResolvedValue(makeUser({ privateSpaceHash: '$2b$12$hash' }));
      const result = await service.getProfile('u-1');
      expect(result.hasPrivateSpace).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // updateProfile
  // ═══════════════════════════════════════════════════════════════════════════
  describe('updateProfile', () => {
    it('updates username when different and not taken', async () => {
      userRepo.findOne.mockResolvedValueOnce(makeUser()); // findUserOrFail
      userRepo.findOne.mockResolvedValueOnce(null);       // duplicate check
      userRepo.save.mockResolvedValue(makeUser({ username: 'bob' }));
      const result = await service.updateProfile('u-1', { username: 'bob' });
      expect(result.username).toBe('bob'); // safeUser returns saved user
    });

    it('updates nickname and avatar', async () => {
      userRepo.findOne.mockResolvedValueOnce(makeUser());
      userRepo.save.mockResolvedValue(makeUser({ nickname: 'Ali', avatar: '/a.png' }));
      await service.updateProfile('u-1', { nickname: 'Ali', avatar: '/a.png' });
      expect(userRepo.save).toHaveBeenCalled();
    });

    it('throws ConflictException when username taken', async () => {
      userRepo.findOne.mockResolvedValueOnce(makeUser());                // current user
      userRepo.findOne.mockResolvedValueOnce(makeUser({ id: 'u-2' }));   // taken by another
      await expect(
        service.updateProfile('u-1', { username: 'taken' }),
      ).rejects.toThrow(ConflictException);
    });

    it('throws BadRequestException for empty username', async () => {
      userRepo.findOne.mockResolvedValueOnce(makeUser());
      await expect(
        service.updateProfile('u-1', { username: '   ' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('skips username update when same as current', async () => {
      userRepo.findOne.mockResolvedValueOnce(makeUser({ username: 'alice' }));
      userRepo.save.mockResolvedValue(makeUser());
      await service.updateProfile('u-1', { username: 'alice' });
      // duplicate check should NOT be called
      expect(userRepo.findOne).toHaveBeenCalledTimes(1); // only findUserOrFail
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // sendBindEmailCode
  // ═══════════════════════════════════════════════════════════════════════════
  describe('sendBindEmailCode', () => {
    beforeEach(() => {
      userRepo.findOne.mockResolvedValue(makeUser());
      mockVerification.sendCode.mockResolvedValue({ message: '验证码已发送' });
    });

    it('sends code to new email', async () => {
      const result = await service.sendBindEmailCode('u-1', 'new@example.com');
      expect(mockVerification.sendCode).toHaveBeenCalledWith(
        'new@example.com',
        VerificationPurpose.CHANGE_EMAIL,
      );
      expect(result).toEqual({ message: '验证码已发送' });
    });

    it('throws BadRequestException when same email already bound', async () => {
      (hashIdentifier as jest.Mock).mockReturnValueOnce('existing-hash');
      userRepo.findOne.mockReset();
      userRepo.findOne.mockResolvedValueOnce(makeUser({ emailHash: 'existing-hash' }));
      await expect(
        service.sendBindEmailCode('u-1', 'same@example.com'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException when email taken by another user', async () => {
      (hashIdentifier as jest.Mock).mockReturnValueOnce('other-hash');
      userRepo.findOne
        .mockResolvedValueOnce(makeUser())                          // current user
        .mockResolvedValueOnce(makeUser({ id: 'u-2' }));            // dup
      await expect(
        service.sendBindEmailCode('u-1', 'taken@example.com'),
      ).rejects.toThrow(ConflictException);
    });

    it('throws ServiceUnavailableException when master key missing', async () => {
      mockConfig.get.mockReturnValueOnce(null);
      await expect(
        service.sendBindEmailCode('u-1', 'any@example.com'),
      ).rejects.toThrow(ServiceUnavailableException);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // sendBindEmailOldCode
  // ═══════════════════════════════════════════════════════════════════════════
  describe('sendBindEmailOldCode', () => {
    it('sends OTP to current bound email', async () => {
      userRepo.findOne.mockResolvedValue(makeUser({ emailEncrypted: 'enc-old' }));
      (decryptField as jest.Mock).mockReturnValueOnce('old@example.com');
      mockVerification.sendCode.mockResolvedValue({ message: '验证码已发送' });
      const result = await service.sendBindEmailOldCode('u-1');
      expect(mockVerification.sendCode).toHaveBeenCalledWith(
        'old@example.com',
        VerificationPurpose.CHANGE_EMAIL,
      );
      expect(result.message).toBe('验证码已发送');
    });

    it('throws BadRequestException when no email bound', async () => {
      userRepo.findOne.mockResolvedValue(makeUser({ emailEncrypted: null }));
      await expect(service.sendBindEmailOldCode('u-1')).rejects.toThrow(BadRequestException);
    });

    it('throws ServiceUnavailableException on decrypt failure', async () => {
      userRepo.findOne.mockResolvedValue(makeUser({ emailEncrypted: 'enc' }));
      (decryptField as jest.Mock).mockImplementationOnce(() => {
        throw new Error('decrypt fail');
      });
      await expect(service.sendBindEmailOldCode('u-1')).rejects.toThrow(ServiceUnavailableException);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // bindEmail
  // ═══════════════════════════════════════════════════════════════════════════
  describe('bindEmail', () => {
    const newEmail = 'new@example.com';

    beforeEach(() => {
      userRepo.findOne.mockResolvedValue(makeUser());
      (encryptField as jest.Mock).mockReturnValue('enc-new');
      (hashIdentifier as jest.Mock).mockReturnValue('new-hash');
      mockVerification.verify.mockResolvedValue(undefined);
      userRepo.save.mockResolvedValue({});
    });

    it('binds email first time (no old code required)', async () => {
      const result = await service.bindEmail('u-1', newEmail, '123456');
      expect(mockVerification.verify).toHaveBeenCalledTimes(1); // new email only
      expect(result.message).toBe('邮箱绑定成功');
    });

    it('requires oldEmailCode when changing bound email (dual-confirm)', async () => {
      userRepo.findOne.mockReset();
      userRepo.findOne.mockResolvedValue(
        makeUser({ emailEncrypted: 'enc-old' }),
      );
      (decryptField as jest.Mock).mockReturnValueOnce('old@example.com');

      await service.bindEmail('u-1', newEmail, 'new-code', 'old-code', '1.2.3.4', 'UA');
      expect(mockVerification.verify).toHaveBeenCalledTimes(2);
      expect(mockVerification.verify).toHaveBeenNthCalledWith(
        1, 'old@example.com', 'old-code', VerificationPurpose.CHANGE_EMAIL,
      );
      expect(mockVerification.verify).toHaveBeenNthCalledWith(
        2, newEmail, 'new-code', VerificationPurpose.CHANGE_EMAIL,
      );
    });

    it('throws when changing email without oldEmailCode', async () => {
      userRepo.findOne.mockReset();
      userRepo.findOne.mockResolvedValue(
        makeUser({ emailEncrypted: 'enc-old' }),
      );
      await expect(
        service.bindEmail('u-1', newEmail, 'new-code'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when email already bound', async () => {
      (hashIdentifier as jest.Mock).mockReturnValueOnce('existing');
      userRepo.findOne.mockReset();
      userRepo.findOne.mockResolvedValue(makeUser({ emailHash: 'existing' }));
      await expect(
        service.bindEmail('u-1', newEmail, 'code'),
      ).rejects.toThrow(BadRequestException);
    });

    it('handles duplicate key on save (race)', async () => {
      userRepo.findOne.mockReset();
      userRepo.findOne.mockResolvedValue(makeUser());
      (hashIdentifier as jest.Mock).mockReturnValue('new-hash');
      userRepo.save.mockRejectedValue({ code: '23505', message: 'duplicate key' });
      await expect(
        service.bindEmail('u-1', newEmail, 'code'),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // sendBindPhoneCode
  // ═══════════════════════════════════════════════════════════════════════════
  describe('sendBindPhoneCode', () => {
    it('sends code to new phone', async () => {
      userRepo.findOne.mockResolvedValue(makeUser());
      (normalizePhone as jest.Mock).mockReturnValue('13800138000');
      mockVerification.sendCode.mockResolvedValue({ message: '验证码已发送' });
      await service.sendBindPhoneCode('u-1', '13800138000');
      expect(mockVerification.sendCode).toHaveBeenCalledWith(
        '13800138000', VerificationPurpose.CHANGE_PHONE,
      );
    });

    it('throws BadRequestException for invalid phone format', async () => {
      userRepo.findOne.mockResolvedValue(makeUser());
      (normalizePhone as jest.Mock).mockReturnValue(null);
      await expect(
        service.sendBindPhoneCode('u-1', 'abc'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException when phone taken', async () => {
      (normalizePhone as jest.Mock).mockReturnValue('13800138000');
      (hashIdentifier as jest.Mock).mockReturnValue('dup-hash');
      userRepo.findOne
        .mockResolvedValueOnce(makeUser())
        .mockResolvedValueOnce(makeUser({ id: 'u-2' }));
      await expect(
        service.sendBindPhoneCode('u-1', '13800138000'),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // sendBindPhoneOldCode
  // ═══════════════════════════════════════════════════════════════════════════
  describe('sendBindPhoneOldCode', () => {
    it('sends OTP to current bound phone', async () => {
      userRepo.findOne.mockResolvedValue(makeUser({ phoneEncrypted: 'enc' }));
      (decryptField as jest.Mock).mockReturnValueOnce('13800138000');
      mockVerification.sendCode.mockResolvedValue({ message: '验证码已发送' });
      const result = await service.sendBindPhoneOldCode('u-1');
      expect(result.message).toBe('验证码已发送');
    });

    it('throws when no phone bound', async () => {
      userRepo.findOne.mockResolvedValue(makeUser());
      await expect(service.sendBindPhoneOldCode('u-1')).rejects.toThrow(BadRequestException);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // bindPhone
  // ═══════════════════════════════════════════════════════════════════════════
  describe('bindPhone', () => {
    it('binds phone first time', async () => {
      userRepo.findOne.mockResolvedValue(makeUser());
      (normalizePhone as jest.Mock).mockReturnValue('13800138000');
      (hashIdentifier as jest.Mock).mockReturnValue('phone-hash');
      (encryptField as jest.Mock).mockReturnValue('enc-phone');
      mockVerification.verify.mockResolvedValue(undefined);
      userRepo.save.mockResolvedValue({});
      const result = await service.bindPhone('u-1', '13800138000', 'code');
      expect(result.message).toBe('手机号绑定成功');
      expect(mockVerification.verify).toHaveBeenCalledTimes(1);
    });

    it('dual-confirm when changing phone', async () => {
      userRepo.findOne.mockReset();
      userRepo.findOne.mockResolvedValue(
        makeUser({ phoneEncrypted: 'enc-old' }),
      );
      (normalizePhone as jest.Mock).mockReturnValue('13900139000');
      (hashIdentifier as jest.Mock).mockReturnValue('new-phone-hash');
      (decryptField as jest.Mock).mockReturnValueOnce('13800138000');
      (encryptField as jest.Mock).mockReturnValue('enc-new');
      mockVerification.verify.mockResolvedValue(undefined);
      userRepo.save.mockResolvedValue({});
      await service.bindPhone('u-1', '13900139000', 'new-code', 'old-code');
      expect(mockVerification.verify).toHaveBeenCalledTimes(2);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // sendChangePasswordCode
  // ═══════════════════════════════════════════════════════════════════════════
  describe('sendChangePasswordCode', () => {
    it('sends OTP to bound email', async () => {
      userRepo.findOne.mockResolvedValue(makeUser({ emailEncrypted: 'enc' }));
      (decryptField as jest.Mock).mockReturnValueOnce('user@example.com');
      mockVerification.sendCode.mockResolvedValue({ message: '验证码已发送' });
      await service.sendChangePasswordCode('u-1');
      expect(mockVerification.sendCode).toHaveBeenCalledWith(
        'user@example.com', VerificationPurpose.CHANGE_PASSWORD,
      );
    });

    it('throws BadRequestException when no email bound', async () => {
      userRepo.findOne.mockResolvedValue(makeUser());
      await expect(service.sendChangePasswordCode('u-1')).rejects.toThrow(BadRequestException);
    });

    it('throws ServiceUnavailableException when master key missing', async () => {
      // findUserOrFail must succeed first, then master key check fails
      userRepo.findOne.mockResolvedValue(makeUser({ emailEncrypted: 'enc' }));
      mockConfig.get.mockReturnValueOnce(null); // master key missing
      await expect(service.sendChangePasswordCode('u-1')).rejects.toThrow(ServiceUnavailableException);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // changePassword
  // ═══════════════════════════════════════════════════════════════════════════
  describe('changePassword', () => {
    const oldPassword = 'OldPass@123';
    const newPassword = 'NewPass@456';

    beforeEach(() => {
      userRepo.findOne.mockResolvedValue(makeUser()); // no email bound → legacy path
      (comparePassword as jest.Mock).mockResolvedValue(true);
      (hashPassword as jest.Mock).mockResolvedValue('$2b$12$newhash');
      mockRedis.set.mockResolvedValue('OK');
      userRepo.save.mockResolvedValue({});
      deviceRepo.delete.mockResolvedValue({ affected: 2 });
    });

    it('changes password successfully', async () => {
      const result = await service.changePassword('u-1', {
        oldPassword,
        newPassword,
      }, '1.2.3.4', 'UA');
      expect(result.message).toContain('密码修改成功');
      expect(deviceRepo.delete).toHaveBeenCalledWith({ userId: 'u-1' });
    });

    it('throws UnauthorizedException when old password wrong', async () => {
      (comparePassword as jest.Mock).mockResolvedValue(false);
      await expect(
        service.changePassword('u-1', { oldPassword, newPassword }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws BadRequestException when new equals old', async () => {
      await expect(
        service.changePassword('u-1', { oldPassword, newPassword: oldPassword }),
      ).rejects.toThrow(BadRequestException);
    });

    it('requires emailCode when user has bound email', async () => {
      userRepo.findOne.mockReset();
      userRepo.findOne.mockResolvedValue(
        makeUser({ emailEncrypted: 'enc' }),
      );
      (decryptField as jest.Mock).mockReturnValueOnce('user@example.com');
      mockVerification.verify.mockResolvedValue(undefined);

      await service.changePassword('u-1', {
        oldPassword,
        newPassword,
        emailCode: '123456',
      });
      expect(mockVerification.verify).toHaveBeenCalledWith(
        'user@example.com', '123456', VerificationPurpose.CHANGE_PASSWORD,
      );
    });

    it('throws when emailCode missing with bound email', async () => {
      userRepo.findOne.mockReset();
      userRepo.findOne.mockResolvedValue(
        makeUser({ emailEncrypted: 'enc' }),
      );
      await expect(
        service.changePassword('u-1', { oldPassword, newPassword }),
      ).rejects.toThrow(BadRequestException);
    });

    it('records partial_revocation audit when redis fails', async () => {
      mockRedis.set.mockRejectedValue(new Error('redis down'));
      await expect(
        service.changePassword('u-1', { oldPassword, newPassword }),
      ).rejects.toThrow(ServiceUnavailableException);
      // password change should still be audited
      expect(auditRepo.save).toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // getDevices
  // ═══════════════════════════════════════════════════════════════════════════
  describe('getDevices', () => {
    it('returns device list', async () => {
      deviceRepo.find.mockResolvedValue([
        makeDevice(),
        makeDevice({ id: 'd-2', deviceName: 'Firefox' }),
      ]);
      const result = await service.getDevices('u-1');
      expect(result).toHaveLength(2);
      expect(result[0].deviceName).toBe('Chrome / Windows');
    });

    it('returns empty array when no devices', async () => {
      deviceRepo.find.mockResolvedValue([]);
      const result = await service.getDevices('u-1');
      expect(result).toEqual([]);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // revokeDevice
  // ═══════════════════════════════════════════════════════════════════════════
  describe('revokeDevice', () => {
    it('revokes device when found', async () => {
      deviceRepo.findOne.mockResolvedValue(makeDevice());
      deviceRepo.delete.mockResolvedValue({ affected: 1 });
      const result = await service.revokeDevice('u-1', 'd-1');
      expect(result.message).toBe('设备已登出');
    });

    it('throws NotFoundException when device not found', async () => {
      deviceRepo.findOne.mockResolvedValue(null);
      await expect(service.revokeDevice('u-1', 'd-99')).rejects.toThrow(NotFoundException);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // setPrivateSpacePassword
  // ═══════════════════════════════════════════════════════════════════════════
  describe('setPrivateSpacePassword', () => {
    it('sets private space password first time', async () => {
      userRepo.findOne.mockResolvedValue(makeUser()); // no privateSpaceHash
      (hashPassword as jest.Mock).mockResolvedValue('$2b$12$ps-hash');
      userRepo.save.mockResolvedValue({});
      const result = await service.setPrivateSpacePassword('u-1', {
        password: 'MySecret123',
      });
      expect(result.message).toBe('私密空间密码设置成功');
    });

    it('changes private space password with correct current', async () => {
      userRepo.findOne.mockResolvedValue(
        makeUser({ privateSpaceHash: '$2b$12$old-ps' }),
      );
      (comparePassword as jest.Mock).mockResolvedValue(true);
      (hashPassword as jest.Mock).mockResolvedValue('$2b$12$new-ps');
      userRepo.save.mockResolvedValue({});
      await service.setPrivateSpacePassword('u-1', {
        password: 'NewSecret123',
        currentPassword: 'OldSecret123',
      });
      expect(userRepo.save).toHaveBeenCalled();
    });

    it('throws when changing without currentPassword', async () => {
      userRepo.findOne.mockResolvedValue(
        makeUser({ privateSpaceHash: 'exists' }),
      );
      await expect(
        service.setPrivateSpacePassword('u-1', { password: 'New12345' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws UnauthorizedException when current password wrong', async () => {
      userRepo.findOne.mockResolvedValue(
        makeUser({ privateSpaceHash: 'exists' }),
      );
      (comparePassword as jest.Mock).mockResolvedValue(false);
      await expect(
        service.setPrivateSpacePassword('u-1', {
          password: 'New12345',
          currentPassword: 'WrongOld',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws BadRequestException for password < 8 chars', async () => {
      userRepo.findOne.mockResolvedValue(makeUser());
      await expect(
        service.setPrivateSpacePassword('u-1', { password: 'Ab1' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for password without digit', async () => {
      userRepo.findOne.mockResolvedValue(makeUser());
      await expect(
        service.setPrivateSpacePassword('u-1', { password: 'abcdefgh' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for password without letter', async () => {
      userRepo.findOne.mockResolvedValue(makeUser());
      await expect(
        service.setPrivateSpacePassword('u-1', { password: '12345678' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // verifyPrivateSpace
  // ═══════════════════════════════════════════════════════════════════════════
  describe('verifyPrivateSpace', () => {
    beforeEach(() => {
      userRepo.findOne.mockResolvedValue(
        makeUser({ privateSpaceHash: '$2b$12$ps-hash' }),
      );
      mockRedis.get.mockResolvedValue(null); // not locked
      mockRedis.incr.mockResolvedValue(0);
      (comparePassword as jest.Mock).mockResolvedValue(true);
    });

    it('returns session token on correct password', async () => {
      const result = await service.verifyPrivateSpace('u-1', 'MySecret123');
      expect(result.sessionToken).toBe('ps-jwt-token');
      expect(result.expiresIn).toBe(30 * 60);
    });

    it('throws BadRequestException when no password set', async () => {
      userRepo.findOne.mockReset();
      userRepo.findOne.mockResolvedValue(makeUser({ privateSpaceHash: null }));
      await expect(
        service.verifyPrivateSpace('u-1', 'any'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws UnauthorizedException on wrong password', async () => {
      (comparePassword as jest.Mock).mockResolvedValue(false);
      mockRedis.incr.mockResolvedValue(1);
      await expect(
        service.verifyPrivateSpace('u-1', 'WrongPassword'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('locks out after max attempts', async () => {
      (comparePassword as jest.Mock).mockResolvedValue(false);
      mockRedis.incr.mockResolvedValue(5); // >= maxAttempts
      await expect(
        service.verifyPrivateSpace('u-1', 'Wrong'),
      ).rejects.toThrow(UnauthorizedException);
      expect(mockRedis.set).toHaveBeenCalledWith(
        'ps:lock:u-1', '1', 'EX', 15 * 60,
      );
    });

    it('throws when already locked', async () => {
      mockRedis.get.mockResolvedValue('1'); // locked
      await expect(
        service.verifyPrivateSpace('u-1', 'any'),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // getAuditLogs
  // ═══════════════════════════════════════════════════════════════════════════
  describe('getAuditLogs', () => {
    it('returns paginated audit logs', async () => {
      const logs = [
        { id: 'log-1', action: 'login', userId: 'u-1', createdAt: new Date() } as AuditLog,
      ];
      auditRepo.findAndCount.mockResolvedValue([logs, 1]);
      const result = await service.getAuditLogs('u-1', 1, 20);
      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
    });

    it('clamps page to minimum 1', async () => {
      auditRepo.findAndCount.mockResolvedValue([[], 0]);
      const result = await service.getAuditLogs('u-1', -5, 20);
      expect(result.page).toBe(1);
    });

    it('clamps limit to maximum 100', async () => {
      auditRepo.findAndCount.mockResolvedValue([[], 0]);
      const result = await service.getAuditLogs('u-1', 1, 500);
      expect(result.limit).toBe(100);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // getUserStats
  // ═══════════════════════════════════════════════════════════════════════════
  describe('getUserStats', () => {
    it('returns usage stats', async () => {
      userRepo.findOne.mockResolvedValue(makeUser({ quotaBytes: 50 * 1024**3, usedBytes: 10 * 1024**3 } as any));
      const mockQb = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          { mimeGroup: 'image', count: '5', totalSize: '1048576' },
          { mimeGroup: 'video', count: '2', totalSize: '52428800' },
        ]),
      };
      nodeRepo.createQueryBuilder.mockReturnValue(mockQb);
      nodeRepo.count.mockResolvedValueOnce(7).mockResolvedValueOnce(3);

      const result = await service.getUserStats('u-1');
      expect(result.totalFiles).toBe(7);
      expect(result.totalFolders).toBe(3);
      expect(result.filesByType.image).toEqual({ count: 5, size: 1048576 });
      expect(result.filesByType.video).toEqual({ count: 2, size: 52428800 });
      expect(result.quotaBytes).toBe(50 * 1024**3);
      expect(result.usedBytes).toBe(10 * 1024**3);
    });

    it('calculates usedPercent correctly', async () => {
      userRepo.findOne.mockResolvedValue(makeUser({ quotaBytes: 100 as any, usedBytes: 50 as any }));
      nodeRepo.createQueryBuilder.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      });
      nodeRepo.count.mockResolvedValue(0);
      const result = await service.getUserStats('u-1');
      expect(result.usedPercent).toBe(50);
    });

    it('returns 0 usedPercent when quota is 0', async () => {
      userRepo.findOne.mockResolvedValue(makeUser({ quotaBytes: 0 as any, usedBytes: 100 as any }));
      nodeRepo.createQueryBuilder.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      });
      nodeRepo.count.mockResolvedValue(0);
      const result = await service.getUserStats('u-1');
      expect(result.usedPercent).toBe(0);
    });
  });
});
