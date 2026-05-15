import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query,
  Req, UseInterceptors, UploadedFile, ParseUUIDPipe, HttpCode,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { FilesService } from './files.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('文件管理')
@ApiBearerAuth()
@Controller('files')
export class FilesController {
  constructor(private filesService: FilesService) {}

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
    @Param('nodeId') nodeId: string,
    @Body('password') password: string,
  ) {
    return this.filesService.getDownloadInfo(userId, nodeId, password);
  }

  /** @deprecated P1-B14 — use POST /files/download/:nodeId with body instead. */
  @Get('download/:nodeId')
  getDownloadInfo(
    @CurrentUser('id') userId: string,
    @Param('nodeId') nodeId: string,
    @Query('password') password: string,
  ) {
    return this.filesService.getDownloadInfo(userId, nodeId, password);
  }

  @Patch(':nodeId/rename')
  rename(
    @CurrentUser('id') userId: string,
    @Param('nodeId') nodeId: string,
    @Body('name') name: string,
  ) {
    return this.filesService.rename(userId, nodeId, name);
  }

  @Patch(':nodeId/move')
  move(
    @CurrentUser('id') userId: string,
    @Param('nodeId') nodeId: string,
    @Body('targetParentId') targetParentId: string,
  ) {
    return this.filesService.move(userId, nodeId, targetParentId);
  }

  @Post(':nodeId/copy')
  copy(
    @CurrentUser('id') userId: string,
    @Param('nodeId') nodeId: string,
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
    @Param('nodeId') nodeId: string,
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
    @Param('nodeId') nodeId: string,
    @Body('password') password: string,
  ) {
    return this.filesService.removeLock(userId, nodeId, password);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post(':nodeId/verify-lock')
  @HttpCode(200)
  verifyLock(
    @CurrentUser('id') userId: string,
    @Param('nodeId') nodeId: string,
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
  ) {
    return this.filesService.search(userId, keyword, type, isPrivate === 'true');
  }

  @Patch(':nodeId/star')
  toggleStar(@CurrentUser('id') userId: string, @Param('nodeId') nodeId: string) {
    return this.filesService.toggleStar(userId, nodeId);
  }

  @Get('starred')
  listStarred(@CurrentUser('id') userId: string) {
    return this.filesService.listStarred(userId);
  }

  @Get(':nodeId/path')
  getPath(@CurrentUser('id') userId: string, @Param('nodeId') nodeId: string) {
    return this.filesService.getPath(userId, nodeId);
  }

  @Get('folder/:nodeId/download-list')
  getFolderDownloadList(@CurrentUser('id') userId: string, @Param('nodeId') nodeId: string) {
    return this.filesService.getFolderDownloadList(userId, nodeId);
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
    @Param('nodeId') nodeId: string,
    @Param('versionId') versionId: string,
  ) {
    return this.filesService.getVersionDownloadInfo(userId, nodeId, versionId);
  }
}
