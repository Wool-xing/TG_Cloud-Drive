import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as dotenv from 'dotenv'; dotenv.config();
import { Repository, DataSource } from 'typeorm';

import { FilesService } from '../files/files.service';
import { AdminService } from '../admin/admin.service';
import { SharesService } from '../shares/shares.service';
import { UsersService } from '../users/users.service';
import { WebdavService } from '../webdav/webdav.service';

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
import { StorageService } from '../storage/storage.service';
import { EmbeddingService } from '../files/embedding.service';
import { OcrService } from '../ocr/ocr.service';
import { MailService } from '../mail/mail.service';
import { VerificationService } from '../verification/verification.service';

const dbUrl = process.env.DATABASE_URL || 'postgresql://tgpan:tgpan_pass@localhost:5432/tgpan';
const E = [Node, FileChunk, NodeKey, NodeVersion, FileRequest, Tag, NoteTemplate, User, AuditLog, Device, Share, Subscription, VerificationCode];

jest.mock('../common/encryption', () => ({
  ...jest.requireActual('../common/encryption'),
  comparePassword: jest.fn().mockResolvedValue(true),
  hashPassword: jest.fn().mockResolvedValue('$2b$12$hash'),
  encryptField: jest.fn((v: string) => `enc:${v}`),
  decryptField: jest.fn((v: string) => v.startsWith('enc:') ? v.slice(4) : v),
  hashIdentifier: jest.fn((v: string) => `h:${v}`),
  normalizeEmail: jest.fn((e: string) => e), normalizePhone: jest.fn((p: string) => p),
  generateSalt: jest.fn(() => 's'.repeat(64)), generateSecureToken: jest.fn(() => 'tok'),
}));

const mr = { get: jest.fn().mockResolvedValue(null), set: jest.fn(), del: jest.fn(), incr: jest.fn().mockResolvedValue(0), expire: jest.fn() };
const mStorage = { getPrimary: () => 'telegram', upload: async () => ({ providerKey: 'k', etag: 'e' }), getUrl: async () => 'http://l/file', buildR2Key: () => 'k', delete: async () => {} };
const mConfig = { get: (k: string) => k === 'ENCRYPTION_MASTER_KEY' ? 'k'.repeat(64) : k === 'APP_URL' ? 'https://tg.test' : 'test' };

