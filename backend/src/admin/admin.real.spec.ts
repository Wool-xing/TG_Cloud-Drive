/**
 * REAL database tests for AdminService — TypeORM + Docker Postgres.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import * as dotenv from 'dotenv'; dotenv.config();
import { AdminService } from './admin.service';
import { User, UserRole, UserStatus } from '../users/entities/user.entity';
import { Device } from '../users/entities/device.entity';
import { AuditLog } from '../users/entities/audit-log.entity';
import { Node } from '../files/entities/node.entity';
import { FileChunk } from '../files/entities/file-chunk.entity';
import { NodeKey } from '../files/entities/node-key.entity';
import { NodeVersion } from '../files/entities/node-version.entity';
import { FileRequest } from '../files/entities/file-request.entity';
import { Tag } from '../files/entities/tag.entity';
import { NoteTemplate } from '../files/entities/note-template.entity';
import { Share } from '../shares/entities/share.entity';
import { Subscription } from '../payment/entities/subscription.entity';
import { VerificationCode } from '../verification/verification.entity';
import { REDIS_CLIENT } from '../common/redis/redis.module';
import { MailService } from '../mail/mail.service';
import { Repository, DataSource } from 'typeorm';

const dbUrl = process.env.DATABASE_URL || 'postgresql://tgpan:tgpan_pass@localhost:5432/tgpan';
const ALL_ENTITIES = [User, Device, AuditLog, Node, FileChunk, NodeKey, NodeVersion, FileRequest, Tag, NoteTemplate, Share, Subscription, VerificationCode];

jest.mock('../common/encryption', () => ({
  ...jest.requireActual('../common/encryption'),
  comparePassword: jest.fn().mockResolvedValue(true),
  hashPassword: jest.fn().mockResolvedValue('$2b$12$hash'),
  encryptField: jest.fn((v: string) => `enc:${v}`),
  decryptField: jest.fn((v: string) => v.startsWith('enc:') ? v.slice(4) : v),
  generateSalt: jest.fn(() => 's'.repeat(64)),
  hashIdentifier: jest.fn((v: string) => `h:${v}`),
  normalizeEmail: jest.fn((e: string) => e),
  normalizePhone: jest.fn((p: string) => p),
  generateSecureToken: jest.fn(() => 'tok'),
}));

const mockRedis = { get: jest.fn().mockResolvedValue(null), set: jest.fn(), del: jest.fn(), incr: jest.fn().mockResolvedValue(0), expire: jest.fn() };
const mockMail = { sendVerificationCode: jest.fn(), sendPasswordReset: jest.fn() };
const mockConfig = { get: jest.fn((k: string) => k === 'ENCRYPTION_MASTER_KEY' ? 'k'.repeat(64) : 'test') };

describe('AdminService (REAL DB)', () => {
  let service: AdminService;
  let userRepo: Repository<User>;
  let auditRepo: Repository<AuditLog>;
  let dataSource: DataSource;
  let adminId: string;
  const PREFIX = `adm${Date.now() % 100000}_`;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({ type: 'postgres', url: dbUrl, entities: ALL_ENTITIES, synchronize: false, ssl: false, logging: false }),
        TypeOrmModule.forFeature(ALL_ENTITIES),
      ],
      providers: [
        AdminService,
        { provide: REDIS_CLIENT, useValue: mockRedis },
        { provide: MailService, useValue: mockMail },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get<AdminService>(AdminService);
    userRepo = module.get<Repository<User>>(getRepositoryToken(User));
    auditRepo = module.get<Repository<AuditLog>>(getRepositoryToken(AuditLog));
    dataSource = module.get<DataSource>(DataSource);

    const admin = userRepo.create({ username: `${PREFIX}admin`, passwordHash: '$2b$hash', role: UserRole.ADMIN, status: UserStatus.ACTIVE, quotaBytes: 1099511627776, mekSalt: 's' });
    await userRepo.save(admin);
    adminId = admin.id;
  }, 30000);

  afterAll(async () => {
    if (adminId) {
      await auditRepo.delete({ userId: adminId });
      await userRepo.delete({ id: adminId });
    }
    if (dataSource?.isInitialized) await dataSource.destroy();
  }, 15000);

  it('listUsers returns paginated results', async () => {
    const r = await service.listUsers(1, 10, '');
    expect(r).toHaveProperty('users');
    expect(r).toHaveProperty('total');
    expect(Array.isArray(r.users)).toBe(true);
  });

  it('listUsers with search filter', async () => {
    const r = await service.listUsers(1, 10, PREFIX);
    expect(r.total).toBeGreaterThanOrEqual(1);
  });

  it('getSystemConfig returns config from Redis or defaults', async () => {
    const r = await service.getSystemConfig();
    expect(r).toBeDefined();
  });

  it('getAuditLogs returns paginated logs', async () => {
    const r = await service.getAuditLogs(1, 10, '', '');
    expect(r).toHaveProperty('items');
    expect(Array.isArray(r.items)).toBe(true);
  });

  it('listAllFiles returns admin file browser', async () => {
    const r = await service.listAllFiles(1, 10);
    expect(r).toHaveProperty('items');
  });  // FIXME: needs deeper mock of node repo query
});
