import {
  Controller, Get, Post, Put, Patch, Delete, Body, Param, Query,
  Req, Res, UseInterceptors, UploadedFile, ParseUUIDPipe, HttpCode,
} from '@nestjs/common';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { FilesService } from './files.service';
import { ExportService } from './export.service';
import { TemplateService } from './template.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('文件管理')
@ApiBearerAuth()
@Controller('files')
export class FilesController {
  constructor(
    private filesService: FilesService,
    private exportService: ExportService,
    private templateService: TemplateService,
  ) {}

  @Get()
  list(
    @CurrentUser('id') userId: string,
    @Query('parentId') parentId: string,
    @Query('private') isPrivate: string,
    @Query('sort') sort = 'createdAt',
    @Query('order') order = 'DESC',
    @Query('type') type: string,
  ) {
    return this.filesService.list(userId, parentId, isPrivate === 'true', sort, order, type);
  }

  @Post('folder')
  createFolder(
    @CurrentUser('id') userId: string,
    @Body('name') name: string,
    @Body('parentId') parentId: string,
    @Body('private') isPrivate: boolean,
  ) {
    return this.filesService.createFolder(userId, name, parentId, !!isPrivate);
  }

  @Put(':nodeId/content')
  updateContent(
    @CurrentUser('id') userId: string,
    @Param('nodeId', ParseUUIDPipe) nodeId: string,
    @Body('data') data: string,
    @Body('iv') iv: string,
    @Body('size') size: number,
    @Body('mimeType') mimeType: string,
    @Body('encryptedDek') encryptedDek?: string,
    @Body('dekIv') dekIv?: string,
  ) {
    const buffer = Buffer.from(data, 'base64');
    return this.filesService.updateFileContent(userId, nodeId, buffer, iv, size, mimeType, encryptedDek, dekIv);
  }

  @Post('document')
  @HttpCode(201)
  createDocument(
    @CurrentUser('id') userId: string,
    @Body('name') name: string,
    @Body('parentId') parentId: string,
    @Body('mimeType') mimeType: string,
    @Body('content') content?: string,
    @Body('private') isPrivate?: boolean,
  ) {
    return this.filesService.createDocument(userId, name, parentId, mimeType, content, !!isPrivate);
  }

  @Get('recent')
  listRecent(@CurrentUser('id') userId: string) {
    return this.filesService.listRecent(userId);
  }

