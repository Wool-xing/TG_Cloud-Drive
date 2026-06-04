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

  const mockRedis = { get: jest.fn(), set: jest.fn(), del: jest.fn() };
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
});
