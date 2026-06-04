import { Test, TestingModule } from '@nestjs/testing';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';
import { WebdavService } from './webdav.service';
import { Node, NodeType } from '../files/entities/node.entity';
import { FileChunk } from '../files/entities/file-chunk.entity';
import { NodeKey } from '../files/entities/node-key.entity';
import { User } from '../users/entities/user.entity';
import { StorageService } from '../storage/storage.service';

describe('WebdavService', () => {
  let service: WebdavService;
  let nodeRepo: any;

  const mockStorage = { getPrimary: jest.fn(() => 'telegram'), getUrl: jest.fn(), upload: jest.fn() };

  beforeEach(async () => {
    nodeRepo = { findOne: jest.fn(), find: jest.fn(), save: jest.fn(), create: jest.fn(), delete: jest.fn(), update: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: 'test-secret' })],
      providers: [
        WebdavService,
        { provide: getRepositoryToken(Node), useValue: nodeRepo },
        { provide: getRepositoryToken(FileChunk), useValue: { find: jest.fn() } },
        { provide: getRepositoryToken(User), useValue: { findOne: jest.fn(), increment: jest.fn() } },
        { provide: getRepositoryToken(NodeKey), useValue: { findOne: jest.fn() } },
        { provide: StorageService, useValue: mockStorage },
      ],
    }).compile();

    service = module.get(WebdavService);
  });

  describe('resolvePath', () => {
    it('returns null for root path', async () => {
      const result = await (service as any).resolvePath('user-1', '/');
      expect(result).toBeNull();
    });

    it('returns null for empty path', async () => {
      const result = await (service as any).resolvePath('user-1', '');
      expect(result).toBeNull();
    });

    it('resolves single-level folder', async () => {
      nodeRepo.findOne.mockResolvedValue({ id: 'f-1', name: 'docs', type: NodeType.FOLDER });
      const result = await (service as any).resolvePath('user-1', 'docs');
      expect(result).toMatchObject({ id: 'f-1', name: 'docs' });
    });

    it('resolves nested path', async () => {
      nodeRepo.findOne
        .mockResolvedValueOnce({ id: 'f-1', name: 'docs', type: NodeType.FOLDER })
        .mockResolvedValueOnce({ id: 'f-2', name: 'sub', type: NodeType.FOLDER });
      const result = await (service as any).resolvePath('user-1', 'docs/sub');
      expect(result).toMatchObject({ id: 'f-2', name: 'sub' });
    });

    it('returns null when segment not found', async () => {
      nodeRepo.findOne.mockResolvedValueOnce({ id: 'f-1', name: 'docs', type: NodeType.FOLDER });
      nodeRepo.findOne.mockResolvedValueOnce(null);
      const result = await (service as any).resolvePath('user-1', 'docs/nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('resolveFile', () => {
    it('finds file in root', async () => {
      nodeRepo.findOne.mockResolvedValue({ id: 'n-1', name: 'test.txt', type: NodeType.FILE });
      const result = await (service as any).resolveFile('user-1', 'test.txt');
      expect(result).toMatchObject({ name: 'test.txt' });
    });

    it('returns null for non-existent file', async () => {
      nodeRepo.findOne.mockResolvedValue(null);
      const result = await (service as any).resolveFile('user-1', 'missing.txt');
      expect(result).toBeNull();
    });

    it('finds file in subfolder', async () => {
      nodeRepo.findOne
        .mockResolvedValueOnce({ id: 'f-1', name: 'docs', type: NodeType.FOLDER })
        .mockResolvedValueOnce({ id: 'n-2', name: 'doc.pdf', type: NodeType.FILE });
      const result = await (service as any).resolveFile('user-1', 'docs/doc.pdf');
      expect(result).toMatchObject({ name: 'doc.pdf' });
    });
  });

  describe('isDescendant', () => {
    it('detects direct child', async () => {
      nodeRepo.findOne.mockResolvedValue({ id: 'child', parentId: 'parent' });
      const result = await (service as any).isDescendant('user-1', 'parent', 'child');
      expect(result).toBe(true);
    });

    it('detects non-descendant', async () => {
      nodeRepo.findOne.mockResolvedValue({ id: 'a', parentId: 'root-a' });
      const result = await (service as any).isDescendant('user-1', 'parent', 'a');
      expect(result).toBe(false);
    });
  });
});
