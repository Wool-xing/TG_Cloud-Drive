import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as dotenv from 'dotenv'; dotenv.config();
import { CollaborationService } from './collaboration.service';
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
import { REDIS_CLIENT } from '../common/redis/redis.module';
import { Repository, DataSource } from 'typeorm';

const dbUrl = process.env.DATABASE_URL || 'postgresql://tgpan:tgpan_pass@localhost:5432/tgpan';
const E = [Node, FileChunk, NodeKey, NodeVersion, FileRequest, Tag, NoteTemplate, User, AuditLog, Device, Share, Subscription, VerificationCode];
const mockRedis = { get: jest.fn().mockResolvedValue(null), set: jest.fn(), del: jest.fn(), incr: jest.fn().mockResolvedValue(0), expire: jest.fn() };

describe('CollaborationService (REAL DB)', () => {
  let service: CollaborationService;
  let nodeRepo: Repository<Node>;
  let userRepo: Repository<User>;
  let dataSource: DataSource;
  let userId: string;
  let nodeId: string;
  const P = `col${Date.now() % 100000}_`;

  beforeAll(async () => {
    const m = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({ type: 'postgres', url: dbUrl, entities: E, synchronize: false, ssl: false, logging: false }),
        TypeOrmModule.forFeature(E),
        JwtModule.register({ secret: 'test' }),
      ],
      providers: [
        CollaborationService,
        { provide: REDIS_CLIENT, useValue: mockRedis },
        { provide: ConfigService, useValue: { get: () => 'test' } },
      ],
    }).compile();
    service = m.get<CollaborationService>(CollaborationService);
    nodeRepo = m.get<Repository<Node>>(getRepositoryToken(Node));
    userRepo = m.get<Repository<User>>(getRepositoryToken(User));
    dataSource = m.get<DataSource>(DataSource);

    const u = userRepo.create({ username: `${P}u`, passwordHash: 'x', role: UserRole.USER, status: UserStatus.ACTIVE, quotaBytes: 10737418240, mekSalt: 's' });
    await userRepo.save(u); userId = u.id;
    const n = nodeRepo.create({ userId, name: `${P}f.md`, type: NodeType.FILE, isPrivate: false });
    await nodeRepo.save(n); nodeId = n.id;
  }, 30000);

  afterAll(async () => {
    if (userId) { await nodeRepo.delete({ userId }); await userRepo.delete({ id: userId }); }
    if (dataSource?.isInitialized) await dataSource.destroy();
  }, 15000);

  it('canAccessDoc owner', async () => {
    expect(await service.canAccessDoc(userId, nodeId)).toBe(true);
  });

  it('canAccessDoc non-owner', async () => {
    expect(await service.canAccessDoc('00000000-0000-0000-0000-000000000999', nodeId)).toBe(false);
  });

  it('getDocumentInfo', async () => {
    const r = await service.getDocumentInfo(nodeId);
    expect(r.name).toBe(`${P}f.md`);
  });

  it('getCollaborators returns count', async () => {
    const r = await service.getCollaborators(nodeId);
    expect(typeof r).toBe('number');
  });

  it('verifyToken with valid JWT', async () => {
    const jwtService = new (require('@nestjs/jwt').JwtService)({ secret: 'test' });
    const token = jwtService.sign({ sub: userId });
    const r = await service.verifyToken(token);
    expect(r).toBeDefined();
    expect(r.userId).toBe(userId);
  });

  it('verifyToken returns null for invalid JWT', async () => {
    const r = await service.verifyToken('invalid.token.here');
    expect(r).toBeNull();
  });

  it('verifyToken returns null for expired JWT', async () => {
    const jwtService = new (require('@nestjs/jwt').JwtService)({ secret: 'test' });
    const token = jwtService.sign({ sub: userId }, { expiresIn: '1ms' });
    await new Promise(r => setTimeout(r, 10));
    const r = await service.verifyToken(token);
    expect(r).toBeNull();
  });

  it('getDocumentInfo returns document metadata', async () => {
    const n = nodeRepo.create({ userId, name: `${P}col.md`, type: NodeType.FILE, isPrivate: false });
    await nodeRepo.save(n);
    const r = await service.getDocumentInfo(n.id);
    expect(r.name).toBe(`${P}col.md`);
  });

  it('getDocumentInfo throws for non-existent', async () => {
    await expect(service.getDocumentInfo('00000000-0000-0000-0000-000000000000')).rejects.toThrow();
  });

  it('getCollaborators returns count (no peers)', async () => {
    const r = await service.getCollaborators(nodeId);
    expect(typeof r).toBe('number');
  });

  it('canAccessDoc denies non-owner', async () => {
    const otherId = '00000000-0000-0000-0000-000000000999';
    expect(await service.canAccessDoc(otherId, nodeId)).toBe(false);
  });
});
