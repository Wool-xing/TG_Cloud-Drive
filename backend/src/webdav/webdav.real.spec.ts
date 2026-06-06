import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as dotenv from 'dotenv'; dotenv.config();
import { WebdavService } from './webdav.service';
import { Node, NodeType } from '../files/entities/node.entity';
import { FileChunk } from '../files/entities/file-chunk.entity';
import { NodeKey } from '../files/entities/node-key.entity';
import { NodeVersion } from '../files/entities/node-version.entity';
import { FileRequest } from '../files/entities/file-request.entity';
import { Tag } from '../files/entities/tag.entity';
import { NoteTemplate } from '../files/entities/note-template.entity';
import { User, UserRole, UserStatus } from '../users/entities/user.entity';
import { AuditLog } from '../users/entities/audit-log.entity';
import { Device } from '../users/entities/device.entity';
import { Share } from '../shares/entities/share.entity';
import { Subscription } from '../payment/entities/subscription.entity';
import { VerificationCode } from '../verification/verification.entity';
import { StorageService } from '../storage/storage.service';
import { Repository, DataSource } from 'typeorm';
import { Request, Response } from 'express';

const dbUrl = process.env.DATABASE_URL || 'postgresql://tgpan:tgpan_pass@localhost:5432/tgpan';
const E = [Node, FileChunk, NodeKey, NodeVersion, FileRequest, Tag, NoteTemplate, User, AuditLog, Device, Share, Subscription, VerificationCode];

const mockStorage = { getPrimary: jest.fn().mockReturnValue('telegram'), getUrl: jest.fn(), upload: jest.fn().mockResolvedValue({ providerKey: 'k' }), buildR2Key: jest.fn(), delete: jest.fn() };

describe('WebdavService (REAL DB)', () => {
  let service: WebdavService;
  let nodeRepo: Repository<Node>;
  let userRepo: Repository<User>;
  let dataSource: DataSource;
  let userId: string;
  const P = `dav${Date.now() % 100000}_`;

  beforeAll(async () => {
    const m = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({ type: 'postgres', url: dbUrl, entities: E, synchronize: false, ssl: false, logging: false }),
        TypeOrmModule.forFeature(E),
        JwtModule.register({ secret: 'test' }),
      ],
      providers: [
        WebdavService,
        { provide: StorageService, useValue: mockStorage },
        { provide: ConfigService, useValue: { get: () => 'test' } },
      ],
    }).compile();

    service = m.get<WebdavService>(WebdavService);
    nodeRepo = m.get<Repository<Node>>(getRepositoryToken(Node));
    userRepo = m.get<Repository<User>>(getRepositoryToken(User));
    dataSource = m.get<DataSource>(DataSource);

    const u = userRepo.create({ username: `${P}u`, passwordHash: '$2b$12$hash', role: UserRole.USER, status: UserStatus.ACTIVE, quotaBytes: 10737418240, mekSalt: 's' });
    await userRepo.save(u); userId = u.id;
  }, 30000);

  afterAll(async () => {
    if (userId) { await nodeRepo.delete({ userId }); await userRepo.delete({ id: userId }); }
    if (dataSource?.isInitialized) await dataSource.destroy();
  }, 15000);

  // ── resolvePath ────────────────────────────────────────────────────

  it('resolvePath root', async () => {
    expect(await (service as any).resolvePath(userId, '/')).toBeNull();
  });

  it('resolvePath empty', async () => {
    expect(await (service as any).resolvePath(userId, '')).toBeNull();
  });

  it('resolvePath nested', async () => {
    const folder = nodeRepo.create({ userId, name: `${P}d1`, type: NodeType.FOLDER, isPrivate: false });
    await nodeRepo.save(folder);
    const sub = nodeRepo.create({ userId, parentId: folder.id, name: `${P}d2`, type: NodeType.FOLDER, isPrivate: false });
    await nodeRepo.save(sub);
    const result = await (service as any).resolvePath(userId, `${P}d1/${P}d2`);
    expect(result).toBeDefined();
    expect(result.name).toBe(`${P}d2`);
  });

  // ── resolveFile ────────────────────────────────────────────────────

  it('resolveFile', async () => {
    const file = nodeRepo.create({ userId, name: `${P}f.txt`, type: NodeType.FILE, isPrivate: false });
    await nodeRepo.save(file);
    const result = await (service as any).resolveFile(userId, `${P}f.txt`);
    expect(result.name).toBe(`${P}f.txt`);
  });

  // ── isDescendant ───────────────────────────────────────────────────

  it('isDescendant true', async () => {
    const child = nodeRepo.create({ userId, parentId: 'parent-id', name: 'c', type: NodeType.FILE, isPrivate: false });
    await nodeRepo.save(child);
    expect(await (service as any).isDescendant(userId, 'parent-id', child.id)).toBe(true);
  });

  it('isDescendant false', async () => {
    const node = nodeRepo.create({ userId, name: 'x', type: NodeType.FILE, isPrivate: false });
    await nodeRepo.save(node);
    expect(await (service as any).isDescendant(userId, 'other-id', node.id)).toBe(false);
  });

  // ── options ────────────────────────────────────────────────────────

  it('options returns DAV headers', () => {
    const res = { set: jest.fn(), status: jest.fn().mockReturnValue({ send: jest.fn() }) } as any;
    (service as any).options({} as Request, res);
    expect(res.set).toHaveBeenCalledWith('Allow', expect.stringContaining('PROPFIND'));
  });

  // ── encodePath ─────────────────────────────────────────────────────

  it('encodePath', () => {
    const result = (service as any).encodePath('/base', 'file.txt', false);
    expect(result).toContain('file.txt');
  });
});
