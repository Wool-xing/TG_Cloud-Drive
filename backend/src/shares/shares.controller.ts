import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { SharesService, CreateShareDto } from './shares.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';

@ApiTags('分享管理')
@ApiBearerAuth()
@Controller('shares')
export class SharesController {
  constructor(private readonly sharesService: SharesService) {}

  /**
   * POST /shares
   * Create a new share link for a file or folder. Requires authentication.
   */
  @Post()
  @ApiOperation({ summary: '创建分享链接' })
  create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateShareDto,
  ) {
    return this.sharesService.createShare(userId, dto);
  }

  /**
   * GET /shares/my
   * List all active shares created by the current user.
   * Must be declared BEFORE /:id to avoid route conflict.
   */
  @Get('my')
  @ApiOperation({ summary: '获取我的分享列表' })
  listMy(@CurrentUser('id') userId: string) {
    return this.sharesService.listMyShares(userId);
  }

  /**
   * GET /shares/access/:token
   * Public endpoint — no authentication required.
   * Optional query param `password` for password-protected shares.
   */
  @Public()
  @Get('access/:token')
  @ApiOperation({ summary: '访问分享链接（公开）' })
  @ApiQuery({ name: 'password', required: false, description: '分享密码（如有）' })
  access(
    @Param('token') token: string,
    @Query('password') password?: string,
  ) {
    return this.sharesService.accessShare(token, password);
  }

  /**
   * POST /shares/access/:token/download
   * Public — increment download count after a successful download.
   *
   * Password (if the share has one) MUST be re-validated here. Without that:
   *   - any anonymous client could POST repeatedly to drain maxDownloads (DoS),
   *   - or call once per fetched chunk to count multiple "downloads" for one
   *     real grab. accessShare(token, password) throws 401 on mismatch.
   * Throttle defends against brute-forcing tokens / passwords through this
   * endpoint (10 calls / minute / IP).
   */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('access/:token/download')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '记录下载次数（公开）' })
  async recordDownload(
    @Param('token') token: string,
    @Body() body: { password?: string } = {},
  ) {
    const shareInfo = await this.sharesService.accessShare(token, body?.password);
    await this.sharesService.incrementDownload(shareInfo.shareId);
  }

  /**
   * GET /shares/:id/token
   * P1-B17: dedicated endpoint to reveal the full share token. listMy now
   * returns truncated previews — callers (e.g. "copy link" UI) hit this to
   * get the real token. Audit-logged on the service side.
   */
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get(':id/token')
  @ApiOperation({ summary: '获取分享链接完整 token（仅创建者）' })
  getToken(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) shareId: string,
  ) {
    return this.sharesService.getShareToken(userId, shareId);
  }

  /**
   * DELETE /shares/:id
   * Deactivate a share. Only the owner can do this.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '删除（停用）分享链接' })
  delete(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) shareId: string,
  ) {
    return this.sharesService.deleteShare(userId, shareId);
  }
}
