import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import * as dotenv from 'dotenv'; dotenv.config();
import { PaymentService } from './payment.service';
import { Subscription } from './entities/subscription.entity';
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
import { VerificationCode } from '../verification/verification.entity';
import { REDIS_CLIENT } from '../common/redis/redis.module';
import { Repository, DataSource } from 'typeorm';

const dbUrl = process.env.DATABASE_URL || 'postgresql://tgpan:tgpan_pass@localhost:5432/tgpan';
const E = [Subscription, User, Device, AuditLog, Node, FileChunk, NodeKey, NodeVersion, FileRequest, Tag, NoteTemplate, Share, VerificationCode];

const mockRedis = { get: jest.fn().mockResolvedValue(null), set: jest.fn(), del: jest.fn() };
const mockConfig = { get: jest.fn((k: string) => k === 'APP_URL' ? 'https://tgpan.test' : k === 'DEFAULT_USER_QUOTA_GB' ? 50 : 'test') };

describe('PaymentService (REAL DB)', () => {
  let service: PaymentService;
  let userRepo: Repository<User>;
  let subRepo: Repository<Subscription>;
  let dataSource: DataSource;
  let userId: string;
  const P = `pay${Date.now() % 100000}_`;

  beforeAll(async () => {
    const m = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({ type: 'postgres', url: dbUrl, entities: E, synchronize: false, ssl: false, logging: false }),
        TypeOrmModule.forFeature(E),
      ],
      providers: [
        PaymentService,
        { provide: REDIS_CLIENT, useValue: mockRedis },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = m.get<PaymentService>(PaymentService);
    userRepo = m.get<Repository<User>>(getRepositoryToken(User));
    subRepo = m.get<Repository<Subscription>>(getRepositoryToken(Subscription));
    dataSource = m.get<DataSource>(DataSource);

    const u = userRepo.create({ username: `${P}u`, passwordHash: 'x', role: UserRole.USER, status: UserStatus.ACTIVE, quotaBytes: 10737418240, mekSalt: 's' });
    await userRepo.save(u); userId = u.id;
  }, 30000);

  afterAll(async () => {
    if (userId) { await subRepo.delete({ userId }); await userRepo.delete({ id: userId }); }
    if (dataSource?.isInitialized) await dataSource.destroy();
  }, 15000);

  it('getSubscription returns free tier', async () => {
    const r = await service.getSubscription(userId);
    expect(r.plan).toBe('free');
    expect(r.status).toBe('active');
  });

  it('getSubscription returns created subscription', async () => {
    const sub = subRepo.create({ userId, plan: 'pro', status: 'active', stripeCustomerId: 'cus_test', stripeSubscriptionId: 'sub_test' });
    await subRepo.save(sub);
    const r = await service.getSubscription(userId);
    expect(r.plan).toBe('pro');
  });

  it('handleWebhook with signature', async () => {
    const r = await service.handleWebhook(Buffer.from('{}'), 'sig_test');
    expect(r).toHaveProperty('received', true);
  });

  it('createPortalSession throws without billing', async () => {
    await expect(service.createPortalSession(userId)).rejects.toThrow();
  });
});
