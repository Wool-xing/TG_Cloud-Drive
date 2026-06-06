import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { SharesService } from './shares.service';
import { Share } from './entities/share.entity';
import { Node } from '../files/entities/node.entity';
import { AuditLog } from '../users/entities/audit-log.entity';
import { REDIS_CLIENT } from '../common/redis/redis.module';

describe('SharesService', () => {
  let service: SharesService;
  let shareRepo: any;
  let nodeRepo: any;

  const mockRedis = { get: jest.fn().mockResolvedValue(null), set: jest.fn(), del: jest.fn(), incr: jest.fn(), expire: jest.fn() };
  const mockConfig = { get: jest.fn(() => 'test-key') };

  beforeEach(async () => {
    shareRepo = { findOne: jest.fn(), find: jest.fn(), save: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() };
    nodeRepo = { findOne: jest.fn() };
    const auditRepo = { save: jest.fn(), create: jest.fn().mockReturnValue({}) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SharesService,
        { provide: getRepositoryToken(Share), useValue: shareRepo },
        { provide: getRepositoryToken(Node), useValue: nodeRepo },
        { provide: getRepositoryToken(AuditLog), useValue: auditRepo },
        { provide: REDIS_CLIENT, useValue: mockRedis },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get(SharesService);
  });

  const VALIDATION_MSG = '最大下载次数必须是 1 到 2147483647 之间的整数';

  describe('createShare validation', () => {
    it('rejects maxDownloads > 2^31-1', async () => {
      await expect(service.createShare('user-1', {
        nodeId: 'node-1',
        maxDownloads: 3_000_000_000,
      })).rejects.toThrow(VALIDATION_MSG);
    });

    it('rejects maxDownloads < 1', async () => {
      await expect(service.createShare('user-1', {
        nodeId: 'node-1',
        maxDownloads: 0,
      })).rejects.toThrow(VALIDATION_MSG);
    });

    it('rejects NaN maxDownloads', async () => {
      await expect(service.createShare('user-1', {
        nodeId: 'node-1',
        maxDownloads: NaN,
      })).rejects.toThrow(VALIDATION_MSG);
    });

    it('accepts valid maxDownloads', async () => {
      const mockNode = { id: 'node-1', userId: 'user-1', name: 'test.pdf', type: 'file' };
      nodeRepo.findOne.mockResolvedValue(mockNode);
      shareRepo.findOne.mockResolvedValue(null);
      shareRepo.create.mockReturnValue({ id: 's1', token: 'tok123', downloadCount: 0,
        isActive: true, passwordHash: null, expireAt: null, maxDownloads: 5, shareKeyFragment: null,
        createdAt: new Date(), node: mockNode, user: {} });
      shareRepo.save.mockResolvedValue({});

      const result = await service.createShare('user-1', { nodeId: 'node-1', maxDownloads: 5 });
      expect(result).toHaveProperty('token');
    });
  });

  describe('listMyShares', () => {
    it('returns mapped shares with truncated token', async () => {
      shareRepo.find.mockResolvedValue([
        { id: 's1', nodeId: 'node-1', token: 't-abcdef-123', downloadCount: 5,
          maxDownloads: null, isActive: true, hasPassword: false,
          expireAt: null, shareKeyFragment: null, createdAt: new Date(),
          node: { id: 'node-1', name: 'doc.pdf', type: 'file' } },
      ]);

      const result = await service.listMyShares('user-1');
      expect(result).toHaveLength(1);
      expect(result[0].tokenPreview).toBeDefined();
      expect(result[0].nodeName).toBe('doc.pdf');
    });
  });

  describe('accessShare', () => {
    const validShare = {
      id: 's1', token: 'abc123', nodeId: 'n1', isActive: true,
      passwordHash: null, expireAt: null, maxDownloads: null, downloadCount: 0,
      oneTime: false, shareKeyFragment: null, createdAt: new Date(),
    };

    const validNode = { id: 'n1', name: 'test.pdf', deletedAt: null, type: 'file' };

    beforeEach(() => {
      nodeRepo.findOne.mockResolvedValue(validNode);
    });

    it('returns share info for valid token', async () => {
      shareRepo.findOne.mockResolvedValue(validShare);
      const result = await service.accessShare('abc123');
      expect(result.nodeId).toBe('n1');
    });

    it('throws for non-existent token', async () => {
      shareRepo.findOne.mockResolvedValue(null);
      await expect(service.accessShare('bad-token')).rejects.toThrow();
    });

    it('throws for inactive share', async () => {
      shareRepo.findOne.mockResolvedValue({ ...validShare, isActive: false });
      await expect(service.accessShare('abc123')).rejects.toThrow();
    });

    it('verifies password when share has one', async () => {
      const { comparePassword } = require('../common/encryption');
      comparePassword.mockResolvedValue(true);
      shareRepo.findOne.mockResolvedValue({ ...validShare, passwordHash: '$2b$hash' });
      const result = await service.accessShare('abc123', 'correct');
      expect(result.nodeId).toBe('n1');
    });

    it('throws on wrong password', async () => {
      const { comparePassword } = require('../common/encryption');
      comparePassword.mockResolvedValue(false);
      shareRepo.findOne.mockResolvedValue({ ...validShare, passwordHash: '$2b$hash' });
      await expect(service.accessShare('abc123', 'wrong')).rejects.toThrow();
    });

    it('throws for expired share', async () => {
      shareRepo.findOne.mockResolvedValue({
        ...validShare, expireAt: new Date('2020-01-01'),
      });
      await expect(service.accessShare('abc123')).rejects.toThrow();
    });

    it('throws when download limit reached', async () => {
      shareRepo.findOne.mockResolvedValue({
        ...validShare, maxDownloads: 3, downloadCount: 3,
      });
      await expect(service.accessShare('abc123')).rejects.toThrow();
    });
  });

  describe('deleteShare', () => {
    it('throws for non-existent share', async () => {
      shareRepo.findOne.mockResolvedValue(null);
      await expect(service.deleteShare('user-1', 'bad-id')).rejects.toThrow();
    });

    it('throws for share owned by another user', async () => {
      shareRepo.findOne.mockResolvedValue({ id: 's1', userId: 'user-2' });
      await expect(service.deleteShare('user-1', 's1')).rejects.toThrow();
    });
  });

  describe('incrementDownload', () => {
    it('increments download count', async () => {
      shareRepo.update.mockResolvedValue({ affected: 1 });
      await service.incrementDownload('s1');
      expect(shareRepo.update).toHaveBeenCalledWith('s1', expect.objectContaining({ downloadCount: expect.any(Function) }));
    });
  });

  describe('getShareToken', () => {
    it('returns full token for owner', async () => {
      shareRepo.findOne.mockResolvedValue({ id: 's1', userId: 'user-1', token: 'full-token-123' });
      const r = await service.getShareToken('user-1', 's1');
      expect(r.token).toBe('full-token-123');
    });

    it('throws for non-owner', async () => {
      shareRepo.findOne.mockResolvedValue({ id: 's1', userId: 'owner-1' });
      await expect(service.getShareToken('user-1', 's1')).rejects.toThrow();
    });
  });

  describe('createShare', () => {
    it('creates share with password', async () => {
      nodeRepo.findOne.mockResolvedValue({ id: 'n1', userId: 'u1', name: 'f.txt', type: 'file', isPrivate: false, isLocked: false, lockHash: null });
      shareRepo.create.mockReturnValue({ token: 'tok-abc' });
      shareRepo.save.mockResolvedValue({ id: 's1', token: 'tok-abc' });
      const r = await service.createShare('u1', { nodeId: 'n1', password: 'pwd', maxDownloads: 5 });
      expect(r).toHaveProperty('token');
    });

    it('throws for locked file without password', async () => {
      nodeRepo.findOne.mockResolvedValue({ id: 'n1', userId: 'u1', isLocked: true, lockHash: 'hash', isPrivate: false });
      await expect(service.createShare('u1', { nodeId: 'n1' })).rejects.toThrow();
    });
  });
});
