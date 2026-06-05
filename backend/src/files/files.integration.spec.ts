import { Test } from '@nestjs/testing';
import { ValidationPipe, CanActivate, ExecutionContext, INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { ExportService } from './export.service';
import { TemplateService } from './template.service';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter';
import { TransformInterceptor } from '../common/interceptors/transform.interceptor';

let __authGate = true;

class MockAuthGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    if (!__authGate) throw new (require('@nestjs/common').UnauthorizedException)('请先登录');
    const req = ctx.switchToHttp().getRequest();
    req.user = { id: 'u-1', username: 'tester', deviceId: 'dev-1' };
    return true;
  }
}

function buildApp(
  filesSvc: Record<string, jest.Mock>,
  exportSvc?: Record<string, jest.Mock>,
  templateSvc?: Record<string, jest.Mock>,
): Promise<INestApplication> {
  return Test.createTestingModule({
    controllers: [FilesController],
    providers: [
      { provide: FilesService, useValue: filesSvc },
      { provide: ExportService, useValue: exportSvc || {} },
      { provide: TemplateService, useValue: templateSvc || {} },
    ],
  })
    .compile()
    .then(mod => {
      const app = mod.createNestApplication();
      app.use(cookieParser());
      app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
      app.useGlobalFilters(new HttpExceptionFilter());
      app.useGlobalInterceptors(new TransformInterceptor());
      app.useGlobalGuards(new MockAuthGuard());
      return app.init();
    });
}

