import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as dotenv from 'dotenv'; dotenv.config();
import { UsersService } from './users.service';
import { User, UserRole, UserStatus } from './entities/user.entity';
import { Device } from './entities/device.entity';
import { AuditLog } from './entities/audit-log.entity';
import { Node, NodeType } from '../files/entities/node.entity';
import { FileChunk } from '../files/entities/file-chunk.entity';
import { NodeKey } from '../files/entities/node-key.entity';
import { NodeVersion } from '../files/entities/node-version.entity';
import { FileRequest } from '../files/entities/file-request.entity';
import { Tag } from '../files/entities/tag.entity';
import { NoteTemplate } from '../files/entities/note-template.entity';
import { Share } from '../shares/entities/share.entity';
import { Subscription } from '../payment/entities/subscription.entity';
import { VerificationCode } from '../verification/verification.entity';
import { VerificationService } from '../verification/verification.service';
import { REDIS_CLIENT } from '../common/redis/redis.module';
import { Repository, DataSource } from 'typeorm';

const dbUrl = process.env.DATABASE_URL || 'postgresql://tgpan:tgpan_pass@localhost:5432/tgpan';
const E = [User, Device, AuditLog, Node, FileChunk, NodeKey, NodeVersion, FileRequest, Tag, NoteTemplate, Share, Subscription, VerificationCode];

jest.mock('../common/encryption', () => ({
  ...jest.requireActual('../common/encryption'),
  comparePassword: jest.fn().mockResolvedValue(true),
  hashPassword: jest.fn().mockResolvedValue('$2b$12$hash'),
  encryptField: jest.fn((v: string) => `enc:${v}`),
  decryptField: jest.fn((v: string) => v.startsWith('enc:') ? v.slice(4) : v),
  hashIdentifier: jest.fn((v: string) => `h:${v}`),
  normalizeEmail: jest.fn((e: string) => e),
  normalizePhone: jest.fn((p: string) => p),
}));

const mockRedis = { get: jest.fn().mockResolvedValue(null), set: jest.fn(), del: jest.fn(), incr: jest.fn().mockResolvedValue(0), expire: jest.fn() };
const mockConfig = { get: jest.fn((k: string) => k === 'ENCRYPTION_MASTER_KEY' ? 'k'.repeat(64) : 'test') };
const mockVerification = { verify: jest.fn(), sendCode: jest.fn() };

describe('UsersService (REAL DB)', () => {
  let service: UsersService;
  let userRepo: Repository<User>;
  let deviceRepo: Repository<Device>;
  let dataSource: DataSource;
  let userId: string;
  const P = `usr${Date.now() % 100000}_`;

  beforeAll(async () => {
    const m = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({ type: 'postgres', url: dbUrl, entities: E, synchronize: false, ssl: false, logging: false }),
        TypeOrmModule.forFeature(E),
        JwtModule.register({ secret: 'test' }),
      ],
      providers: [
        UsersService,
        { provide: REDIS_CLIENT, useValue: mockRedis },
        { provide: ConfigService, useValue: mockConfig },
        { provide: VerificationService, useValue: mockVerification },
      ],
    }).compile();

    service = m.get<UsersService>(UsersService);
    userRepo = m.get<Repository<User>>(getRepositoryToken(User));
    deviceRepo = m.get<Repository<Device>>(getRepositoryToken(Device));
    dataSource = m.get<DataSource>(DataSource);

    const u = userRepo.create({ username: `${P}u`, passwordHash: '$2b$12$hash', role: UserRole.USER, status: UserStatus.ACTIVE, quotaBytes: 10737418240, mekSalt: 's' });
    await userRepo.save(u); userId = u.id;
  }, 30000);

  afterAll(async () => {
    if (userId) { await deviceRepo.delete({ userId }); await userRepo.delete({ id: userId }); }
    if (dataSource?.isInitialized) await dataSource.destroy();
  }, 15000);

  it('getProfile', async () => {
    const r = await service.getProfile(userId);
    expect(r.username).toBe(`${P}u`);
  });

  it('updateProfile', async () => {
    const r = await service.updateProfile(userId, { nickname: 'RealTest' });
    expect(r).toHaveProperty('success');
  });

  it('getUserStats', async () => {
    const r = await service.getUserStats(userId);
    expect(r).toHaveProperty('quotaBytes');
    expect(r).toHaveProperty('usedBytes');
  });

  it('getDevices', async () => {
    const r = await service.getDevices(userId);
    expect(Array.isArray(r)).toBe(true);
  });

  it('getAuditLogs', async () => {
    const r = await service.getAuditLogs(userId, 1, 10);
    expect(Array.isArray(r.items)).toBe(true);
  });
});
