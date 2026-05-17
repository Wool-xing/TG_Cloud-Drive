import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { FilesService } from './files.service';
import { Node, NodeType } from './entities/node.entity';
import { FileChunk } from './entities/file-chunk.entity';
import { NodeKey } from './entities/node-key.entity';
import { NodeVersion } from './entities/node-version.entity';
import { FileRequest } from './entities/file-request.entity';
import { Tag } from './entities/tag.entity';
import { User } from '../users/entities/user.entity';
import { AuditLog } from '../users/entities/audit-log.entity';
import { StorageService } from '../storage/storage.service';
import { OcrService } from '../ocr/ocr.service';
import { REDIS_CLIENT } from '../common/redis/redis.module';
import { EmbeddingService } from './embedding.service';

describe('FilesService', () => {
  let service: FilesService;
  let nodeRepo: any;

  const mockRedis = { get: jest.fn(), set: jest.fn(), del: jest.fn() };
  const mockStorage = { getPrimary: jest.fn().mockReturnValue('telegram'), getUrl: jest.fn(), upload: jest.fn(), buildR2Key: jest.fn() };
  const mockEmbedding = { enabled: false, embed: jest.fn() };
  const mockOcr = { isSupported: jest.fn().mockReturnValue(false), extractText: jest.fn() };
  const mockConfig = { get: jest.fn().mockReturnValue('test-value') };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FilesService,
        { provide: getRepositoryToken(Node), useValue: { find: jest.fn(), findOne: jest.fn(), update: jest.fn(), createQueryBuilder: jest.fn(), increment: jest.fn(), save: jest.fn(), create: jest.fn() } },
        { provide: getRepositoryToken(FileChunk), useValue: { find: jest.fn(), count: jest.fn(), save: jest.fn(), create: jest.fn() } },
        { provide: getRepositoryToken(NodeKey), useValue: { findOne: jest.fn(), save: jest.fn(), create: jest.fn() } },
        { provide: getRepositoryToken(NodeVersion), useValue: { find: jest.fn(), save: jest.fn(), create: jest.fn() } },
        { provide: getRepositoryToken(FileRequest), useValue: { findOne: jest.fn(), save: jest.fn(), create: jest.fn() } },
        { provide: getRepositoryToken(Tag), useValue: { find: jest.fn() } },
        { provide: getRepositoryToken(User), useValue: { findOne: jest.fn(), increment: jest.fn() } },
        { provide: getRepositoryToken(AuditLog), useValue: { save: jest.fn(), create: jest.fn().mockReturnValue({}) } },
        { provide: REDIS_CLIENT, useValue: mockRedis },
        { provide: StorageService, useValue: mockStorage },
        { provide: EmbeddingService, useValue: mockEmbedding },
        { provide: OcrService, useValue: mockOcr },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get(FilesService);
    nodeRepo = module.get(getRepositoryToken(Node));
  });

  describe('getSyncDiff', () => {
    const oldDate = new Date('2024-01-01').toISOString();
    const recentDate = new Date(Date.now() + 86400000).toISOString(); // tomorrow

    it('rejects invalid date', async () => {
      await expect(service.getSyncDiff('user-1', 'not-a-date')).rejects.toThrow('Invalid');
    });

    it('returns empty when no changes', async () => {
      nodeRepo.find.mockResolvedValue([]);
      const deleteQb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      nodeRepo.createQueryBuilder.mockReturnValue(deleteQb);

      const result = await service.getSyncDiff('user-1', oldDate);
      expect(result.created).toHaveLength(0);
      expect(result.modified).toHaveLength(0);
      expect(result.deleted).toHaveLength(0);
      expect(result.total).toBe(0);
    });
  });

  describe('search', () => {
    it('sanitizes special characters', async () => {
      const qb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([{ id: '1', name: 'test', type: 'file' }]),
      };
      nodeRepo.createQueryBuilder = jest.fn().mockReturnValue(qb);

      const result = await service.search('user-1', 'test!@#$');
      expect(Array.isArray(result)).toBe(true);
    });
  });
});