  @Post('upload-chunk')
  @UseInterceptors(FileInterceptor('chunk', { storage: memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } }))
  uploadChunk(
    @CurrentUser('id') userId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('idempotencyKey') idempotencyKey: string,
    @Body('chunkIndex') chunkIndex: string,
    @Body('totalChunks') totalChunks: string,
    @Body('filename') filename: string,
    @Body('md5') md5: string,
    @Body('mimeType') mimeType: string,
    @Body('parentId') parentId: string,
    @Body('private') isPrivate: string,
    @Body('encryptedDek') encryptedDek: string,
    @Body('dekIv') dekIv: string,
    @Body('chunkIv') chunkIv: string,
    @Body('salt') salt: string,
  ) {
    return this.filesService.uploadChunk(
      userId, idempotencyKey, parseInt(chunkIndex), parseInt(totalChunks),
      filename, md5, mimeType, parentId, isPrivate === 'true',
      file.buffer, encryptedDek, dekIv, chunkIv, salt,
    );
  }

  /**
   * P1-B14: download endpoint accepts password via body now. Pre-fix it was
   * `?password=`, which:
   *   1. Leaked into nginx access logs and browser history.
   *   2. Was visible to any extension / referrer header sniffing the URL.
   *   3. Got cached by CDN/proxies despite Cache-Control headers.
   * Switched to POST so the password lives in the body (TLS-encrypted, not
   * logged by default). Legacy GET is kept for one release as a deprecation
   * bridge — it logs a warning and still works.
   */
  @Post('download/:nodeId')
  @HttpCode(200)
  getDownloadInfoByPost(
    @CurrentUser('id') userId: string,
    @Param('nodeId', ParseUUIDPipe) nodeId: string,
    @Body('password') password: string,
  ) {
    return this.filesService.getDownloadInfo(userId, nodeId, password);
  }

  /** @deprecated P1-B14 — use POST /files/download/:nodeId with body instead.
   *  Password in URL query leaks to nginx logs / browser history / referrer.
   *  This route remains only for backward compatibility; new clients MUST use
   *  the POST variant. Remove after one release cycle. */
  @Get('download/:nodeId')
  @HttpCode(308)
  getDownloadInfoLegacy(
    @CurrentUser('id') userId: string,
    @Param('nodeId', ParseUUIDPipe) nodeId: string,
    @Query('password') password: string,
    @Res() res: Response,
  ) {
    // Issue permanent redirect so browsers + caches stop using the GET endpoint.
    // Password (if any) is NOT forwarded — clients re-send via POST body.
    res.redirect(308, `/api/files/download/${nodeId}`);
  }

  @Patch(':nodeId/rename')
  rename(
    @CurrentUser('id') userId: string,
    @Param('nodeId', ParseUUIDPipe) nodeId: string,
    @Body('name') name: string,
  ) {
    return this.filesService.rename(userId, nodeId, name);
  }

  @Patch(':nodeId/move')
  move(
    @CurrentUser('id') userId: string,
    @Param('nodeId', ParseUUIDPipe) nodeId: string,
    @Body('targetParentId') targetParentId: string,
  ) {
    return this.filesService.move(userId, nodeId, targetParentId);
  }

  @Post(':nodeId/copy')
  copy(
    @CurrentUser('id') userId: string,
    @Param('nodeId', ParseUUIDPipe) nodeId: string,
    @Body('targetParentId') targetParentId: string,
  ) {
    return this.filesService.copy(userId, nodeId, targetParentId);
  }

  @Delete()
  @HttpCode(200)
  softDelete(
    @CurrentUser('id') userId: string,
    @Body('nodeIds') nodeIds: string[],
  ) {
    return this.filesService.softDelete(userId, nodeIds);
  }

  @Get('trash')
  listTrash(@CurrentUser('id') userId: string) {
    return this.filesService.listTrash(userId);
  }

  @Post('trash/restore')
  restoreTrash(
    @CurrentUser('id') userId: string,
    @Body('nodeIds') nodeIds: string[],
  ) {
    return this.filesService.restoreTrash(userId, nodeIds);
  }

  @Delete('trash/permanent')
  @HttpCode(200)
  permanentDelete(
    @CurrentUser('id') userId: string,
    @Body('nodeIds') nodeIds: string[],
  ) {
    return this.filesService.permanentDelete(userId, nodeIds);
  }

  @Patch(':nodeId/lock')
  setLock(
    @CurrentUser('id') userId: string,
    @Param('nodeId', ParseUUIDPipe) nodeId: string,
    @Body('password') password: string,
  ) {
    return this.filesService.setLock(userId, nodeId, password);
  }

  // P1-B12: explicit unlock endpoint. setLock no longer accepts empty password
  // to clear protection — callers must verify current password here. Throttled
  // to match other auth-sensitive endpoints (10 / minute / IP).
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Delete(':nodeId/lock')
  @HttpCode(200)
  removeLock(
    @CurrentUser('id') userId: string,
    @Param('nodeId', ParseUUIDPipe) nodeId: string,
    @Body('password') password: string,
  ) {
    return this.filesService.removeLock(userId, nodeId, password);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post(':nodeId/verify-lock')
  @HttpCode(200)
  verifyLock(
    @CurrentUser('id') userId: string,
    @Param('nodeId', ParseUUIDPipe) nodeId: string,
    @Body('password') password: string,
  ) {
    return this.filesService.verifyLock(userId, nodeId, password);
  }

  @Post('move-private')
  moveToPrivate(
    @CurrentUser('id') userId: string,
    @Body('nodeIds') nodeIds: string[],
    @Body('private') toPrivate: boolean,
  ) {
    return this.filesService.moveToPrivate(userId, nodeIds, toPrivate);
  }

  @Get('search')
  search(
    @CurrentUser('id') userId: string,
    @Query('q') keyword: string,
    @Query('type') type: string,
    @Query('private') isPrivate: string,
    @Query('tagId') tagId?: string,
    @Query('semantic') semantic?: string,
  ) {
    if (semantic === 'true') {
      return this.filesService.semanticSearch(userId, keyword, isPrivate === 'true');
    }
    return this.filesService.search(userId, keyword, type, isPrivate === 'true', tagId);
  }

  @Patch(':nodeId/star')
  toggleStar(@CurrentUser('id') userId: string, @Param('nodeId') nodeId: string) {
    return this.filesService.toggleStar(userId, nodeId);
  }

  @Get('starred')
  listStarred(@CurrentUser('id') userId: string) {
    return this.filesService.listStarred(userId);
  }

  @Get('thumbnail/:nodeId')
  async thumbnail(
    @CurrentUser('id') userId: string,
    @Param('nodeId', ParseUUIDPipe) nodeId: string,
    @Res() res: Response,
  ) {
    const url = await this.filesService.getThumbnailUrl(userId, nodeId);
    if (!url) return res.status(404).send();
    res.redirect(302, url);
  }

  @Get(':nodeId/path')
  getPath(@CurrentUser('id') userId: string, @Param('nodeId') nodeId: string) {
    return this.filesService.getPath(userId, nodeId);
  }

  @Get('folder/:nodeId/download-list')
  getFolderDownloadList(@CurrentUser('id') userId: string, @Param('nodeId') nodeId: string) {
    return this.filesService.getFolderDownloadList(userId, nodeId);
  }

  // ─── Tags ─────────────────────────────────────────────────────────────────────

  @Get('tags')
  listTags(@CurrentUser('id') userId: string) {
    return this.filesService.listTags(userId);
  }

  @Post('tags')
  @HttpCode(201)
  createTag(@CurrentUser('id') userId: string, @Body('name') name: string, @Body('color') color?: string) {
    return this.filesService.createTag(userId, name, color);
  }

  @Delete('tags/:tagId')
  @HttpCode(200)
  deleteTag(@CurrentUser('id') userId: string, @Param('tagId', ParseUUIDPipe) tagId: string) {
    return this.filesService.deleteTag(userId, tagId);
  }

  @Post(':nodeId/tags')
  addTagToNode(@CurrentUser('id') userId: string, @Param('nodeId', ParseUUIDPipe) nodeId: string, @Body('tagId') tagId: string) {
    return this.filesService.addTagToNode(userId, nodeId, tagId);
  }

  @Delete(':nodeId/tags/:tagId')
  removeTagFromNode(
    @CurrentUser('id') userId: string,
    @Param('nodeId', ParseUUIDPipe) nodeId: string,
    @Param('tagId', ParseUUIDPipe) tagId: string,
  ) {
    return this.filesService.removeTagFromNode(userId, nodeId, tagId);
  }

  @Post(':nodeId/versions')
  createVersion(@CurrentUser('id') userId: string, @Param('nodeId') nodeId: string) {
    return this.filesService.createVersion(userId, nodeId);
  }

  @Get(':nodeId/versions')
  getVersions(@CurrentUser('id') userId: string, @Param('nodeId') nodeId: string) {
    return this.filesService.getVersions(userId, nodeId);
  }

  @Get(':nodeId/versions/:versionId/download')
  getVersionDownloadInfo(
    @CurrentUser('id') userId: string,
    @Param('nodeId', ParseUUIDPipe) nodeId: string,
    @Param('versionId') versionId: string,
  ) {
    return this.filesService.getVersionDownloadInfo(userId, nodeId, versionId);
  }

  @Post(':nodeId/file-request')
  createFileRequest(
    @CurrentUser('id') userId: string,
    @Param('nodeId', ParseUUIDPipe) nodeId: string,
    @Body('maxFiles') maxFiles = 100,
    @Body('ttlHours') ttlHours = 72,
  ) {
    return this.filesService.createFileRequest(userId, nodeId, maxFiles, ttlHours);
  }

  @Put(':nodeId/note')
  async setNote(
    @CurrentUser('id') userId: string,
    @Param('nodeId', ParseUUIDPipe) nodeId: string,
    @Body('note') note: string,
  ) {
    return this.filesService.setNote(userId, nodeId, note);
  }

  @Post('offline-download')
  @HttpCode(202)
  createOfflineDownload(
    @CurrentUser('id') userId: string,
    @Body('url') url: string,
    @Body('parentId') parentId: string,
    @Body('name') name: string,
  ) {
    return this.filesService.createOfflineDownload(userId, url, parentId, name);
  }

  // ─── Templates ──────────────────────────────────────────────────────

  @Get('templates')
  listTemplates(@CurrentUser('id') userId: string) {
    return this.templateService.list(userId);
  }

  @Post('templates')
  @HttpCode(201)
  createTemplate(
    @CurrentUser('id') userId: string,
    @Body('name') name: string,
    @Body('description') description: string,
    @Body('category') category: string,
    @Body('content') content: string,
  ) {
    return this.templateService.create(userId, name, description, category, content);
  }

  @Delete('templates/:templateId')
  @HttpCode(200)
  deleteTemplate(
    @CurrentUser('id') userId: string,
    @Param('templateId', ParseUUIDPipe) templateId: string,
  ) {
    return this.templateService.delete(userId, templateId);
  }

  @Get('templates/:templateId/content')
  getTemplateContent(
    @CurrentUser('id') userId: string,
    @Param('templateId', ParseUUIDPipe) templateId: string,
  ) {
    return this.templateService.getContent(userId, templateId);
  }

  // ─── Export ──────────────────────────────────────────────────────────

  @Post(':nodeId/export/pdf')
  async exportPdf(
    @CurrentUser('id') userId: string,
    @Param('nodeId', ParseUUIDPipe) nodeId: string,
    @Body('html') html: string,
    @Res() res: Response,
  ) {
    const { buffer, filename } = await this.exportService.exportPdf(userId, nodeId, html);
    res.set({
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
    });
    res.send(buffer);
  }

  @Post(':nodeId/export/docx')
  async exportDocx(
    @CurrentUser('id') userId: string,
    @Param('nodeId', ParseUUIDPipe) nodeId: string,
    @Body('html') html: string,
    @Res() res: Response,
  ) {
    const { buffer, filename } = await this.exportService.exportDocx(userId, nodeId, html);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
    });
    res.send(buffer);
  }

  @Post(':nodeId/export/markdown')
  async exportMarkdown(
    @CurrentUser('id') userId: string,
    @Param('nodeId', ParseUUIDPipe) nodeId: string,
    @Res() res: Response,
  ) {
    const { buffer, filename } = await this.exportService.exportMarkdown(userId, nodeId);
    res.set({
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
    });
    res.send(buffer);
  }

  @Throttle({ default: { ttl: 30000, limit: 10 } })
  @Get('sync/diff')
  async syncDiff(
    @CurrentUser('id') userId: string,
    @Query('since') since: string,
  ) {
    return this.filesService.getSyncDiff(userId, since);
  }

  /** DEV ONLY — serve local storage files. Disabled in production. */
  @Get('local-proxy/:key')
  async localProxy(@Param('key') key: string, @Res() res: Response) {
    if (process.env.NODE_ENV === 'production') {
      return res.status(404).json({ error: 'Not Found' });
    }
    // Path traversal protection: sanitize key before path.join()
    const SANE = /^[a-zA-Z0-9\-_]+$/;
    if (!key || key.length > 255 || !SANE.test(key)) {
      return res.status(400).json({ error: 'Invalid key' });
    }
    const fs = require('fs');
    const path = require('path');
    const dir = process.env.LOCAL_STORAGE_DIR || './local-storage';
    const resolved = path.resolve(dir, key);
    if (!resolved.startsWith(path.resolve(dir) + path.sep) && resolved !== path.resolve(dir)) {
      return res.status(400).json({ error: 'Invalid key' });
    }
    const filePath = resolved;
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }
    const metaPath = filePath + '.meta.json';
    const meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf-8')) : {};
    res.set({
      'Content-Type': meta.mimeType || 'application/octet-stream',
      'Content-Disposition': `inline; filename="${encodeURIComponent(meta.filename || key)}"`,
    });
    res.send(fs.readFileSync(filePath));
  }
}