describe('FilesController — integration (supertest)', () => {
  let app: INestApplication;
  let files: Record<string, jest.Mock>;
  let exp: Record<string, jest.Mock>;
  let tmpl: Record<string, jest.Mock>;

  beforeEach(async () => {
    __authGate = true;
    files = {
      list: jest.fn(),
      createFolder: jest.fn(),
      updateFileContent: jest.fn(),
      createDocument: jest.fn(),
      listRecent: jest.fn(),
      uploadChunk: jest.fn(),
      getDownloadInfo: jest.fn(),
      rename: jest.fn(),
      move: jest.fn(),
      copy: jest.fn(),
      softDelete: jest.fn(),
      listTrash: jest.fn(),
      restoreTrash: jest.fn(),
      permanentDelete: jest.fn(),
      setLock: jest.fn(),
      removeLock: jest.fn(),
      verifyLock: jest.fn(),
      moveToPrivate: jest.fn(),
      search: jest.fn(),
      semanticSearch: jest.fn(),
      toggleStar: jest.fn(),
      listStarred: jest.fn(),
      getThumbnailUrl: jest.fn(),
      getPath: jest.fn(),
      getFolderDownloadList: jest.fn(),
      listTags: jest.fn(),
      createTag: jest.fn(),
      deleteTag: jest.fn(),
      addTagToNode: jest.fn(),
      removeTagFromNode: jest.fn(),
      createVersion: jest.fn(),
      getVersions: jest.fn(),
      getVersionDownloadInfo: jest.fn(),
      createFileRequest: jest.fn(),
      setNote: jest.fn(),
      createOfflineDownload: jest.fn(),
      getSyncDiff: jest.fn(),
    };
    exp = { exportPdf: jest.fn(), exportDocx: jest.fn(), exportMarkdown: jest.fn() };
    tmpl = { list: jest.fn(), create: jest.fn(), delete: jest.fn(), getContent: jest.fn() };
    app = await buildApp(files, exp, tmpl);
  });

  afterEach(() => app.close());

  // ── Auth gate ────────────────────────────────────────────────────────

  it('returns 401 without auth', async () => {
    __authGate = false;
    const res = await request(app.getHttpServer()).get('/files');
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('请先登录');
  });

  // ── List ─────────────────────────────────────────────────────────────

  describe('GET /files', () => {
    it('lists files with query params', async () => {
      files.list.mockResolvedValue([{ id: 'n-1', name: 'photo.jpg' }]);
      const res = await request(app.getHttpServer())
        .get('/files?parentId=root&private=true&sort=name&order=ASC&type=image');
      expect(res.status).toBe(200);
      expect(files.list).toHaveBeenCalledWith('u-1', 'root', true, 'name', 'ASC', 'image');
    });
  });

  // ── Folder ───────────────────────────────────────────────────────────

  describe('POST /files/folder', () => {
    it('creates folder', async () => {
      files.createFolder.mockResolvedValue({ id: 'n-folder', name: 'docs' });
      const res = await request(app.getHttpServer())
        .post('/files/folder')
        .send({ name: 'docs', parentId: 'root', private: true });
      expect(res.status).toBe(201);
      expect(res.body.data).toEqual({ id: 'n-folder', name: 'docs' });
    });
  });

  // ── Document ─────────────────────────────────────────────────────────

  describe('POST /files/document', () => {
    it('creates document', async () => {
      files.createDocument.mockResolvedValue({ id: 'n-doc' });
      const res = await request(app.getHttpServer())
        .post('/files/document')
        .send({ name: 'readme', parentId: 'root', mimeType: 'text/markdown', content: '# Hello' });
      expect(res.status).toBe(201);
    });
  });

  // ── Content update ───────────────────────────────────────────────────

  describe('PUT /files/:nodeId/content', () => {
    it('updates file content with base64 data', async () => {
      files.updateFileContent.mockResolvedValue({ success: true });
      const b64 = Buffer.from('hello').toString('base64');
      const res = await request(app.getHttpServer())
        .put('/files/00000000-0000-0000-0000-000000000001/content')
        .send({ data: b64, iv: 'iv1', size: 5, mimeType: 'text/plain' });
      expect(res.status).toBe(200);
    });
  });

  // ── Upload chunk ─────────────────────────────────────────────────────

  describe('POST /files/upload-chunk', () => {
    it('uploads chunk with idempotency key', async () => {
      files.uploadChunk.mockResolvedValue({ done: false });
      const res = await request(app.getHttpServer())
        .post('/files/upload-chunk')
        .field('idempotencyKey', 'key-1')
        .field('chunkIndex', '0')
        .field('totalChunks', '2')
        .field('filename', 'photo.jpg')
        .field('md5', 'abc123')
        .field('mimeType', 'image/jpeg')
        .field('parentId', 'root')
        .field('private', 'false')
        .attach('chunk', Buffer.from('chunk-data'), 'photo.jpg');
      expect(res.status).toBe(201);
    });
  });

  // ── Download ─────────────────────────────────────────────────────────

  describe('POST /files/download/:nodeId', () => {
    it('returns download info with password', async () => {
      files.getDownloadInfo.mockResolvedValue({ url: 'https://t.me/file/bot...' });
      const res = await request(app.getHttpServer())
        .post('/files/download/00000000-0000-0000-0000-000000000001')
        .send({ password: 'secret' });
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ url: 'https://t.me/file/bot...' });
    });
  });

  // ── Rename / Move / Copy / Delete ────────────────────────────────────

  describe('PATCH /files/:nodeId/rename', () => {
    it('renames file', async () => {
      files.rename.mockResolvedValue({ id: 'n-1', name: 'new-name.jpg' });
      const res = await request(app.getHttpServer())
        .patch('/files/00000000-0000-0000-0000-000000000001/rename')
        .send({ name: 'new-name.jpg' });
      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('new-name.jpg');
    });
  });

  describe('PATCH /files/:nodeId/move', () => {
    it('moves file', async () => {
      files.move.mockResolvedValue({ success: true });
      const res = await request(app.getHttpServer())
        .patch('/files/00000000-0000-0000-0000-000000000001/move')
        .send({ targetParentId: 'target-folder-id' });
      expect(res.status).toBe(200);
    });
  });

  describe('POST /files/:nodeId/copy', () => {
    it('copies file', async () => {
      files.copy.mockResolvedValue({ id: 'n-copy' });
      const res = await request(app.getHttpServer())
        .post('/files/00000000-0000-0000-0000-000000000001/copy')
        .send({ targetParentId: 'target' });
      expect(res.status).toBe(201);
    });
  });

  describe('DELETE /files', () => {
    it('soft deletes files', async () => {
      files.softDelete.mockResolvedValue({ deleted: 2 });
      const res = await request(app.getHttpServer())
        .delete('/files')
        .send({ nodeIds: ['n-1', 'n-2'] });
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ deleted: 2 });
    });
  });

  // ── Trash ────────────────────────────────────────────────────────────

  describe('Trash endpoints', () => {
    it('GET /files/trash lists deleted files', async () => {
      files.listTrash.mockResolvedValue([{ id: 'n-1', name: 'deleted.txt' }]);
      const res = await request(app.getHttpServer()).get('/files/trash');
      expect(res.status).toBe(200);
    });

    it('POST /files/trash/restore recovers files', async () => {
      files.restoreTrash.mockResolvedValue({ restored: 1 });
      const res = await request(app.getHttpServer())
        .post('/files/trash/restore')
        .send({ nodeIds: ['n-1'] });
      expect(res.status).toBe(201);
    });

    it('DELETE /files/trash/permanent destroys files', async () => {
      files.permanentDelete.mockResolvedValue({ deleted: 1 });
      const res = await request(app.getHttpServer())
        .delete('/files/trash/permanent')
        .send({ nodeIds: ['n-1'] });
      expect(res.status).toBe(200);
    });
  });

  // ── Lock ─────────────────────────────────────────────────────────────

  describe('Lock endpoints', () => {
    it('sets lock with password', async () => {
      files.setLock.mockResolvedValue({ locked: true });
      const res = await request(app.getHttpServer())
        .patch('/files/00000000-0000-0000-0000-000000000001/lock')
        .send({ password: 'lockpwd' });
      expect(res.status).toBe(200);
    });

    it('removes lock', async () => {
      files.removeLock.mockResolvedValue({ success: true });
      const res = await request(app.getHttpServer())
        .delete('/files/00000000-0000-0000-0000-000000000001/lock')
        .send({ password: 'lockpwd' });
      expect(res.status).toBe(200);
    });

    it('verifies lock password', async () => {
      files.verifyLock.mockResolvedValue({ valid: true });
      const res = await request(app.getHttpServer())
        .post('/files/00000000-0000-0000-0000-000000000001/verify-lock')
        .send({ password: 'lockpwd' });
      expect(res.status).toBe(200);
    });
  });

  // ── Search ───────────────────────────────────────────────────────────

  describe('GET /files/search', () => {
    it('does keyword search', async () => {
      files.search.mockResolvedValue([]);
      const res = await request(app.getHttpServer()).get('/files/search?q=photo&type=image');
      expect(res.status).toBe(200);
      expect(files.search).toHaveBeenCalledWith('u-1', 'photo', 'image', false, undefined);
    });

    it('does semantic search when enabled', async () => {
      files.semanticSearch.mockResolvedValue([]);
      const res = await request(app.getHttpServer()).get('/files/search?q=cat&semantic=true');
      expect(res.status).toBe(200);
      expect(files.semanticSearch).toHaveBeenCalledWith('u-1', 'cat', false);
    });
  });

  // ── Star ─────────────────────────────────────────────────────────────

  describe('Star endpoints', () => {
    it('toggles star', async () => {
      files.toggleStar.mockResolvedValue({ starred: true });
      const res = await request(app.getHttpServer())
        .patch('/files/00000000-0000-0000-0000-000000000001/star');
      expect(res.status).toBe(200);
    });

    it('lists starred', async () => {
      files.listStarred.mockResolvedValue([]);
      const res = await request(app.getHttpServer()).get('/files/starred');
      expect(res.status).toBe(200);
    });
  });

  // ── Tags ─────────────────────────────────────────────────────────────

  describe('Tag endpoints', () => {
    it('lists tags', async () => {
      files.listTags.mockResolvedValue([]);
      const res = await request(app.getHttpServer()).get('/files/tags');
      expect(res.status).toBe(200);
    });

    it('creates tag', async () => {
      files.createTag.mockResolvedValue({ id: 't-1' });
      const res = await request(app.getHttpServer())
        .post('/files/tags')
        .send({ name: 'work', color: '#ff0000' });
      expect(res.status).toBe(201);
    });

    it('deletes tag', async () => {
      files.deleteTag.mockResolvedValue({ success: true });
      const res = await request(app.getHttpServer()).delete('/files/tags/00000000-0000-0000-0000-000000000001');
      expect(res.status).toBe(200);
    });
  });

  // ── Versions ─────────────────────────────────────────────────────────

  describe('Version endpoints', () => {
    it('creates version', async () => {
      files.createVersion.mockResolvedValue({ id: 'v-1' });
      const res = await request(app.getHttpServer())
        .post('/files/00000000-0000-0000-0000-000000000001/versions');
      expect(res.status).toBe(201);
    });

    it('lists versions', async () => {
      files.getVersions.mockResolvedValue([]);
      const res = await request(app.getHttpServer())
        .get('/files/00000000-0000-0000-0000-000000000001/versions');
      expect(res.status).toBe(200);
    });
  });

  // ── Templates ────────────────────────────────────────────────────────

  describe('Template endpoints', () => {
    it('lists templates', async () => {
      tmpl.list.mockResolvedValue([]);
      const res = await request(app.getHttpServer()).get('/files/templates');
      expect(res.status).toBe(200);
      expect(tmpl.list).toHaveBeenCalledWith('u-1');
    });

    it('creates template', async () => {
      tmpl.create.mockResolvedValue({ id: 'tmp-1' });
      const res = await request(app.getHttpServer())
        .post('/files/templates')
        .send({ name: 't1', description: 'desc', category: 'doc', content: '# Hello' });
      expect(res.status).toBe(201);
    });

    it('deletes template', async () => {
      tmpl.delete.mockResolvedValue({ success: true });
      const res = await request(app.getHttpServer())
        .delete('/files/templates/00000000-0000-0000-0000-000000000001');
      expect(res.status).toBe(200);
    });

    it('gets template content', async () => {
      tmpl.getContent.mockResolvedValue('# Content');
      const res = await request(app.getHttpServer())
        .get('/files/templates/00000000-0000-0000-0000-000000000001/content');
      expect(res.status).toBe(200);
      expect(res.body.data).toBe('# Content');
    });
  });

  // ── Export ───────────────────────────────────────────────────────────

  describe('Export endpoints', () => {
    it('exports PDF', async () => {
      exp.exportPdf.mockResolvedValue({ buffer: Buffer.from('pdf'), filename: 'doc.pdf' });
      const res = await request(app.getHttpServer())
        .post('/files/00000000-0000-0000-0000-000000000001/export/pdf')
        .send({ html: '<h1>Hello</h1>' });
      expect(res.status).toBe(201);
    });

    it('exports docx', async () => {
      exp.exportDocx.mockResolvedValue({ buffer: Buffer.from('docx'), filename: 'doc.docx' });
      const res = await request(app.getHttpServer())
        .post('/files/00000000-0000-0000-0000-000000000001/export/docx')
        .send({ html: '<h1>Hello</h1>' });
      expect(res.status).toBe(201);
    });

    it('exports markdown', async () => {
      exp.exportMarkdown.mockResolvedValue({ buffer: Buffer.from('md'), filename: 'doc.md' });
      const res = await request(app.getHttpServer())
        .post('/files/00000000-0000-0000-0000-000000000001/export/markdown');
      expect(res.status).toBe(201);
    });
  });

  // ── Other endpoints ──────────────────────────────────────────────────

  describe('Other endpoints', () => {
    it('GET /files/recent lists recent', async () => {
      files.listRecent.mockResolvedValue([]);
      const res = await request(app.getHttpServer()).get('/files/recent');
      expect(res.status).toBe(200);
    });

    it('POST /files/move-private moves to private', async () => {
      files.moveToPrivate.mockResolvedValue({ moved: 1 });
      const res = await request(app.getHttpServer())
        .post('/files/move-private')
        .send({ nodeIds: ['n-1'], private: true });
      expect(res.status).toBe(201);
    });

    it('GET /files/:nodeId/path returns path', async () => {
      files.getPath.mockResolvedValue(['root', 'folder', 'file.txt']);
      const res = await request(app.getHttpServer()).get('/files/n-id/path');
      expect(res.status).toBe(200);
    });

    it('POST /files/:nodeId/file-request creates upload link', async () => {
      files.createFileRequest.mockResolvedValue({ token: 'fr-token', maxFiles: 100 });
      const res = await request(app.getHttpServer())
        .post('/files/00000000-0000-0000-0000-000000000001/file-request')
        .send({ maxFiles: 50, ttlHours: 24 });
      expect(res.status).toBe(201);
    });

    it('PUT /files/:nodeId/note sets note', async () => {
      files.setNote.mockResolvedValue({ success: true });
      const res = await request(app.getHttpServer())
        .put('/files/00000000-0000-0000-0000-000000000001/note')
        .send({ note: 'my note text' });
      expect(res.status).toBe(200);
    });

    it('POST /files/offline-download starts download', async () => {
      files.createOfflineDownload.mockResolvedValue({ id: 'od-1' });
      const res = await request(app.getHttpServer())
        .post('/files/offline-download')
        .send({ url: 'https://example.com/file.zip', parentId: 'root', name: 'file.zip' });
      expect(res.status).toBe(202);
    });

    it('GET /files/sync/diff returns delta', async () => {
      files.getSyncDiff.mockResolvedValue({ diff: [] });
      const res = await request(app.getHttpServer()).get('/files/sync/diff?since=2026-01-01');
      expect(res.status).toBe(200);
    });
  });
});
