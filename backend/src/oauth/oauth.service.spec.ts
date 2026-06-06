import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { OauthService } from './oauth.service';
import { User } from '../users/entities/user.entity';
import { Device } from '../users/entities/device.entity';
import { Subscription } from '../payment/entities/subscription.entity';

describe('OauthService', () => {
  let service: OauthService;
  let userRepo: any;
  let deviceRepo: any;
  let jwtService: JwtService;

  beforeEach(async () => {
    userRepo = { findOne: jest.fn(), create: jest.fn(), save: jest.fn(), update: jest.fn() };
    deviceRepo = { create: jest.fn().mockReturnValue({ id: 'dev-1' }), save: jest.fn(), update: jest.fn() };
    const subRepo = { create: jest.fn(), save: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OauthService,
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(Device), useValue: deviceRepo },
        { provide: getRepositoryToken(Subscription), useValue: subRepo },
        { provide: JwtService, useValue: { sign: jest.fn().mockReturnValue('jwt-token') } },
        { provide: ConfigService, useValue: { get: jest.fn((k: string) => k === 'JWT_REFRESH_SECRET' ? 'refresh-secret' : null) } },
      ],
    }).compile();

    service = module.get(OauthService);
    jwtService = module.get(JwtService);
  });

  describe('generateTokens', () => {
    it('creates device + signs access + refresh tokens', async () => {
      const user = { id: 'u1', role: 'user' } as User;
      const tokens = await service.generateTokens(user, '1.2.3.4', 'Mozilla/5.0');
      expect(tokens.accessToken).toBe('jwt-token');
      expect(tokens.refreshToken).toBe('jwt-token');
      expect(deviceRepo.create).toHaveBeenCalledTimes(1);
      expect(deviceRepo.save).toHaveBeenCalledTimes(1);
      expect(deviceRepo.update).toHaveBeenCalledWith('dev-1', expect.objectContaining({ refreshTokenHash: expect.any(String) }));
      expect(jwtService.sign).toHaveBeenCalledTimes(2);
    });
  });

  describe('linkAccount', () => {
    it('throws when user not found', async () => {
      userRepo.findOne.mockResolvedValue(null);
      await expect(
        service.linkAccount('u1', { provider: 'google', providerId: 'g123', email: null, name: 'A', avatar: null }),
      ).rejects.toThrow('用户不存在');
    });

    it('throws when OAuth account already linked to another user', async () => {
      userRepo.findOne
        .mockResolvedValueOnce({ id: 'u1' })
        .mockResolvedValueOnce({ id: 'u2' });
      await expect(
        service.linkAccount('u1', { provider: 'google', providerId: 'g123', email: null, name: 'A', avatar: null }),
      ).rejects.toThrow('已绑定其他用户');
    });

    it('links OAuth account to user', async () => {
      userRepo.findOne
        .mockResolvedValueOnce({ id: 'u1' })
        .mockResolvedValueOnce(null);
      const r = await service.linkAccount('u1', { provider: 'github', providerId: 'gh456', email: null, name: 'B', avatar: null });
      expect(userRepo.update).toHaveBeenCalledWith('u1', expect.objectContaining({ oauthProvider: 'github' }));
      expect(r.message).toContain('绑定成功');
    });
  });

  describe('findOrCreateUser', () => {
    const googleProfile = { provider: 'google' as const, providerId: 'g123', email: 'a@gmail.com', name: 'Alice', avatar: null };

    it('returns existing user by OAuth provider + id', async () => {
      const existing = { id: 'u1', username: 'alice', oauthProvider: 'google', oauthId: 'g123', status: 'active' };
      userRepo.findOne.mockResolvedValue(existing);
      const result = await service.findOrCreateUser(googleProfile);
      expect(result).toBe(existing);
    });

    it('throws when existing user is disabled', async () => {
      userRepo.findOne.mockResolvedValue({ id: 'u1', status: 'disabled' });
      await expect(service.findOrCreateUser(googleProfile)).rejects.toThrow('禁用');
    });

    it('creates new user when no OAuth link exists', async () => {
      userRepo.findOne.mockResolvedValueOnce(null) // OAuth lookup
        .mockResolvedValueOnce(null); // username uniqueness check
      userRepo.create.mockReturnValue({ id: 'new-user', username: 'Alice' });
      userRepo.save.mockResolvedValue({ id: 'new-user', username: 'Alice' });
      const subRepo = { create: jest.fn().mockReturnValue({}), save: jest.fn() };
      (service as any).subRepo = subRepo;

      const result = await service.findOrCreateUser(googleProfile);
      expect(result.id).toBe('new-user');
    });

    it('handles username conflict by appending suffix', async () => {
      userRepo.findOne
        .mockResolvedValueOnce(null) // OAuth lookup
        .mockResolvedValueOnce({})   // username 'Alice' exists
        .mockResolvedValueOnce(null); // username 'Alice1' available
      userRepo.create.mockReturnValue({ id: 'u1c', username: 'Alice1' });
      userRepo.save.mockResolvedValue({ id: 'u1c', username: 'Alice1' });
      const subRepo = { create: jest.fn().mockReturnValue({}), save: jest.fn() };
      (service as any).subRepo = subRepo;

      const result = await service.findOrCreateUser(googleProfile);
      expect(result.username).toBe('Alice1');
    });

    it('updates avatar on each login for existing user', async () => {
      const existing = { id: 'u1', oauthProvider: 'google', oauthId: 'g123', avatar: 'old.jpg', status: 'active' };
      userRepo.findOne.mockResolvedValue(existing);
      await service.findOrCreateUser({ ...googleProfile, avatar: 'new.jpg' });
      expect(userRepo.update).toHaveBeenCalledWith('u1', { avatar: 'new.jpg' });
    });

    it('retries on unique constraint violation (race condition guard)', async () => {
      userRepo.findOne
        .mockResolvedValueOnce(null) // OAuth lookup
        .mockResolvedValueOnce(null) // username: Alice
        .mockResolvedValueOnce(null); // retry: Alice2
      // Return the current username (simulated by returning different objects)
      userRepo.create.mockReturnValueOnce({ id: 'u1', username: 'Alice' })
        .mockReturnValueOnce({ id: 'u2', username: 'Alice2' });
      userRepo.save
        .mockRejectedValueOnce({ code: '23505' })
        .mockResolvedValueOnce({ id: 'u2', username: 'Alice2' });
      const subRepo = { create: jest.fn().mockReturnValue({}), save: jest.fn() };
      (service as any).subRepo = subRepo;

      const result = await service.findOrCreateUser(googleProfile);
      expect(result.username).toBe('Alice2');
    });
  });

  describe('unlinkAccount', () => {
    it('throws when OAuth not linked', async () => {
      userRepo.findOne.mockResolvedValue({ id: 'u1', oauthProvider: null, passwordHash: 'hash' });
      await expect(service.unlinkAccount('u1', 'google')).rejects.toThrow('未绑定');
    });

    it('throws when user has no password (would lock out)', async () => {
      userRepo.findOne.mockResolvedValue({ id: 'u1', oauthProvider: 'google', oauthId: 'g1', passwordHash: '' });
      await expect(service.unlinkAccount('u1', 'google')).rejects.toThrow('请先设置密码');
    });

    it('unlinks OAuth account', async () => {
      userRepo.findOne.mockResolvedValue({ id: 'u1', oauthProvider: 'google', oauthId: 'g1', passwordHash: 'hash' });
      const r = await service.unlinkAccount('u1', 'google');
      expect(userRepo.update).toHaveBeenCalledWith('u1', { oauthProvider: null, oauthId: null });
      expect(r.message).toContain('已解绑');
    });
  });
});
