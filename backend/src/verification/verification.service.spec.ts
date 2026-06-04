import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { VerificationService } from './verification.service';
import { VerificationCode, VerificationPurpose } from './verification.entity';
import { MailService } from '../mail/mail.service';
import { REDIS_CLIENT } from '../common/redis/redis.module';

describe('VerificationService', () => {
  let service: VerificationService;
  let repo: any;
  let mockRedis: any;

  beforeEach(async () => {
    repo = { findOne: jest.fn(), create: jest.fn(), save: jest.fn(), update: jest.fn() };
    mockRedis = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
      incr: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1),
      del: jest.fn().mockResolvedValue(1),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VerificationService,
        { provide: getRepositoryToken(VerificationCode), useValue: repo },
        { provide: REDIS_CLIENT, useValue: mockRedis },
        { provide: MailService, useValue: { sendVerificationCode: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();

    service = module.get(VerificationService);
  });

  describe('sendCode', () => {
    it('throws if rate-limited (key exists)', async () => {
      mockRedis.get.mockResolvedValueOnce('1');
      await expect(service.sendCode('test@example.com', VerificationPurpose.REGISTER)).rejects.toThrow('请等待 1 分钟');
    });

    it('throws if Redis is down on rate check', async () => {
      mockRedis.get.mockRejectedValueOnce(new Error('down'));
      await expect(service.sendCode('test@example.com', VerificationPurpose.REGISTER)).rejects.toThrow('暂时不可用');
    });

    it('throws if Redis is down on set', async () => {
      mockRedis.get.mockResolvedValueOnce(null);
      mockRedis.set.mockRejectedValueOnce(new Error('down'));
      await expect(service.sendCode('test@example.com', VerificationPurpose.REGISTER)).rejects.toThrow('暂时不可用');
    });

    it('saves code and returns message', async () => {
      mockRedis.get.mockResolvedValueOnce(null);
      repo.create.mockReturnValue({ target: 'test@example.com', code: '123456' });
      const result = await service.sendCode('test@example.com', VerificationPurpose.REGISTER);
      expect(repo.save).toHaveBeenCalled();
      expect(result.message).toContain('已发送');
    });

    it('returns code in dev mode', async () => {
      const prev = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';
      mockRedis.get.mockResolvedValueOnce(null);
      repo.create.mockReturnValue({});
      const result = await service.sendCode('test@example.com', VerificationPurpose.REGISTER);
      expect(result.code).toBeDefined();
      expect(result.code).toHaveLength(6);
      process.env.NODE_ENV = prev;
    });
  });

  describe('verify', () => {
    const validRecord = { id: 'vc-1', target: 'test@test.com', code: '123456', purpose: VerificationPurpose.REGISTER, expiresAt: new Date(Date.now() + 60000), usedAt: null };

    it('throws if locked', async () => {
      mockRedis.get.mockResolvedValueOnce('1');
      await expect(service.verify('test@test.com', '123456', VerificationPurpose.REGISTER)).rejects.toThrow('连续错误次数过多');
    });

    it('throws if Redis is down on lock check', async () => {
      mockRedis.get.mockRejectedValueOnce(new Error('down'));
      await expect(service.verify('test@test.com', '123456', VerificationPurpose.REGISTER)).rejects.toThrow('暂时不可用');
    });

    it('throws on wrong code and increments fail counter', async () => {
      mockRedis.get.mockResolvedValueOnce(null);
      repo.findOne.mockResolvedValue(null);
      mockRedis.incr.mockResolvedValue(1);
      await expect(service.verify('test@test.com', 'wrong', VerificationPurpose.REGISTER)).rejects.toThrow('验证码错误或已过期');
      expect(mockRedis.incr).toHaveBeenCalled();
    });

    it('locks after max attempts', async () => {
      mockRedis.get.mockResolvedValueOnce(null);
      repo.findOne.mockResolvedValue(null);
      mockRedis.incr.mockResolvedValue(5);
      await expect(service.verify('test@test.com', 'wrong', VerificationPurpose.REGISTER)).rejects.toThrow('连续错误次数过多');
      expect(mockRedis.set).toHaveBeenCalledWith(expect.stringContaining('lock'), '1', 'EX', 900);
    });

    it('verifies valid code and marks used', async () => {
      mockRedis.get.mockResolvedValueOnce(null);
      repo.findOne.mockResolvedValue(validRecord);
      repo.update.mockResolvedValue({ affected: 1 });
      const result = await service.verify('test@test.com', '123456', VerificationPurpose.REGISTER);
      expect(result).toBe(true);
      expect(repo.update).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'vc-1' }),
        { usedAt: expect.any(Date) },
      );
    });

    it('throws if code already used (affected=0)', async () => {
      mockRedis.get.mockResolvedValueOnce(null);
      repo.findOne.mockResolvedValue(validRecord);
      repo.update.mockResolvedValue({ affected: 0 });
      await expect(service.verify('test@test.com', '123456', VerificationPurpose.REGISTER)).rejects.toThrow('已被使用');
    });
  });
});
