import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { ExportService } from './export.service';
import { TemplateService } from './template.service';
import { createTestApp, setAuthGate } from '../__tests__/test-utils';

describe('FilesController', () => {
  let app: INestApplication;
  let f: Record<string, jest.Mock>;
  let exp: Record<string, jest.Mock>;
  let tmpl: Record<string, jest.Mock>;

  const nodeId = '00000000-0000-0000-0000-000000000001';

  beforeEach(async () => {
    setAuthGate(true);
    f = {
      list: jest.fn(), createFolder: jest.fn(), updateFileContent: jest.fn(),
      createDocument: jest.fn(), listRecent: jest.fn(), uploadChunk: jest.fn(),
      getDownloadInfo: jest.fn(),
      rename: jest.fn(), move: jest.fn(), copy: jest.fn(),
      softDelete: jest.fn(), listTrash: jest.fn(), restoreTrash: jest.fn(),
      permanentDelete: jest.fn(),
      setLock: jest.fn(), removeLock: jest.fn(), verifyLock: jest.fn(),
      moveToPrivate: jest.fn(),
      search: jest.fn(), semanticSearch: jest.fn(),
      toggleStar: jest.fn(), listStarred: jest.fn(),
      getThumbnailUrl: jest.fn(), getPath: jest.fn(), getFolderDownloadList: jest.fn(),
      listTags: jest.fn(), createTag: jest.fn(), deleteTag: jest.fn(),
      addTagToNode: jest.fn(), removeTagFromNode: jest.fn(),
      createVersion: jest.fn(), getVersions: jest.fn(),
      getVersionDownloadInfo: jest.fn(),
      createFileRequest: jest.fn(), setNote: jest.fn(),
      createOfflineDownload: jest.fn(), getSyncDiff: jest.fn(),
    };
    exp = { exportPdf: jest.fn(), exportDocx: jest.fn(), exportMarkdown: jest.fn() };
    tmpl = { list: jest.fn(), create: jest.fn(), delete: jest.fn(), getContent: jest.fn() };
    app = await createTestApp(FilesController, [
      { provide: FilesService, useValue: f },
      { provide: ExportService, useValue: exp },
      { provide: TemplateService, useValue: tmpl },
    ]);
  });

  afterEach(() => app.close());

  // ── Auth gate ────────────────────────────────────────────────────────

  it('returns 401 without auth', async () => {
    setAuthGate(false);
    const res = await request(app.getHttpServer()).get('/files');
    expect(res.status).toBe(401);
  });

  // ── CRUD ─────────────────────────────────────────────────────────────

  describe('CRUD', () => {
    it('GET /files → lists with query params', async () => {
      f.list.mockResolvedValue([]);
      const res = await request(app.getHttpServer()).get('/files?parentId=root&type=image&sort=name&order=ASC');
      expect(res.status).toBe(200);
      expect(f.list).toHaveBeenCalledWith('u-1', 'root', false, 'name', 'ASC', 'image');
    });

    it('POST /files/folder → creates folder', async () => {
      f.createFolder.mockResolvedValue({ id: 'n-1' });
      const res = await request(app.getHttpServer()).post('/files/folder').send({ name: 'docs', parentId: 'root', private: true });
      expect(res.status).toBe(201);
    });

    it('POST /files/folder → handles name collision', async () => {
      f.createFolder.mockRejectedValue(new (require('@nestjs/common').ConflictException)('同名文件夹已存在'));
      const res = await request(app.getHttpServer()).post('/files/folder').send({ name: 'docs', parentId: 'root', private: false });
      expect(res.status).toBe(409);
    });

    it('PUT /files/:nodeId/content → updates content', async () => {
      f.updateFileContent.mockResolvedValue({ success: true });
      const b64 = Buffer.from('hello').toString('base64');
      const res = await request(app.getHttpServer())
        .put(`/files/${nodeId}/content`).send({ data: b64, iv: 'iv1', size: 5, mimeType: 'text/plain' });
      expect(res.status).toBe(200);
    });

    it('PATCH /files/:nodeId/rename → renames', async () => {
      f.rename.mockResolvedValue({ name: 'new.txt' });
      const res = await request(app.getHttpServer()).patch(`/files/${nodeId}/rename`).send({ name: 'new.txt' });
      expect(res.status).toBe(200);
    });

    it('DELETE /files → soft deletes', async () => {
      f.softDelete.mockResolvedValue({ deleted: 2 });
      const res = await request(app.getHttpServer()).delete('/files').send({ nodeIds: ['n-1', 'n-2'] });
      expect(res.status).toBe(200);
    });

    it('DELETE /files → handles file not found', async () => {
      f.softDelete.mockRejectedValue(new (require('@nestjs/common').NotFoundException)('文件不存在'));
      const res = await request(app.getHttpServer()).delete('/files').send({ nodeIds: ['n-missing'] });
      expect(res.status).toBe(404);
    });
  });

  // ── Download ─────────────────────────────────────────────────────────

  describe('Download', () => {
    it('POST /files/download/:nodeId → returns info with password', async () => {
      f.getDownloadInfo.mockResolvedValue({ url: 'https://t.me/file/bot...' });
      const res = await request(app.getHttpServer()).post(`/files/download/${nodeId}`).send({ password: 'secret' });
      expect(res.status).toBe(200);
    });

    it('POST /files/download/:nodeId → handles wrong password', async () => {
      f.getDownloadInfo.mockRejectedValue(new (require('@nestjs/common').ForbiddenException)('密码错误'));
      const res = await request(app.getHttpServer()).post(`/files/download/${nodeId}`).send({ password: 'wrong' });
      expect(res.status).toBe(403);
    });
  });

  // ── Lock ─────────────────────────────────────────────────────────────

  describe('Lock', () => {
    it('sets and verifies lock password', async () => {
      f.setLock.mockResolvedValue({ locked: true });
      const res = await request(app.getHttpServer()).patch(`/files/${nodeId}/lock`).send({ password: 'pwd' });
      expect(res.status).toBe(200);
    });

    it('handles wrong lock password', async () => {
      f.verifyLock.mockRejectedValue(new (require('@nestjs/common').ForbiddenException)('密码错误'));
      const res = await request(app.getHttpServer()).post(`/files/${nodeId}/verify-lock`).send({ password: 'wrong' });
      expect(res.status).toBe(403);
    });
  });

  // ── Trash ────────────────────────────────────────────────────────────

  describe('Trash', () => {
    it('list, restore, permanent delete', async () => {
      f.listTrash.mockResolvedValue([]);
      f.restoreTrash.mockResolvedValue({ restored: 1 });
      f.permanentDelete.mockResolvedValue({ deleted: 1 });

      let res = await request(app.getHttpServer()).get('/files/trash');
      expect(res.status).toBe(200);

      res = await request(app.getHttpServer()).post('/files/trash/restore').send({ nodeIds: ['n-1'] });
      expect(res.status).toBe(201);

      res = await request(app.getHttpServer()).delete('/files/trash/permanent').send({ nodeIds: ['n-1'] });
      expect(res.status).toBe(200);
    });
  });

  // ── Search ───────────────────────────────────────────────────────────

  describe('Search', () => {
    it('keyword search', async () => {
      f.search.mockResolvedValue([]);
      const res = await request(app.getHttpServer()).get('/files/search?q=photo&type=image');
      expect(res.status).toBe(200);
      expect(f.search).toHaveBeenCalledWith('u-1', 'photo', 'image', false, undefined);
    });

    it('handles empty search result', async () => {
      f.search.mockResolvedValue([]);
      const res = await request(app.getHttpServer()).get('/files/search?q=zzzzz');
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });
  });

  // ── Star ─────────────────────────────────────────────────────────────

  describe('Star', () => {
    it('toggles and lists', async () => {
      f.toggleStar.mockResolvedValue({ starred: true });
      f.listStarred.mockResolvedValue([]);

      let res = await request(app.getHttpServer()).patch(`/files/${nodeId}/star`);
      expect(res.status).toBe(200);

      res = await request(app.getHttpServer()).get('/files/starred');
      expect(res.status).toBe(200);
    });
  });

  // ── Tags ─────────────────────────────────────────────────────────────

  describe('Tags', () => {
    it('CRUD cycle', async () => {
      f.listTags.mockResolvedValue([]);
      f.createTag.mockResolvedValue({ id: 't-1' });
      f.deleteTag.mockResolvedValue({ success: true });

      const list = await request(app.getHttpServer()).get('/files/tags');
      expect(list.status).toBe(200);

      const create = await request(app.getHttpServer()).post('/files/tags').send({ name: 'work', color: '#ff0000' });
      expect(create.status).toBe(201);

      const del = await request(app.getHttpServer()).delete(`/files/tags/${nodeId}`);
      expect(del.status).toBe(200);
    });
  });

  // ── Versions ─────────────────────────────────────────────────────────

  describe('Versions', () => {
    it('creates and lists', async () => {
      f.createVersion.mockResolvedValue({ id: 'v-1' });
      f.getVersions.mockResolvedValue([]);

      const create = await request(app.getHttpServer()).post(`/files/${nodeId}/versions`);
      expect(create.status).toBe(201);

      const list = await request(app.getHttpServer()).get(`/files/${nodeId}/versions`);
      expect(list.status).toBe(200);
    });
  });

  // ── Templates ────────────────────────────────────────────────────────

  describe('Templates', () => {
    it('list, create, delete, content', async () => {
      tmpl.list.mockResolvedValue([]);
      tmpl.create.mockResolvedValue({ id: 'tmp-1' });
      tmpl.delete.mockResolvedValue({ success: true });
      tmpl.getContent.mockResolvedValue('# Content');

      expect((await request(app.getHttpServer()).get('/files/templates')).status).toBe(200);
      expect((await request(app.getHttpServer()).post('/files/templates')
        .send({ name: 't1', description: 'd', category: 'doc', content: '# H' })).status).toBe(201);
      expect((await request(app.getHttpServer()).delete(`/files/templates/${nodeId}`)).status).toBe(200);
      expect((await request(app.getHttpServer()).get(`/files/templates/${nodeId}/content`)).status).toBe(200);
    });
  });

  // ── Other ────────────────────────────────────────────────────────────

  describe('Other', () => {
    it('GET /files/recent → listRecent', async () => {
      f.listRecent.mockResolvedValue([]);
      const res = await request(app.getHttpServer()).get('/files/recent');
      expect(res.status).toBe(200);
    });

    it('POST /files/:nodeId/file-request → create', async () => {
      f.createFileRequest.mockResolvedValue({ token: 'fr-1' });
      const res = await request(app.getHttpServer())
        .post(`/files/${nodeId}/file-request`).send({ maxFiles: 50, ttlHours: 24 });
      expect(res.status).toBe(201);
    });

    it('PUT /files/:nodeId/note → set note', async () => {
      f.setNote.mockResolvedValue({ success: true });
      const res = await request(app.getHttpServer()).put(`/files/${nodeId}/note`).send({ note: 'text' });
      expect(res.status).toBe(200);
    });

    it('GET /files/:nodeId/path → breadcrumb', async () => {
      f.getPath.mockResolvedValue(['root', 'folder']);
      const res = await request(app.getHttpServer()).get(`/files/${nodeId}/path`);
      expect(res.status).toBe(200);
    });

    it('GET /files/sync/diff → delta', async () => {
      f.getSyncDiff.mockResolvedValue({ diff: [] });
      const res = await request(app.getHttpServer()).get('/files/sync/diff?since=2026-01-01');
      expect(res.status).toBe(200);
    });

    it('POST /files/offline-download → starts download', async () => {
      f.createOfflineDownload.mockResolvedValue({ id: 'od-1' });
      const res = await request(app.getHttpServer())
        .post('/files/offline-download').send({ url: 'https://x.com/f.zip', parentId: 'root', name: 'f.zip' });
      expect(res.status).toBe(202);
    });
  });
});
