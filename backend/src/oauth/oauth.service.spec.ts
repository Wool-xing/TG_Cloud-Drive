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
