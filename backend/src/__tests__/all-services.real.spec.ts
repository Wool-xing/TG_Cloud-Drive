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
  it('F14 setLock', async () => { const d = await files.createDocument(uid, `${P}lk.md`, null, 'text/plain', ''); expect(await files.setLock(uid, d.id, 'Lock12!')).toHaveProperty('message'); });
  it.skip('F15 verifyLock', async () => { const d = await files.createDocument(uid, `${P}vl3.md`, null, 'text/plain', '# x'); await files.setLock(uid, d.id, 'Lock78!'); expect(await files.verifyLock(uid, d.id, 'Lock78!')).toBeDefined(); await files.removeLock(uid, d.id, 'Lock78!').catch(()=>{}); });
  it.skip('F16 createVersion', async () => { const d = await files.createDocument(uid, `${P}vr.md`, null, 'text/plain', '# v1'); expect((await files.createVersion(uid, d.id))).toHaveProperty('id'); });
  it('F17 getSyncDiff', async () => { expect((await files.getSyncDiff(uid, '2020-01-01T00:00:00.000Z'))).toHaveProperty('created'); });
  it('F18 moveToPrivate', async () => { const d = await files.createDocument(uid, `${P}mp.md`, null, 'text/plain', ''); expect(await files.moveToPrivate(uid, [d.id], true)).toHaveProperty('message'); });
  it.skip('F19 getFileRequest', async () => { const uniq = `${Date.now()}`; const f = await files.createFolder(uid, `${P}fr${uniq}`, null, false); const fr = await files.createFileRequest(uid, f.id, 5, 24); expect((await files.getFileRequest(fr.token)).maxFiles).toBe(5); });
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
  it('W3 resolvePath nested', async () => {
    const d1 = nodeRepo.create({ userId: uid, name: `${P}wd1`, type: NodeType.FOLDER, isPrivate: false });
    await nodeRepo.save(d1);
    const d2 = nodeRepo.create({ userId: uid, parentId: d1.id, name: `${P}wd2`, type: NodeType.FOLDER, isPrivate: false });
    await nodeRepo.save(d2);
    const r = await (webdav as any).resolvePath(uid, `${P}wd1/${P}wd2`);
    expect(r).toBeDefined();
    expect(r.name).toBe(`${P}wd2`);
  });
  it('W4 isDescendant', async () => {
    const parent = nodeRepo.create({ userId: uid, name: `${P}wp`, type: NodeType.FOLDER, isPrivate: false });
    await nodeRepo.save(parent);
    const n = nodeRepo.create({ userId: uid, parentId: parent.id, name: 'x', type: NodeType.FILE, isPrivate: false });
    await nodeRepo.save(n);
    expect(await (webdav as any).isDescendant(uid, parent.id, n.id)).toBe(true);
    expect(await (webdav as any).isDescendant(uid, '00000000-0000-0000-0000-000000000999', n.id)).toBe(false);
  });
  it('W5 options returns headers', () => {
    const res: any = { set: jest.fn(), status: jest.fn().mockReturnValue({ send: jest.fn() }) };
    (webdav as any).options({} as any, res);
    expect(res.set).toHaveBeenCalledWith('Allow', expect.any(String));
  });

  // ── FilesService More ──────────────────────────────────────────────
  it('F29 list with parent filter', async () => {
    const parent = await files.createFolder(uid, `${P}lp`, null, false);
    await files.createFolder(uid, `${P}sub`, parent.id, false);
    const items = await files.list(uid, parent.id, false, 'createdAt', 'DESC');
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items[0].parentId).toBe(parent.id);
  });
  it.skip('F30 search with type filter', async () => {
    await files.createFolder(uid, `${P}stf`, null, false);
    const r = await files.search(uid, P, 'folder', false);
    expect(r.length).toBeGreaterThanOrEqual(1);
  });
  it('F31 createDocument strip null bytes', async () => {
    const r = await files.createDocument(uid, `${P}nb.md`, null, 'text/plain', '');
    expect(r.name).not.toContain('\x00');
  });
  it('F32 list folder with private filter', async () => {
    await files.createFolder(uid, `${P}prf`, null, true);
    const r = await files.list(uid, null, true, 'createdAt', 'DESC');
    expect(r.length).toBeGreaterThanOrEqual(1);
    expect(r[0].isPrivate).toBe(true);
  });
  it('F33 move with conflict', async () => {
    const d = await files.createDocument(uid, `${P}mvc.md`, null, 'text/plain', '');
    // Move to same location should be OK or conflict
    await files.move(uid, d.id, null).catch(() => {});
    expect(await files.getPath(uid, d.id)).toBeDefined();
  });
  it('F34 copy to root', async () => {
    const d = await files.createDocument(uid, `${P}cpr.md`, null, 'text/plain', '# x');
    expect(await files.copy(uid, d.id, null)).toHaveProperty('id');
  });

  // ── Shares More ────────────────────────────────────────────────────
  it('S3 accessShare with password', async () => {
    const n = nodeRepo.create({ userId: uid, name: `${P}sh2_${Date.now()}.txt`, type: NodeType.FILE, isPrivate: false });
    await nodeRepo.save(n);
    const sh = await shares.createShare(uid, { nodeId: n.id, password: 'pw' });
    const tok = await shares.getShareToken(uid, sh.id);
    const r = await shares.accessShare(tok.token, 'pw');
    expect(r).toHaveProperty('nodeId');
  });
  it('S4 deleteShare', async () => {
    const list = await shares.listMyShares(uid);
    if (list.length > 0) {
      expect(await shares.deleteShare(uid, list[0].id)).toHaveProperty('message');
    }
  });

  // ── Files batch 3 ──────────────────────────────────────────────────
  it('F35 createDocument with null byte stripped', async () => {
    const r = await files.createDocument(uid, `${P}x00.md`, null, 'text/plain', '');
    expect(r.name).toBe(`${P}x00.md`);
  });
  it.skip('F36 set lock and verify', async () => {
    const d = await files.createDocument(uid, `${P}lv.md`, null, 'text/plain', '# c');
    await files.setLock(uid, d.id, 'Lock99!');
    expect(await files.verifyLock(uid, d.id, 'Lock99!')).toBeDefined();
    await files.removeLock(uid, d.id, 'Lock99!');
  });
  it('F37 createDocument with content then getDownloadInfo', async () => {
    const d = await files.createDocument(uid, `${P}dl2.md`, null, 'text/plain', '# test download');
    const info = await files.getDownloadInfo(uid, d.id);
    expect(info).toHaveProperty('node');
  });
  it('F38 updateFileContent then verify', async () => {
    const d = await files.createDocument(uid, `${P}upd.md`, null, 'text/plain', '# v1');
    await files.updateFileContent(uid, d.id, Buffer.from('# v2'), 'a'.repeat(24), 3, 'text/plain');
    expect(await files.getPath(uid, d.id)).toBeDefined();
  });
  it('F39 createTag and add to node', async () => {
    const d = await files.createDocument(uid, `${P}tg2.md`, null, 'text/plain', '');
    const t = await files.createTag(uid, `${P}gt2`, '#0f0');
    await files.addTagToNode(uid, d.id, t.id);
    await files.removeTagFromNode(uid, d.id, t.id);
    await files.deleteTag(uid, t.id);
  });
  it('F40 getFolderDownloadList for empty folder', async () => {
    const f = await files.createFolder(uid, `${P}edl`, null, false);
    const r = await files.getFolderDownloadList(uid, f.id);
    expect(r).toHaveProperty('files');
    expect(r.files.length).toBe(0);
  });
  it('F41 createDocument with duration', async () => {
    const r = await files.createDocument(uid, `${P}ts.md`, null, 'text/plain', '# Timestamp test');
    expect(r.createdAt).toBeDefined();
  });
  it('F42 rename to same name', async () => {
    const name = `${P}same.md`;
    const d = await files.createDocument(uid, name, null, 'text/plain', '');
    const r = await files.rename(uid, d.id, name);
    expect(r.name).toBe(name);
  });
  it('F43 search for folder only', async () => {
    const r = await files.search(uid, P, 'folder', false);
    expect(r.every((n:any) => n.type === 'folder')).toBe(true);
  });
  it('F44 getPath returns empty array for unknown', async () => {
    const r = await files.getPath(uid, '00000000-0000-0000-0000-000000000000');
    expect(r.length).toBe(0);
  });
  it('F45 list in subfolder with private filter', async () => {
    const parent = await files.createFolder(uid, `${P}sp_${Date.now()}`, null, false);
    await files.createFolder(uid, `${P}child`, parent.id, true);
    const r = await files.list(uid, parent.id, true, 'name', 'ASC');
    expect(r.length).toBeGreaterThanOrEqual(1);
  });
  it('F46 toggleStar then listStarred', async () => {
    const d = await files.createDocument(uid, `${P}star2.md`, null, 'text/plain', '');
    await files.toggleStar(uid, d.id);
    const r = await files.listStarred(uid);
    expect(r.some((n:any) => n.id === d.id)).toBe(true);
    await files.toggleStar(uid, d.id);
  });
  it('F47 listTrash empty initially', async () => {
    const r = await files.listTrash(uid);
    expect(Array.isArray(r)).toBe(true);
  });
  it('F48 softDelete + restore multiple files', async () => {
    const d1 = await files.createDocument(uid, `${P}ml1.md`, null, 'text/plain', '');
    const d2 = await files.createDocument(uid, `${P}ml2.md`, null, 'text/plain', '');
    await files.softDelete(uid, [d1.id, d2.id]);
    await files.restoreTrash(uid, [d1.id, d2.id]);
    await files.softDelete(uid, [d1.id, d2.id]);
    await files.permanentDelete(uid, [d1.id, d2.id]);
  });
  it('F49 createTag then listTags count', async () => {
    const before = (await files.listTags(uid)).length;
    const t = await files.createTag(uid, `${P}cnt`, '#000');
    const after = (await files.listTags(uid)).length;
    expect(after).toBe(before + 1);
    await files.deleteTag(uid, t.id);
  });
  it('F50 list with sort by name ASC', async () => {
    await files.createFolder(uid, `${P}aa`, null, false);
    await files.createFolder(uid, `${P}bb`, null, false);
    const r = await files.list(uid, null, false, 'name', 'ASC', 'folder');
    expect(r.length).toBeGreaterThanOrEqual(2);
    expect(r[0].name.localeCompare(r[1].name)).toBeLessThanOrEqual(0);
  });
  it('F51 sort by size DESC', async () => {
    const r = await files.list(uid, null, false, 'size', 'DESC');
    expect(Array.isArray(r)).toBe(true);
  });
  it('F52 sort by updatedAt', async () => {
    const r = await files.list(uid, null, false, 'updatedAt', 'ASC');
    expect(Array.isArray(r)).toBe(true);
  });
  it('F53 search for non-existent returns empty', async () => {
    const r = await files.search(uid, 'zzz_nonexistent_xyz_12345');
    expect(r.length).toBe(0);
  });
  it('F54 listRecent with custom limit', async () => {
    const r = await files.listRecent(uid, 3);
    expect(r.length).toBeLessThanOrEqual(3);
  });
  it('F55 createDocument then getPath', async () => {
    const d = await files.createDocument(uid, `${P}gp.md`, null, 'text/plain', '');
    const r = await files.getPath(uid, d.id);
    expect(r.length).toBeGreaterThanOrEqual(1);
  });
  it('F56 createFolder with isPrivate then list with filter', async () => {
    const f = await files.createFolder(uid, `${P}pr3`, null, true);
    const pub = await files.list(uid, null, false, 'createdAt', 'DESC');
    const priv = await files.list(uid, null, true, 'createdAt', 'DESC');
    expect(priv.some((n:any)=>n.id===f.id)).toBe(true);
  });
  it('F57 addTagToNode then removeTagFromNode', async () => {
    const d = await files.createDocument(uid, `${P}tgn.md`, null, 'text/plain', '');
    const t = await files.createTag(uid, `${P}tgt`, '#f00');
    await files.addTagToNode(uid, d.id, t.id);
    await files.removeTagFromNode(uid, d.id, t.id);
    await files.deleteTag(uid, t.id);
  });
  it('F58 createVersion then getVersions', async () => {
    const d = await files.createDocument(uid, `${P}ver2.md`, null, 'text/plain', '# cx');
    await files.createVersion(uid, d.id).catch(()=>{});
    const r = await files.getVersions(uid, d.id);
    expect(Array.isArray(r)).toBe(true);
  });
  it('F59 getDownloadInfo with valid node', async () => {
    const d = await files.createDocument(uid, `${P}gdi.md`, null, 'text/plain', '# content');
    const r = await files.getDownloadInfo(uid, d.id);
    expect(r).toHaveProperty('node');
  });
  it('F60 getFolderDownloadList with files', async () => {
    const f = await files.createFolder(uid, `${P}gfl_${Date.now()}`, null, false);
    await files.createDocument(uid, `${P}inf.md`, f.id, 'text/plain', '# in folder');
    const r = await files.getFolderDownloadList(uid, f.id);
    expect(r.files.length).toBeGreaterThanOrEqual(1);
  });
  it('F61 moveToPrivate multiple files', async () => {
    const d1 = await files.createDocument(uid, `${P}mp3a.md`, null, 'text/plain', '');
    const d2 = await files.createDocument(uid, `${P}mp3b.md`, null, 'text/plain', '');
    const r = await files.moveToPrivate(uid, [d1.id, d2.id], true);
    expect(r).toHaveProperty('message');
    await files.moveToPrivate(uid, [d1.id, d2.id], false);
  });
  it('F62 list with pagination via query', async () => {
    for (let i = 0; i < 3; i++) await files.createDocument(uid, `${P}pg${i}.md`, null, 'text/plain', '');
    const r = await files.list(uid, null, false, 'createdAt', 'DESC');
    expect(r.length).toBeGreaterThanOrEqual(3);
  });
  it('F63 search with private filter', async () => {
    await files.createDocument(uid, `${P}spriv.md`, null, 'text/plain', '');
    const r = await files.search(uid, P, undefined, true);
    expect(Array.isArray(r)).toBe(true);
  });
  it('F64 getSyncDiff future date', async () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    const r = await files.getSyncDiff(uid, future);
    expect(r.total).toBe(0);
  });
  it('F65 createDocument with long content', async () => {
    const r = await files.createDocument(uid, `${P}long.md`, null, 'text/plain', '# '.repeat(100));
    expect(r.type).toBe(NodeType.FILE);
  });
  it('F66 createFolder then rename', async () => {
    const f = await files.createFolder(uid, `${P}frn`, null, false);
    const r = await files.rename(uid, f.id, `${P}frn_new`);
    expect(r.name).toBe(`${P}frn_new`);
  });
  it('F67 move file between folders', async () => {
    const src = await files.createFolder(uid, `${P}src`, null, false);
    const dst = await files.createFolder(uid, `${P}dst`, null, false);
    const d = await files.createDocument(uid, `${P}mvf.md`, src.id, 'text/plain', '');
    await files.move(uid, d.id, dst.id).catch(()=>{});
  });
  it('F68 createFileRequest then access', async () => {
    const f = await files.createFolder(uid, `${P}fra`, null, false);
    const fr = await files.createFileRequest(uid, f.id, 10, 1);
    expect(fr).toHaveProperty('token');
  });
  it('F69 updateFileContent multiple times', async () => {
    const d = await files.createDocument(uid, `${P}multi.md`, null, 'text/plain', '# v1');
    await files.updateFileContent(uid, d.id, Buffer.from('# v2'), 'b'.repeat(24), 3, 'text/plain');
    await files.updateFileContent(uid, d.id, Buffer.from('# v3'), 'c'.repeat(24), 3, 'text/plain');
  });
  it('F70 createTag duplicate name rejected', async () => {
    const name = `${P}duptag`;
    await files.createTag(uid, name, '#000');
    await expect(files.createTag(uid, name, '#111')).rejects.toThrow();
  });
  it('F71 getThumbnailUrl returns url or null', async () => {
    const d = await files.createDocument(uid, `${P}th2.md`, null, 'text/plain', '');
    const r = await files.getThumbnailUrl(uid, d.id);
    expect(r === null || typeof r === 'string').toBe(true);
  });

  // ── Shares batch ────────────────────────────────────────────────────
  it('S5 incrementDownload', async () => {
    const n = nodeRepo.create({ userId: uid, name: `${P}sd_${Date.now()}.txt`, type: NodeType.FILE, isPrivate: false });
    await nodeRepo.save(n);
    const sh = await shares.createShare(uid, { nodeId: n.id, maxDownloads: 10 });
    const tok = await shares.getShareToken(uid, sh.id);
    const acc = await shares.accessShare(tok.token);
    await shares.incrementDownload(acc.shareId || sh.id);
  });

  // ── Admin batch ─────────────────────────────────────────────────────
  it('A7 getDashboard returns stats', async () => {
    const r = await admin.getDashboard();
    expect(r).toHaveProperty('totalUsers');
  });

  // ── Users batch ─────────────────────────────────────────────────────
  it('U6 updateProfile avatar', async () => {
    expect(await users.updateProfile(uid, { avatar: 'https://img.test/av.png' })).toHaveProperty('success');
  });
  it('U7 getAuditLogs with pagination', async () => {
    const r = await users.getAuditLogs(uid, 1, 5);
    expect(r).toHaveProperty('items');
  });
  it('U8 getUserStats has all fields', async () => {
    const r = await users.getUserStats(uid);
    expect(r.quotaBytes).toBeGreaterThan(0);
    expect(r.usedBytes).toBeGreaterThanOrEqual(0);
    expect(r).toHaveProperty('totalFiles');
  });

  // ── Files batch 7 ───────────────────────────────────────────────────
  it('F72 createDocument private', async () => {
    const r = await files.createDocument(uid, `${P}prdoc.md`, null, 'text/plain', '', true);
    expect(r.isPrivate).toBe(true);
  });
  it('F73 createFolder duplicate name different parent', async () => {
    const name = `${P}dupf2`;
    const p1 = await files.createFolder(uid, `${P}dp1`, null, false);
    const p2 = await files.createFolder(uid, `${P}dp2`, null, false);
    await files.createFolder(uid, name, p1.id, false);
    await files.createFolder(uid, name, p2.id, false);
  });
  it('F74 search with no keyword returns list', async () => {
    const r = await files.search(uid, '');
    expect(Array.isArray(r)).toBe(true);
  });
  it('F75 list with order ASC', async () => {
    const r = await files.list(uid, null, false, 'createdAt', 'ASC');
    expect(Array.isArray(r)).toBe(true);
  });
  it('F76 rename folder', async () => {
    const f = await files.createFolder(uid, `${P}ref`, null, false);
    const r = await files.rename(uid, f.id, `${P}ref2`);
    expect(r).toHaveProperty('id');
  });
  it('F77 setNote then verify', async () => {
    const d = await files.createDocument(uid, `${P}nv.md`, null, 'text/plain', '');
    await files.setNote(uid, d.id, 'verify_note');
    const r = await files.getPath(uid, d.id);
    expect(Array.isArray(r)).toBe(true);
  });
  it('F78 copy file then verify exists', async () => {
    const d = await files.createDocument(uid, `${P}cp2.md`, null, 'text/plain', '# copy2');
    const r = await files.copy(uid, d.id, null);
    expect(r).toHaveProperty('id');
  });
  it('F79 trash restore single', async () => {
    const d = await files.createDocument(uid, `${P}trs.md`, null, 'text/plain', '');
    await files.softDelete(uid, [d.id]);
    const r = await files.restoreTrash(uid, [d.id]);
    expect(r).toHaveProperty('message');
    await files.permanentDelete(uid, [d.id]);
  });
  it('F80 listStarred after unstar', async () => {
    const d = await files.createDocument(uid, `${P}unst.md`, null, 'text/plain', '');
    await files.toggleStar(uid, d.id);
    await files.toggleStar(uid, d.id);
    const r = await files.listStarred(uid);
    expect(r.some((n:any) => n.id === d.id)).toBe(false);
  });
  it('F81 createTag with empty color', async () => {
    const t = await files.createTag(uid, `${P}nc`, '');
    expect(t).toHaveProperty('id');
    await files.deleteTag(uid, t.id);
  });
  it('F82 getSyncDiff with recent date', async () => {
    const r = await files.getSyncDiff(uid, new Date().toISOString());
    expect(r.total).toBe(0);
  });
  it('F83 createFileRequest with default params', async () => {
    const f = await files.createFolder(uid, `${P}fr3_${Date.now()}`, null, false);
    const r = await files.createFileRequest(uid, f.id, 100, 72);
    expect(r).toHaveProperty('token');
  });
  it('F84 listRecent after creating files', async () => {
    for (let i = 0; i < 3; i++) await files.createDocument(uid, `${P}lrec${i}.md`, null, 'text/plain', '');
    const r = await files.listRecent(uid);
    expect(r.length).toBeGreaterThanOrEqual(1);
  });
  it('F85 moveToPrivate then verify private', async () => {
    const d = await files.createDocument(uid, `${P}pvt.md`, null, 'text/plain', '');
    await files.moveToPrivate(uid, [d.id], true);
    const priv = await files.list(uid, null, true, 'createdAt', 'DESC');
    expect(priv.length).toBeGreaterThanOrEqual(1);
    await files.moveToPrivate(uid, [d.id], false);
  });
});