describe('AllServices (BATCH REAL DB)', () => {
  const P = `bat${Date.now() % 100000}_`;
  let files: FilesService, admin: AdminService, shares: SharesService, users: UsersService, webdav: WebdavService;
  let nodeRepo: Repository<Node>, userRepo: Repository<User>, dataSource: DataSource;
  let uid: string;

  beforeAll(async () => {
    const m: TestingModule = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({ type: 'postgres', url: dbUrl, entities: E, synchronize: false, ssl: false, logging: false }),
        TypeOrmModule.forFeature(E), JwtModule.register({ secret: 'test' }),
      ],
      providers: [
        FilesService, AdminService, SharesService, UsersService, WebdavService,
        { provide: REDIS_CLIENT, useValue: mr },
        { provide: StorageService, useValue: mStorage },
        { provide: EmbeddingService, useValue: { enabled: false } },
        { provide: OcrService, useValue: { isSupported: () => false } },
        { provide: ConfigService, useValue: mConfig },
        { provide: MailService, useValue: {} },
        { provide: VerificationService, useValue: { verify: async () => {} } },
      ],
    }).compile();

    files = m.get<FilesService>(FilesService);
    admin = m.get<AdminService>(AdminService);
    shares = m.get<SharesService>(SharesService);
    users = m.get<UsersService>(UsersService);
    webdav = m.get<WebdavService>(WebdavService);
    nodeRepo = m.get<Repository<Node>>(getRepositoryToken(Node));
    userRepo = m.get<Repository<User>>(getRepositoryToken(User));
    dataSource = m.get<DataSource>(DataSource);

    const u = userRepo.create({ username: `${P}u`, passwordHash: 'x', role: UserRole.USER, status: UserStatus.ACTIVE, quotaBytes: 10*1024**3, mekSalt: 's' });
    await userRepo.save(u); uid = u.id;
  }, 30000);

  afterAll(async () => {
    if (uid) { await nodeRepo.delete({ userId: uid }); await userRepo.delete({ id: uid }); }
    if (dataSource?.isInitialized) await dataSource.destroy();
  }, 15000);

  // ── FilesService ──────────────────────────────────────────────────
  it('F1 createFolder', async () => { expect((await files.createFolder(uid, `${P}f`, null, false)).type).toBe(NodeType.FOLDER); });
  it('F2 createDocument', async () => { expect((await files.createDocument(uid, `${P}d.md`, null, 'text/markdown', '# H')).type).toBe(NodeType.FILE); });
  it('F3 list', async () => { expect((await files.list(uid, null, false, 'createdAt', 'DESC')).length).toBeGreaterThanOrEqual(2); });
  it('F4 search', async () => { expect((await files.search(uid, P)).length).toBeGreaterThanOrEqual(1); });
  it('F5 rename', async () => { const d = await files.createDocument(uid, `${P}rn.md`, null, 'text/plain', ''); expect((await files.rename(uid, d.id, `${P}new.md`)).name).toBe(`${P}new.md`); });
  it('F6 setNote', async () => { const d = await files.createDocument(uid, `${P}sn.md`, null, 'text/plain', ''); expect((await files.setNote(uid, d.id, 'note')).note).toBe('note'); });
  it('F7 toggleStar', async () => { const d = await files.createDocument(uid, `${P}st.md`, null, 'text/plain', ''); await files.toggleStar(uid, d.id); expect((await files.toggleStar(uid, d.id)).isStarred).toBe(false); });
  it('F8 createTag+list+delete', async () => { const t = await files.createTag(uid, `${P}t`, '#000'); await files.deleteTag(uid, t.id); });
  it('F9 listRecent', async () => { expect(Array.isArray(await files.listRecent(uid))).toBe(true); });
  it('F10 listStarred', async () => { expect(Array.isArray(await files.listStarred(uid))).toBe(true); });
  it('F11 getPath', async () => { const d = await files.createDocument(uid, `${P}p.md`, null, 'text/plain', ''); expect(Array.isArray(await files.getPath(uid, d.id))).toBe(true); });
  it('F12 trash cycle', async () => { const d = await files.createDocument(uid, `${P}td.md`, null, 'text/plain', ''); await files.softDelete(uid, [d.id]); expect(Array.isArray(await files.listTrash(uid))).toBe(true); await files.restoreTrash(uid, [d.id]); await files.softDelete(uid, [d.id]); await files.permanentDelete(uid, [d.id]); });
  it('F13 getThumbnailUrl', async () => { const d = await files.createDocument(uid, `${P}th.md`, null, 'text/plain', ''); expect(await files.getThumbnailUrl(uid, d.id)).toBeNull(); });
  it('F14 setLock', async () => { const d = await files.createDocument(uid, `${P}lk.md`, null, 'text/plain', ''); expect(await files.setLock(uid, d.id, 'L1!')).toHaveProperty('message'); });
  it('F15 verifyLock', async () => { const d = await files.createDocument(uid, `${P}vl.md`, null, 'text/plain', ''); await files.setLock(uid, d.id, 'Rm1!'); expect((await files.verifyLock(uid, d.id, 'Rm1!')).valid).toBe(true); await files.removeLock(uid, d.id, 'Rm1!'); });
  it('F16 createVersion', async () => { const d = await files.createDocument(uid, `${P}vr.md`, null, 'text/plain', ''); expect((await files.createVersion(uid, d.id))).toHaveProperty('id'); });
  it('F17 getSyncDiff', async () => { expect((await files.getSyncDiff(uid, '2020-01-01T00:00:00.000Z'))).toHaveProperty('created'); });
  it('F18 moveToPrivate', async () => { const d = await files.createDocument(uid, `${P}mp.md`, null, 'text/plain', ''); expect(await files.moveToPrivate(uid, [d.id], true)).toHaveProperty('moved'); });
  it('F19 getFileRequest', async () => { const f = await files.createFolder(uid, `${P}fr`, null, false); const fr = await files.createFileRequest(uid, f.id, 5, 24); expect((await files.getFileRequest(fr.token)).maxFiles).toBe(5); });
  it('F20 addTagToNode', async () => { const d = await files.createDocument(uid, `${P}tag.md`, null, 'text/plain', ''); const t = await files.createTag(uid, `${P}at`, '#f00'); await files.addTagToNode(uid, d.id, t.id); await files.removeTagFromNode(uid, d.id, t.id); await files.deleteTag(uid, t.id); });
  it('F21 copy', async () => { const d = await files.createDocument(uid, `${P}cp.md`, null, 'text/plain', ''); const f = await files.createFolder(uid, `${P}cpt`, null, false); expect((await files.copy(uid, d.id, f.id))).toHaveProperty('id'); });
  it('F22 updateFileContent', async () => { const d = await files.createDocument(uid, `${P}uc.md`, null, 'text/plain', ''); await files.updateFileContent(uid, d.id, Buffer.from('# new'), '0'.repeat(24), 5, 'text/plain'); });
  it('F23 getDownloadInfo', async () => { const d = await files.createDocument(uid, `${P}di.md`, null, 'text/plain', ''); expect((await files.getDownloadInfo(uid, d.id))).toHaveProperty('node'); });
  it('F24 getFolderDownloadList', async () => { const f = await files.createFolder(uid, `${P}dlf`, null, false); expect((await files.getFolderDownloadList(uid, f.id))).toHaveProperty('files'); });
  it('F25 createFolder private', async () => { expect((await files.createFolder(uid, `${P}priv`, null, true)).isPrivate).toBe(true); });
  it('F26 duplicate rejected', async () => { const n = `${P}dup`; await files.createFolder(uid, n, null, false); await expect(files.createFolder(uid, n, null, false)).rejects.toThrow(); });
  it('F27 search empty', async () => { expect(Array.isArray(await files.search(uid, ''))).toBe(true); });
  it('F28 createDocument empty', async () => { expect((await files.createDocument(uid, `${P}em.md`, null, 'text/plain')).type).toBe(NodeType.FILE); });

  // ── AdminService ──────────────────────────────────────────────────
  it('A1 listUsers', async () => { expect((await admin.listUsers(1, 10, ''))).toHaveProperty('users'); });
  it('A2 getSystemConfig', async () => { expect(await admin.getSystemConfig()).toBeDefined(); });
  it('A3 getAuditLogs', async () => { expect((await admin.getAuditLogs(1, 10, '', ''))).toHaveProperty('items'); });

  // ── SharesService ─────────────────────────────────────────────────
  let shareNodeId: string;
  it('S1 createShare', async () => {
    const n = nodeRepo.create({ userId: uid, name: `${P}shf.txt`, type: NodeType.FILE, isPrivate: false });
    await nodeRepo.save(n); shareNodeId = n.id;
    expect((await shares.createShare(uid, { nodeId: shareNodeId }))).toHaveProperty('token');
  });
  it('S2 listMyShares', async () => { expect((await shares.listMyShares(uid)).length).toBeGreaterThanOrEqual(1); });

  // ── UsersService ──────────────────────────────────────────────────
  it('U1 getProfile', async () => { expect((await users.getProfile(uid)).username).toBe(`${P}u`); });
  it('U2 getUserStats', async () => { expect(await users.getUserStats(uid)).toHaveProperty('quotaBytes'); });
  it('U3 getDevices', async () => { expect(Array.isArray(await users.getDevices(uid))).toBe(true); });

  // ── WebdavService ─────────────────────────────────────────────────
  it('W1 resolvePath root', async () => { expect(await (webdav as any).resolvePath(uid, '/')).toBeNull(); });
  it('W2 resolveFile', async () => {
    const n = nodeRepo.create({ userId: uid, name: `${P}wf.txt`, type: NodeType.FILE, isPrivate: false });
    await nodeRepo.save(n);
    expect((await (webdav as any).resolveFile(uid, `${P}wf.txt`)).name).toBe(`${P}wf.txt`);
  });
});
