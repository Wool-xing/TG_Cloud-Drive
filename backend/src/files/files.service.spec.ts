import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
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

// Mock encryption
jest.mock('../common/encryption', () => ({
  hashPassword: jest.fn().mockResolvedValue('$2b$12$lockhash'),
  comparePassword: jest.fn().mockResolvedValue(true),
  generateSecureToken: jest.fn().mockReturnValue('mocked-secure-token'),
}));

const { hashPassword, comparePassword } = require('../common/encryption');

// ── Factories ────────────────────────────────────────────────────────────────
const makeNode = (overrides: Partial<Node> = {}): Node =>
  ({
    id: 'node-1',
    userId: 'u-1',
    parentId: null,
    name: 'test-file.txt',
    type: NodeType.FILE,
    size: 1024,
    mimeType: 'text/plain',
    md5Plain: null,
    isLocked: false,
    lockHash: null,
    isPrivate: false,
    isStarred: false,
    note: null,
    thumbnailFileId: null,
    sortOrder: 0,
    deletedAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    tags: [],
    user: null as any,
    chunks: [],
    keys: [],
    versions: [],
    shares: [],
    ...overrides,
  } as Node);

describe('FilesService', () => {
  let service: FilesService;
  let nodeRepo: any;
  let chunkRepo: any;
  let keyRepo: any;
  let versionRepo: any;
  let fileRequestRepo: any;
  let tagRepo: any;
  let userRepo: any;
  let auditRepo: any;

  const mockRedis = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    incr: jest.fn().mockResolvedValue(0),
    expire: jest.fn().mockResolvedValue(1),
  };
  const mockStorage = {
    getPrimary: jest.fn().mockReturnValue('telegram'),
    getUrl: jest.fn(),
    upload: jest.fn(),
    buildR2Key: jest.fn().mockReturnValue('r2-key'),
  };
  const mockEmbedding = { enabled: false, embed: jest.fn() };
  const mockOcr = { isSupported: jest.fn().mockReturnValue(false), extractText: jest.fn() };
  const mockConfig = { get: jest.fn().mockReturnValue('test-value') };

  const mockQb = () => ({
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue([]),
    getOne: jest.fn().mockResolvedValue(null),
  });

  beforeEach(async () => {
    nodeRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      increment: jest.fn(),
      save: jest.fn(),
      create: jest.fn().mockImplementation((dto) => ({ id: 'new-id', ...dto })),
      createQueryBuilder: jest.fn().mockReturnValue(mockQb()),
      count: jest.fn().mockResolvedValue(0),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    chunkRepo = { find: jest.fn(), findOne: jest.fn(), count: jest.fn(), save: jest.fn(), create: jest.fn().mockReturnValue({}) };
    keyRepo = { findOne: jest.fn(), save: jest.fn(), create: jest.fn().mockReturnValue({}) };
    versionRepo = { find: jest.fn(), findOne: jest.fn(), save: jest.fn(), create: jest.fn().mockReturnValue({}) };
    fileRequestRepo = { findOne: jest.fn(), save: jest.fn(), create: jest.fn().mockReturnValue({}) };
    tagRepo = { find: jest.fn(), findOne: jest.fn(), save: jest.fn(), create: jest.fn(), delete: jest.fn() };
    userRepo = { findOne: jest.fn(), increment: jest.fn().mockResolvedValue({}) };
    auditRepo = { save: jest.fn().mockResolvedValue({}), create: jest.fn().mockReturnValue({}) };
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FilesService,
        { provide: getRepositoryToken(Node), useValue: nodeRepo },
        { provide: getRepositoryToken(FileChunk), useValue: chunkRepo },
        { provide: getRepositoryToken(NodeKey), useValue: keyRepo },
        { provide: getRepositoryToken(NodeVersion), useValue: versionRepo },
        { provide: getRepositoryToken(FileRequest), useValue: fileRequestRepo },
        { provide: getRepositoryToken(Tag), useValue: tagRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(AuditLog), useValue: auditRepo },
        { provide: REDIS_CLIENT, useValue: mockRedis },
        { provide: StorageService, useValue: mockStorage },
        { provide: EmbeddingService, useValue: mockEmbedding },
        { provide: OcrService, useValue: mockOcr },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get(FilesService);
  });

  // ── Helpers ────────────────────────────────────────────────────────────────
  const mockNodeOwned = (node: Node) => {
    nodeRepo.findOne.mockResolvedValue(node);
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // createFolder
  // ═══════════════════════════════════════════════════════════════════════════
  describe('createFolder', () => {
    it('creates folder at root level', async () => {
      nodeRepo.findOne.mockResolvedValue(null); // no parent to validate
      nodeRepo.count.mockResolvedValue(0);       // under limit
      const result = await service.createFolder('u-1', 'New Folder', '', false);
      expect(result.name).toBe('New Folder');
      expect(result.type).toBe('folder');
      expect(nodeRepo.save).toHaveBeenCalled();
    });

    it('creates folder under existing parent', async () => {
      const parent = makeNode({ id: 'parent-1', type: NodeType.FOLDER });
      nodeRepo.findOne
        .mockResolvedValueOnce(parent)           // validateParent
        .mockResolvedValueOnce(null);            // checkDuplicate
      nodeRepo.count.mockResolvedValue(0);
      await service.createFolder('u-1', 'SubFolder', 'parent-1', false);
      expect(nodeRepo.save).toHaveBeenCalled();
    });

    it('throws when parent is a file', async () => {
      // validateParent searches with type:NodeType.FOLDER, which won't match a file
      nodeRepo.findOne.mockResolvedValue(null); // parent not found as folder
      await expect(
        service.createFolder('u-1', 'F', 'parent-1', false),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws when duplicate name exists', async () => {
      const parent = makeNode({ id: 'parent-1', type: NodeType.FOLDER });
      // validateParent succeeds, checkDuplicate finds conflict
      nodeRepo.findOne.mockResolvedValueOnce(parent);          // validateParent
      const dupQb = mockQb();
      dupQb.getOne.mockResolvedValue(makeNode({ name: 'Same' }));
      nodeRepo.createQueryBuilder = jest.fn().mockReturnValue(dupQb);
      nodeRepo.count.mockResolvedValue(0);
      await expect(
        service.createFolder('u-1', 'Same', 'parent-1', false),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // rename
  // ═══════════════════════════════════════════════════════════════════════════
  describe('rename', () => {
    it('renames a node', async () => {
      mockNodeOwned(makeNode());
      nodeRepo.findOne
        .mockResolvedValueOnce(makeNode())       // getNodeOwned
        .mockResolvedValueOnce(null);            // checkDuplicate
      const result = await service.rename('u-1', 'node-1', 'new-name.txt');
      expect(result.name).toBe('new-name.txt');
      expect(nodeRepo.update).toHaveBeenCalledWith('node-1', { name: 'new-name.txt' });
    });

    it('throws when duplicate name exists', async () => {
      mockNodeOwned(makeNode());
      // checkDuplicate uses query builder finding dup
      const dupQb = mockQb();
      dupQb.getOne.mockResolvedValue(makeNode({ id: 'node-2', name: 'dup' }));
      nodeRepo.createQueryBuilder = jest.fn().mockReturnValue(dupQb);
      await expect(
        service.rename('u-1', 'node-1', 'dup'),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // move
  // ═══════════════════════════════════════════════════════════════════════════
  describe('move', () => {
    it('moves node to a different folder', async () => {
      const src = makeNode({ id: 'src', parentId: 'old-parent' });
      const dest = makeNode({ id: 'dest', type: NodeType.FOLDER });
      nodeRepo.findOne
        .mockResolvedValueOnce(src)              // getNodeOwned (src)
        .mockResolvedValueOnce(dest)             // getNodeOwned (target)
        .mockResolvedValueOnce(null);            // checkDuplicate
      nodeRepo.count.mockResolvedValue(0);       // checkFolderLimit
      nodeRepo.find.mockResolvedValue([]);        // isDescendant
      nodeRepo.update.mockResolvedValue({ affected: 1 });

      const result = await service.move('u-1', 'src', 'dest');
      expect(result.message).toBe('移动成功');
    });

    it('rejects moving node to itself', async () => {
      mockNodeOwned(makeNode({ id: 'same' }));
      await expect(
        service.move('u-1', 'same', 'same'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects moving to a non-folder target', async () => {
      mockNodeOwned(makeNode({ id: 'src' }));
      nodeRepo.findOne
        .mockResolvedValueOnce(makeNode({ id: 'src' }))
        .mockResolvedValueOnce(makeNode({ id: 'dest', type: NodeType.FILE }));
      await expect(
        service.move('u-1', 'src', 'dest'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException on concurrent modification', async () => {
      const src = makeNode({ id: 'src', parentId: 'old-parent' });
      nodeRepo.findOne
        .mockResolvedValueOnce(src)
        .mockResolvedValueOnce(makeNode({ id: 'dest', type: NodeType.FOLDER }))
        .mockResolvedValueOnce(null); // checkDuplicate
      nodeRepo.count.mockResolvedValue(0);
      nodeRepo.find.mockResolvedValue([]); // isDescendant
      nodeRepo.update.mockResolvedValue({ affected: 0 }); // atomic update fails

      await expect(
        service.move('u-1', 'src', 'dest'),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // softDelete
  // ═══════════════════════════════════════════════════════════════════════════
  describe('softDelete', () => {
    it('soft-deletes a file', async () => {
      const file = makeNode({ id: 'f-1', name: 'doc.txt' });
      nodeRepo.find.mockResolvedValueOnce([file]);       // find nodes
      // collectDescendantIds: root
      nodeRepo.find.mockResolvedValueOnce([]);           // no children
      nodeRepo.update.mockResolvedValue({ affected: 1 });

      const result = await service.softDelete('u-1', ['f-1']);
      expect(result.message).toContain('已移入回收站');
    });

    it('throws NotFoundException when no nodes found', async () => {
      nodeRepo.find.mockResolvedValue([]);
      await expect(
        service.softDelete('u-1', ['ghost-id']),
      ).rejects.toThrow(NotFoundException);
    });

    it('cascades delete to child nodes', async () => {
      const folder = makeNode({ id: 'folder-1', type: NodeType.FOLDER });
      const child = makeNode({ id: 'child-1', parentId: 'folder-1' });
      nodeRepo.find
        .mockResolvedValueOnce([folder])                 // find root nodes
        .mockResolvedValueOnce([child])                  // find children of folder
        .mockResolvedValueOnce([]);                      // no grandchildren
      nodeRepo.update.mockResolvedValue({ affected: 1 });

      await service.softDelete('u-1', ['folder-1']);
      // update should be called with both folder + child ids
      expect(nodeRepo.update).toHaveBeenCalled();
      const callArgs = nodeRepo.update.mock.calls[0][0];
      expect(callArgs.id._value).toContain('folder-1');
      expect(callArgs.id._value).toContain('child-1');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // listTrash
  // ═══════════════════════════════════════════════════════════════════════════
  describe('listTrash', () => {
    it('returns trashed items', async () => {
      nodeRepo.find.mockResolvedValue([
        makeNode({ id: 't-1', deletedAt: new Date(), name: 'deleted.txt' }),
      ]);
      const result = await service.listTrash('u-1');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('deleted.txt');
    });

    it('returns empty when no trashed items', async () => {
      nodeRepo.find.mockResolvedValue([]);
      const result = await service.listTrash('u-1');
      expect(result).toEqual([]);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // restoreTrash
  // ═══════════════════════════════════════════════════════════════════════════
  describe('restoreTrash', () => {
    it('restores items from trash', async () => {
      nodeRepo.find.mockResolvedValue([]); // collectDescendantIds: no children
      nodeRepo.findOne.mockResolvedValue(null); // resolveNameConflict: no dup
      nodeRepo.update.mockResolvedValue({ affected: 1 });

      const result = await service.restoreTrash('u-1', ['t-1']);
      expect(result.message).toBe('恢复成功');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // toggleStar
  // ═══════════════════════════════════════════════════════════════════════════
  describe('toggleStar', () => {
    it('stars an unstarred file', async () => {
      mockNodeOwned(makeNode({ isStarred: false }));
      const result = await service.toggleStar('u-1', 'node-1');
      expect(result.isStarred).toBe(true);
      expect(nodeRepo.update).toHaveBeenCalledWith('node-1', { isStarred: true });
    });

    it('unstars a starred file', async () => {
      mockNodeOwned(makeNode({ isStarred: true }));
      const result = await service.toggleStar('u-1', 'node-1');
      expect(result.isStarred).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // listRecent
  // ═══════════════════════════════════════════════════════════════════════════
  describe('listRecent', () => {
    it('returns recent files', async () => {
      nodeRepo.find.mockResolvedValue([
        makeNode({ id: 'r-1', name: 'recent.pdf' }),
      ]);
      const result = await service.listRecent('u-1', 10);
      expect(result).toHaveLength(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // listStarred
  // ═══════════════════════════════════════════════════════════════════════════
  describe('listStarred', () => {
    it('returns starred items', async () => {
      nodeRepo.find.mockResolvedValue([
        makeNode({ id: 's-1', isStarred: true, name: 'starred.png' }),
      ]);
      const result = await service.listStarred('u-1');
      expect(result).toHaveLength(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // setLock
  // ═══════════════════════════════════════════════════════════════════════════
  describe('setLock', () => {
    it('sets lock on a file', async () => {
      mockNodeOwned(makeNode());
      const result = await service.setLock('u-1', 'node-1', 'MyPass123');
      expect(result.message).toBe('已设置密码保护');
      expect(hashPassword).toHaveBeenCalledWith('MyPass123');
    });

    it('throws when password is empty', async () => {
      await expect(service.setLock('u-1', 'node-1', '')).rejects.toThrow(BadRequestException);
    });

    it('throws when password is too short', async () => {
      await expect(service.setLock('u-1', 'node-1', 'Ab1')).rejects.toThrow(BadRequestException);
    });

    it('throws when password is not a string', async () => {
      await expect(service.setLock('u-1', 'node-1', null as any)).rejects.toThrow(BadRequestException);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // removeLock
  // ═══════════════════════════════════════════════════════════════════════════
  describe('removeLock', () => {
    it('removes lock with correct password', async () => {
      mockNodeOwned(makeNode({ isLocked: true, lockHash: '$2b$12$hash' }));
      (comparePassword as jest.Mock).mockResolvedValue(true);
      const result = await service.removeLock('u-1', 'node-1', 'MyPass123');
      expect(result.message).toBe('已取消密码保护');
    });

    it('throws when file is not locked', async () => {
      mockNodeOwned(makeNode({ isLocked: false }));
      await expect(
        service.removeLock('u-1', 'node-1', 'any'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // verifyLock
  // ═══════════════════════════════════════════════════════════════════════════
  describe('verifyLock', () => {
    it('returns valid when not locked', async () => {
      mockNodeOwned(makeNode({ isLocked: false }));
      const result = await service.verifyLock('u-1', 'node-1', '');
      expect(result.valid).toBe(true);
    });

    it('returns valid with correct password', async () => {
      mockNodeOwned(makeNode({ isLocked: true, lockHash: 'hash' }));
      (comparePassword as jest.Mock).mockResolvedValue(true);
      const result = await service.verifyLock('u-1', 'node-1', 'MyPass123');
      expect(result.valid).toBe(true);
    });

    it('throws on wrong password', async () => {
      mockNodeOwned(makeNode({ isLocked: true, lockHash: 'hash' }));
      (comparePassword as jest.Mock).mockResolvedValue(false);
      mockRedis.incr.mockResolvedValue(1);
      await expect(
        service.verifyLock('u-1', 'node-1', 'Wrong'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // setNote
  // ═══════════════════════════════════════════════════════════════════════════
  describe('setNote', () => {
    it('sets note on a node', async () => {
      mockNodeOwned(makeNode());
      const result = await service.setNote('u-1', 'node-1', 'my note text');
      expect(result.note).toBe('my note text');
      expect(nodeRepo.update).toHaveBeenCalledWith('node-1', { note: 'my note text' });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // moveToPrivate
  // ═══════════════════════════════════════════════════════════════════════════
  describe('moveToPrivate', () => {
    it('moves files to private space', async () => {
      nodeRepo.update.mockResolvedValue({ affected: 2 });
      const result = await service.moveToPrivate('u-1', ['n1', 'n2'], true);
      expect(result.message).toBe('已移入隐私空间');
      expect(nodeRepo.update).toHaveBeenCalledWith(
        { id: expect.any(Object), userId: 'u-1' },
        { isPrivate: true },
      );
    });

    it('moves files out of private space', async () => {
      const result = await service.moveToPrivate('u-1', ['n1'], false);
      expect(result.message).toBe('已移出隐私空间');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // getPath (breadcrumbs)
  // ═══════════════════════════════════════════════════════════════════════════
  describe('getPath', () => {
    it('returns breadcrumb path', async () => {
      const child = makeNode({ id: 'child', parentId: 'parent', name: 'file.txt' });
      const parent = makeNode({ id: 'parent', parentId: null, name: 'Root', type: NodeType.FOLDER });
      nodeRepo.findOne
        .mockResolvedValueOnce(child)   // initial lookup
        .mockResolvedValueOnce(parent); // parent lookup
      const result = await service.getPath('u-1', 'child');
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('Root');
      expect(result[1].name).toBe('file.txt');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // permanentDelete
  // ═══════════════════════════════════════════════════════════════════════════
  describe('permanentDelete', () => {
    it('permanently deletes files', async () => {
      nodeRepo.find.mockResolvedValue([makeNode({ id: 'd-1' })]);
      nodeRepo.find.mockResolvedValue([]); // collectDescendantNodes: no children
      chunkRepo.delete = jest.fn().mockResolvedValue({ affected: 1 });
      keyRepo.delete = jest.fn().mockResolvedValue({ affected: 1 });

      const result = await service.permanentDelete('u-1', ['d-1']);
      expect(result.message).toContain('永久删除成功');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // listTags
  // ═══════════════════════════════════════════════════════════════════════════
  describe('listTags', () => {
    it('returns user tags', async () => {
      tagRepo.find.mockResolvedValue([{ id: 't-1', name: 'important', color: '#f00' }]);
      const result = await service.listTags('u-1');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('important');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // getSyncDiff (existing + extended)
  // ═══════════════════════════════════════════════════════════════════════════
  describe('getSyncDiff', () => {
    const oldDate = new Date('2024-01-01').toISOString();
    const recentDate = new Date(Date.now() + 86400000).toISOString();

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

    it('returns empty for future date', async () => {
      nodeRepo.find.mockResolvedValue([]);
      const deleteQb = mockQb();
      deleteQb.getMany.mockResolvedValue([]);
      nodeRepo.createQueryBuilder = jest.fn().mockReturnValue(deleteQb);
      const result = await service.getSyncDiff('user-1', recentDate);
      expect(result.total).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // search (existing + extended)
  // ═══════════════════════════════════════════════════════════════════════════
  describe('search', () => {
    it('sanitizes special characters', async () => {
      const qb = mockQb();
      nodeRepo.createQueryBuilder = jest.fn().mockReturnValue(qb);

      const result = await service.search('user-1', 'test!@#$');
      expect(Array.isArray(result)).toBe(true);
    });

    it('returns matching nodes', async () => {
      const node = makeNode({ name: 'report.pdf' });
      const qb = mockQb();
      qb.getMany.mockResolvedValue([node]);
      nodeRepo.createQueryBuilder = jest.fn().mockReturnValue(qb);

      const result = await service.search('user-1', 'report');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('report.pdf');
    });
  });
});
