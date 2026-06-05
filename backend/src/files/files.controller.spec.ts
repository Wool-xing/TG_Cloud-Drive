import { Test, TestingModule } from '@nestjs/testing';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { ExportService } from './export.service';
import { TemplateService } from './template.service';

describe('FilesController', () => {
  let controller: FilesController;
  let filesService: Record<string, jest.Mock>;
  let exportService: Record<string, jest.Mock>;
  let templateService: Record<string, jest.Mock>;

  const res = () => {
    const _res: any = {};
    _res.set = jest.fn().mockReturnValue(_res);
    _res.send = jest.fn().mockReturnValue(_res);
    _res.status = jest.fn().mockReturnValue(_res);
    _res.redirect = jest.fn().mockReturnValue(_res);
    return _res;
  };

  beforeEach(async () => {
    filesService = {
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
    exportService = {
      exportPdf: jest.fn(),
      exportDocx: jest.fn(),
      exportMarkdown: jest.fn(),
    };
    templateService = {
      list: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
      getContent: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [FilesController],
      providers: [
        { provide: FilesService, useValue: filesService },
        { provide: ExportService, useValue: exportService },
        { provide: TemplateService, useValue: templateService },
      ],
    }).compile();

    controller = module.get<FilesController>(FilesController);
    jest.clearAllMocks();
  });

  // ── GET /files ─────────────────────────────────────────────────────────

  describe('GET /files', () => {
    it('delegates list with parentId, private flag, sort, order, type', async () => {
      filesService.list.mockResolvedValue([]);
      const result = await controller.list('u-1', 'root', 'true', 'name', 'ASC', 'folder');
      expect(filesService.list).toHaveBeenCalledWith('u-1', 'root', true, 'name', 'ASC', 'folder');
      expect(result).toEqual([]);
    });

    it('defaults sort and order when omitted', async () => {
      filesService.list.mockResolvedValue([]);
      await controller.list('u-1', undefined, undefined, undefined, undefined, undefined);
      expect(filesService.list).toHaveBeenCalledWith('u-1', undefined, false, 'createdAt', 'DESC', undefined);
    });
  });

  // ── POST /files/folder ─────────────────────────────────────────────────

  describe('POST /files/folder', () => {
    it('delegates createFolder', async () => {
      filesService.createFolder.mockResolvedValue({ id: 'n-1', name: 'docs' });
      const result = await controller.createFolder('u-1', 'docs', 'root', true);
      expect(filesService.createFolder).toHaveBeenCalledWith('u-1', 'docs', 'root', true);
      expect(result).toEqual({ id: 'n-1', name: 'docs' });
    });
  });

  // ── PUT /files/:nodeId/content ─────────────────────────────────────────

  describe('PUT /files/:nodeId/content', () => {
    it('decodes base64 data and delegates', async () => {
      const b64 = Buffer.from('hello').toString('base64');
      filesService.updateFileContent.mockResolvedValue({ success: true });
      const result = await controller.updateContent('u-1', 'n-1', b64, 'iv-1', 5, 'text/plain', 'edek', 'div');
      expect(filesService.updateFileContent).toHaveBeenCalledWith(
        'u-1', 'n-1', expect.any(Buffer), 'iv-1', 5, 'text/plain', 'edek', 'div',
      );
      expect(result).toEqual({ success: true });
    });
  });

  // ── POST /files/document ───────────────────────────────────────────────

  describe('POST /files/document', () => {
    it('delegates createDocument', async () => {
      filesService.createDocument.mockResolvedValue({ id: 'n-doc' });
      const result = await controller.createDocument('u-1', 'doc1', 'root', 'text/plain', 'hello', true);
      expect(filesService.createDocument).toHaveBeenCalledWith('u-1', 'doc1', 'root', 'text/plain', 'hello', true);
      expect(result).toEqual({ id: 'n-doc' });
    });
  });

  // ── GET /files/recent ──────────────────────────────────────────────────

  describe('GET /files/recent', () => {
    it('delegates listRecent', async () => {
      filesService.listRecent.mockResolvedValue([{ id: 'n-1' }]);
      const result = await controller.listRecent('u-1');
      expect(filesService.listRecent).toHaveBeenCalledWith('u-1');
      expect(result).toEqual([{ id: 'n-1' }]);
    });
  });

  // ── POST /files/upload-chunk ───────────────────────────────────────────

  describe('POST /files/upload-chunk', () => {
    it('delegates uploadChunk with parsed params', async () => {
      const file = { buffer: Buffer.from('chunk'), originalname: 'f.txt' } as Express.Multer.File;
      filesService.uploadChunk.mockResolvedValue({ done: false });
      const result = await controller.uploadChunk(
        'u-1', file, 'key-1', '0', '3', 'f.txt', 'md5hash', 'text/plain',
        'root', 'false', 'edek', 'div', 'civ', 'salt',
      );
      expect(filesService.uploadChunk).toHaveBeenCalledWith(
        'u-1', 'key-1', 0, 3, 'f.txt', 'md5hash', 'text/plain', 'root', false,
        file.buffer, 'edek', 'div', 'civ', 'salt',
      );
      expect(result).toEqual({ done: false });
    });
  });

  // ── POST /files/download/:nodeId ───────────────────────────────────────

  describe('POST /files/download/:nodeId', () => {
    it('delegates getDownloadInfo with password from body', async () => {
      filesService.getDownloadInfo.mockResolvedValue({ url: 'https://...' });
      const result = await controller.getDownloadInfoByPost('u-1', 'n-1', 'pwd');
      expect(filesService.getDownloadInfo).toHaveBeenCalledWith('u-1', 'n-1', 'pwd');
      expect(result).toEqual({ url: 'https://...' });
    });
  });

  // ── GET /files/download/:nodeId (legacy redirect) ──────────────────────

  describe('GET /files/download/:nodeId (legacy)', () => {
    it('redirects 308 to POST endpoint', async () => {
      const _res = res();
      await (controller as any).getDownloadInfoLegacy('u-1', 'n-1', 'pwd', _res);
      expect(_res.redirect).toHaveBeenCalledWith(308, '/api/files/download/n-1');
    });
  });

  // ── PATCH /files/:nodeId/rename ────────────────────────────────────────

  describe('PATCH /files/:nodeId/rename', () => {
    it('delegates rename', async () => {
      filesService.rename.mockResolvedValue({ id: 'n-1', name: 'new' });
      const result = await controller.rename('u-1', 'n-1', 'new');
      expect(filesService.rename).toHaveBeenCalledWith('u-1', 'n-1', 'new');
      expect(result).toEqual({ id: 'n-1', name: 'new' });
    });
  });

  // ── PATCH /files/:nodeId/move ──────────────────────────────────────────

  describe('PATCH /files/:nodeId/move', () => {
    it('delegates move', async () => {
      filesService.move.mockResolvedValue({ success: true });
      const result = await controller.move('u-1', 'n-1', 'target');
      expect(filesService.move).toHaveBeenCalledWith('u-1', 'n-1', 'target');
      expect(result).toEqual({ success: true });
    });
  });

  // ── POST /files/:nodeId/copy ───────────────────────────────────────────

  describe('POST /files/:nodeId/copy', () => {
    it('delegates copy', async () => {
      filesService.copy.mockResolvedValue({ id: 'n-copy' });
      const result = await controller.copy('u-1', 'n-1', 'target');
      expect(filesService.copy).toHaveBeenCalledWith('u-1', 'n-1', 'target');
      expect(result).toEqual({ id: 'n-copy' });
    });
  });

  // ── DELETE /files ──────────────────────────────────────────────────────

  describe('DELETE /files', () => {
    it('delegates softDelete with nodeIds array', async () => {
      filesService.softDelete.mockResolvedValue({ deleted: 2 });
      const result = await controller.softDelete('u-1', ['n-1', 'n-2']);
      expect(filesService.softDelete).toHaveBeenCalledWith('u-1', ['n-1', 'n-2']);
      expect(result).toEqual({ deleted: 2 });
    });
  });

  // ── Trash ──────────────────────────────────────────────────────────────

  describe('GET /files/trash', () => {
    it('delegates listTrash', async () => {
      filesService.listTrash.mockResolvedValue([]);
      const result = await controller.listTrash('u-1');
      expect(filesService.listTrash).toHaveBeenCalledWith('u-1');
      expect(result).toEqual([]);
    });
  });

  describe('POST /files/trash/restore', () => {
    it('delegates restoreTrash', async () => {
      filesService.restoreTrash.mockResolvedValue({ restored: 1 });
      const result = await controller.restoreTrash('u-1', ['n-1']);
      expect(filesService.restoreTrash).toHaveBeenCalledWith('u-1', ['n-1']);
      expect(result).toEqual({ restored: 1 });
    });
  });

  describe('DELETE /files/trash/permanent', () => {
    it('delegates permanentDelete', async () => {
      filesService.permanentDelete.mockResolvedValue({ deleted: 1 });
      const result = await controller.permanentDelete('u-1', ['n-1']);
      expect(filesService.permanentDelete).toHaveBeenCalledWith('u-1', ['n-1']);
      expect(result).toEqual({ deleted: 1 });
    });
  });

  // ── Lock ───────────────────────────────────────────────────────────────

  describe('PATCH /files/:nodeId/lock', () => {
    it('delegates setLock', async () => {
      filesService.setLock.mockResolvedValue({ locked: true });
      const result = await controller.setLock('u-1', 'n-1', 'pwd');
      expect(filesService.setLock).toHaveBeenCalledWith('u-1', 'n-1', 'pwd');
      expect(result).toEqual({ locked: true });
    });
  });

  describe('DELETE /files/:nodeId/lock', () => {
    it('delegates removeLock', async () => {
      filesService.removeLock.mockResolvedValue({ success: true });
      const result = await controller.removeLock('u-1', 'n-1', 'pwd');
      expect(filesService.removeLock).toHaveBeenCalledWith('u-1', 'n-1', 'pwd');
      expect(result).toEqual({ success: true });
    });
  });

  describe('POST /files/:nodeId/verify-lock', () => {
    it('delegates verifyLock', async () => {
      filesService.verifyLock.mockResolvedValue({ valid: true });
      const result = await controller.verifyLock('u-1', 'n-1', 'pwd');
      expect(filesService.verifyLock).toHaveBeenCalledWith('u-1', 'n-1', 'pwd');
      expect(result).toEqual({ valid: true });
    });
  });

  // ── Private space ─────────────────────────────────────────────────────

  describe('POST /files/move-private', () => {
    it('delegates moveToPrivate', async () => {
      filesService.moveToPrivate.mockResolvedValue({ moved: 2 });
      const result = await controller.moveToPrivate('u-1', ['n-1'], true);
      expect(filesService.moveToPrivate).toHaveBeenCalledWith('u-1', ['n-1'], true);
      expect(result).toEqual({ moved: 2 });
    });
  });

  // ── Search ─────────────────────────────────────────────────────────────

  describe('GET /files/search', () => {
    it('delegates keyword search', async () => {
      filesService.search.mockResolvedValue([]);
      await controller.search('u-1', 'photo', 'image', 'false');
      expect(filesService.search).toHaveBeenCalledWith('u-1', 'photo', 'image', false, undefined);
    });

    it('delegates semantic search when semantic=true', async () => {
      filesService.semanticSearch.mockResolvedValue([]);
      await controller.search('u-1', 'cat', undefined, 'true', undefined, 'true');
      expect(filesService.semanticSearch).toHaveBeenCalledWith('u-1', 'cat', true);
    });
  });

  // ── Star ───────────────────────────────────────────────────────────────

  describe('PATCH /files/:nodeId/star', () => {
    it('delegates toggleStar', async () => {
      filesService.toggleStar.mockResolvedValue({ starred: true });
      const result = await controller.toggleStar('u-1', 'n-1');
      expect(filesService.toggleStar).toHaveBeenCalledWith('u-1', 'n-1');
      expect(result).toEqual({ starred: true });
    });
  });

  describe('GET /files/starred', () => {
    it('delegates listStarred', async () => {
      filesService.listStarred.mockResolvedValue([]);
      const result = await controller.listStarred('u-1');
      expect(filesService.listStarred).toHaveBeenCalledWith('u-1');
      expect(result).toEqual([]);
    });
  });

  // ── Tags ───────────────────────────────────────────────────────────────

  describe('GET /files/tags', () => {
    it('delegates listTags', async () => {
      filesService.listTags.mockResolvedValue([]);
      const result = await controller.listTags('u-1');
      expect(filesService.listTags).toHaveBeenCalledWith('u-1');
      expect(result).toEqual([]);
    });
  });

  describe('POST /files/tags', () => {
    it('delegates createTag', async () => {
      filesService.createTag.mockResolvedValue({ id: 't-1' });
      const result = await controller.createTag('u-1', 'work', '#ff0000');
      expect(filesService.createTag).toHaveBeenCalledWith('u-1', 'work', '#ff0000');
      expect(result).toEqual({ id: 't-1' });
    });
  });

  describe('DELETE /files/tags/:tagId', () => {
    it('delegates deleteTag', async () => {
      filesService.deleteTag.mockResolvedValue({ success: true });
      const result = await controller.deleteTag('u-1', 't-1');
      expect(filesService.deleteTag).toHaveBeenCalledWith('u-1', 't-1');
      expect(result).toEqual({ success: true });
    });
  });

  describe('POST /files/:nodeId/tags', () => {
    it('delegates addTagToNode', async () => {
      filesService.addTagToNode.mockResolvedValue({ success: true });
      const result = await controller.addTagToNode('u-1', 'n-1', 't-1');
      expect(filesService.addTagToNode).toHaveBeenCalledWith('u-1', 'n-1', 't-1');
      expect(result).toEqual({ success: true });
    });
  });

  describe('DELETE /files/:nodeId/tags/:tagId', () => {
    it('delegates removeTagFromNode', async () => {
      filesService.removeTagFromNode.mockResolvedValue({ success: true });
      const result = await controller.removeTagFromNode('u-1', 'n-1', 't-1');
      expect(filesService.removeTagFromNode).toHaveBeenCalledWith('u-1', 'n-1', 't-1');
      expect(result).toEqual({ success: true });
    });
  });

  // ── Versions ───────────────────────────────────────────────────────────

  describe('POST /files/:nodeId/versions', () => {
    it('delegates createVersion', async () => {
      filesService.createVersion.mockResolvedValue({ id: 'v-1' });
      const result = await controller.createVersion('u-1', 'n-1');
      expect(filesService.createVersion).toHaveBeenCalledWith('u-1', 'n-1');
      expect(result).toEqual({ id: 'v-1' });
    });
  });

  describe('GET /files/:nodeId/versions', () => {
    it('delegates getVersions', async () => {
      filesService.getVersions.mockResolvedValue([]);
      const result = await controller.getVersions('u-1', 'n-1');
      expect(filesService.getVersions).toHaveBeenCalledWith('u-1', 'n-1');
      expect(result).toEqual([]);
    });
  });

  describe('GET /files/:nodeId/versions/:versionId/download', () => {
    it('delegates getVersionDownloadInfo', async () => {
      filesService.getVersionDownloadInfo.mockResolvedValue({ url: 'https://...' });
      const result = await controller.getVersionDownloadInfo('u-1', 'n-1', 'v-1');
      expect(filesService.getVersionDownloadInfo).toHaveBeenCalledWith('u-1', 'n-1', 'v-1');
      expect(result).toEqual({ url: 'https://...' });
    });
  });

  // ── File request ───────────────────────────────────────────────────────

  describe('POST /files/:nodeId/file-request', () => {
    it('delegates createFileRequest with defaults', async () => {
      filesService.createFileRequest.mockResolvedValue({ token: 'fr-token' });
      const result = await controller.createFileRequest('u-1', 'n-1', 100, 72);
      expect(filesService.createFileRequest).toHaveBeenCalledWith('u-1', 'n-1', 100, 72);
      expect(result).toEqual({ token: 'fr-token' });
    });
  });

  // ── Note ───────────────────────────────────────────────────────────────

  describe('PUT /files/:nodeId/note', () => {
    it('delegates setNote', async () => {
      filesService.setNote.mockResolvedValue({ success: true });
      const result = await controller.setNote('u-1', 'n-1', 'my note');
      expect(filesService.setNote).toHaveBeenCalledWith('u-1', 'n-1', 'my note');
      expect(result).toEqual({ success: true });
    });
  });

  // ── Offline download ───────────────────────────────────────────────────

  describe('POST /files/offline-download', () => {
    it('delegates createOfflineDownload', async () => {
      filesService.createOfflineDownload.mockResolvedValue({ id: 'od-1' });
      const result = await controller.createOfflineDownload('u-1', 'https://example.com/file.zip', 'root', 'file.zip');
      expect(filesService.createOfflineDownload).toHaveBeenCalledWith('u-1', 'https://example.com/file.zip', 'root', 'file.zip');
      expect(result).toEqual({ id: 'od-1' });
    });
  });

  // ── Sync diff ──────────────────────────────────────────────────────────

  describe('GET /files/sync/diff', () => {
    it('delegates getSyncDiff', async () => {
      filesService.getSyncDiff.mockResolvedValue({ diff: [] });
      const result = await controller.syncDiff('u-1', '2026-01-01');
      expect(filesService.getSyncDiff).toHaveBeenCalledWith('u-1', '2026-01-01');
      expect(result).toEqual({ diff: [] });
    });
  });

  // ── Templates ──────────────────────────────────────────────────────────

  describe('GET /files/templates', () => {
    it('delegates templateService.list', async () => {
      templateService.list.mockResolvedValue([]);
      const result = await controller.listTemplates('u-1');
      expect(templateService.list).toHaveBeenCalledWith('u-1');
      expect(result).toEqual([]);
    });
  });

  describe('POST /files/templates', () => {
    it('delegates templateService.create', async () => {
      templateService.create.mockResolvedValue({ id: 'tmp-1' });
      const result = await controller.createTemplate('u-1', 't1', 'desc', 'doc', 'content');
      expect(templateService.create).toHaveBeenCalledWith('u-1', 't1', 'desc', 'doc', 'content');
      expect(result).toEqual({ id: 'tmp-1' });
    });
  });

  describe('DELETE /files/templates/:templateId', () => {
    it('delegates templateService.delete', async () => {
      templateService.delete.mockResolvedValue({ success: true });
      const result = await controller.deleteTemplate('u-1', 'tmp-1');
      expect(templateService.delete).toHaveBeenCalledWith('u-1', 'tmp-1');
      expect(result).toEqual({ success: true });
    });
  });

  describe('GET /files/templates/:templateId/content', () => {
    it('delegates templateService.getContent', async () => {
      templateService.getContent.mockResolvedValue('content');
      const result = await controller.getTemplateContent('u-1', 'tmp-1');
      expect(templateService.getContent).toHaveBeenCalledWith('u-1', 'tmp-1');
      expect(result).toBe('content');
    });
  });

  // ── Export ─────────────────────────────────────────────────────────────

  describe('POST /files/:nodeId/export/pdf', () => {
    it('delegates exportPdf and sends response', async () => {
      exportService.exportPdf.mockResolvedValue({ buffer: Buffer.from('pdf'), filename: 'doc.pdf' });
      const _res = res();
      await controller.exportPdf('u-1', 'n-1', '<html></html>', _res);
      expect(exportService.exportPdf).toHaveBeenCalledWith('u-1', 'n-1', '<html></html>');
      expect(_res.set).toHaveBeenCalledWith(expect.objectContaining({ 'Content-Type': 'text/html; charset=utf-8' }));
      expect(_res.send).toHaveBeenCalledWith(Buffer.from('pdf'));
    });
  });

  describe('POST /files/:nodeId/export/docx', () => {
    it('delegates exportDocx', async () => {
      exportService.exportDocx.mockResolvedValue({ buffer: Buffer.from('docx'), filename: 'doc.docx' });
      const _res = res();
      await controller.exportDocx('u-1', 'n-1', '<html></html>', _res);
      expect(exportService.exportDocx).toHaveBeenCalledWith('u-1', 'n-1', '<html></html>');
      expect(_res.set).toHaveBeenCalledWith(expect.objectContaining({
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }));
    });
  });

  describe('POST /files/:nodeId/export/markdown', () => {
    it('delegates exportMarkdown', async () => {
      exportService.exportMarkdown.mockResolvedValue({ buffer: Buffer.from('md'), filename: 'doc.md' });
      const _res = res();
      await controller.exportMarkdown('u-1', 'n-1', _res);
      expect(exportService.exportMarkdown).toHaveBeenCalledWith('u-1', 'n-1');
      expect(_res.send).toHaveBeenCalledWith(Buffer.from('md'));
    });
  });

  // ── Thumbnail ──────────────────────────────────────────────────────────

  describe('GET /files/thumbnail/:nodeId', () => {
    it('redirects to thumbnail url', async () => {
      filesService.getThumbnailUrl.mockResolvedValue('https://thumb.url');
      const _res = res();
      await controller.thumbnail('u-1', 'n-1', _res);
      expect(filesService.getThumbnailUrl).toHaveBeenCalledWith('u-1', 'n-1');
      expect(_res.redirect).toHaveBeenCalledWith(302, 'https://thumb.url');
    });

    it('returns 404 when no thumbnail', async () => {
      filesService.getThumbnailUrl.mockResolvedValue(null);
      const _res = res();
      await controller.thumbnail('u-1', 'n-1', _res);
      expect(_res.status).toHaveBeenCalledWith(404);
      expect(_res.send).toHaveBeenCalled();
    });
  });

  // ── Path ───────────────────────────────────────────────────────────────

  describe('GET /files/:nodeId/path', () => {
    it('delegates getPath', async () => {
      filesService.getPath.mockResolvedValue(['root', 'folder', 'file']);
      const result = await controller.getPath('u-1', 'n-1');
      expect(filesService.getPath).toHaveBeenCalledWith('u-1', 'n-1');
      expect(result).toEqual(['root', 'folder', 'file']);
    });
  });

  // ── Folder download list ───────────────────────────────────────────────

  describe('GET /files/folder/:nodeId/download-list', () => {
    it('delegates getFolderDownloadList', async () => {
      filesService.getFolderDownloadList.mockResolvedValue([]);
      const result = await controller.getFolderDownloadList('u-1', 'n-1');
      expect(filesService.getFolderDownloadList).toHaveBeenCalledWith('u-1', 'n-1');
      expect(result).toEqual([]);
    });
  });
});
