import { Test, TestingModule } from '@nestjs/testing';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CollaborationService } from './collaboration.service';
import { Node, NodeType } from '../files/entities/node.entity';
import { Share } from '../shares/entities/share.entity';
import { REDIS_CLIENT } from '../common/redis/redis.module';

describe('CollaborationService', () => {
  let service: CollaborationService;
  let nodeRepo: any;
  let shareRepo: any;
  let mockRedis: any;

  const mockNode = (overrides: Partial<Node> = {}): Node => ({
    id: 'node-1', userId: 'user-1', name: 'test.md', type: NodeType.FILE,
    size: 100, mimeType: 'text/markdown', parentId: null, isPrivate: false,
    isStarred: false, isLocked: false, lockHash: null, thumbnailFileId: null,
    md5Plain: null, note: null, ocrText: null, searchVector: null,
    createdAt: new Date(), updatedAt: new Date(), deletedAt: null,
    user: null as any, parent: null as any, children: [], chunks: [], keys: [], tags: [],
    ...overrides,
  });

  beforeEach(async () => {
    nodeRepo = { findOne: jest.fn() };
    shareRepo = { findOne: jest.fn() };
    mockRedis = { get: jest.fn(), incr: jest.fn(), decr: jest.fn(), del: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: 'test-secret' })],
      providers: [
        CollaborationService,
        { provide: getRepositoryToken(Node), useValue: nodeRepo },
        { provide: getRepositoryToken(Share), useValue: shareRepo },
        { provide: REDIS_CLIENT, useValue: mockRedis },
      ],
    }).compile();

    service = module.get(CollaborationService);
  });

  describe('verifyToken', () => {
    it('returns userId for valid token', async () => {
      const jwt = new JwtService({ secret: 'test-secret' });
      const token = jwt.sign({ sub: 'user-1' });
      const result = await service.verifyToken(token);
      expect(result).toEqual({ userId: 'user-1' });
    });

    it('returns null for invalid token', async () => {
      const result = await service.verifyToken('invalid-token');
      expect(result).toBeNull();
    });
  });

  describe('canAccessDoc', () => {
    it('owner has access', async () => {
      nodeRepo.findOne.mockResolvedValue(mockNode({ userId: 'user-1' }));
      const result = await service.canAccessDoc('user-1', 'node-1');
      expect(result).toBe(true);
    });

    it('non-owner without active share is denied', async () => {
      nodeRepo.findOne.mockResolvedValue(mockNode({ userId: 'user-1' }));
      shareRepo.findOne.mockResolvedValue(null);
      const result = await service.canAccessDoc('user-2', 'node-1');
      expect(result).toBe(false);
    });

    it('non-owner with active share is allowed', async () => {
      nodeRepo.findOne.mockResolvedValue(mockNode({ userId: 'user-1' }));
      shareRepo.findOne.mockResolvedValue({ id: 'share-1' });
      const result = await service.canAccessDoc('user-2', 'node-1');
      expect(result).toBe(true);
    });

    it('deleted node is denied', async () => {
      nodeRepo.findOne.mockResolvedValue(null);
      const result = await service.canAccessDoc('user-1', 'deleted-node');
      expect(result).toBe(false);
    });

    it('folder type is denied', async () => {
      nodeRepo.findOne.mockResolvedValue(mockNode({ type: NodeType.FOLDER }));
      const result = await service.canAccessDoc('user-1', 'node-1');
      expect(result).toBe(false);
    });
  });

  const docId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

  describe('getCollaborators', () => {
    it('returns peer count from Redis', async () => {
      mockRedis.get.mockResolvedValue('3');
      const result = await service.getCollaborators(docId);
      expect(result).toBe(3);
    });

    it('returns 0 when key not set', async () => {
      mockRedis.get.mockResolvedValue(null);
      const result = await service.getCollaborators(docId);
      expect(result).toBe(0);
    });

    it('returns 0 on Redis error', async () => {
      mockRedis.get.mockRejectedValue(new Error('down'));
      const result = await service.getCollaborators(docId);
      expect(result).toBe(0);
    });

    it('returns 0 for non-UUID nodeId without touching Redis', async () => {
      const result = await service.getCollaborators('not-a-uuid');
      expect(result).toBe(0);
      expect(mockRedis.get).not.toHaveBeenCalled();
    });
  });
});
