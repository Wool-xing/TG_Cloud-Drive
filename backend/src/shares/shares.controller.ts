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
   */
  @Public()
  @Post('access/:token/download')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '记录下载次数（公开）' })
  async recordDownload(@Param('token') token: string) {
    // We need to look up the shareId from token first;
    // delegate entirely to service to keep controller thin.
    const shareInfo = await this.sharesService.accessShare(token);
    await this.sharesService.incrementDownload(shareInfo.shareId);
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
