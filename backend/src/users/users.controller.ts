import {
  Controller,
  Get,
  Patch,
  Post,
  Delete,
  Body,
  Param,
  Query,
  Req,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
  DefaultValuePipe,
  ParseUUIDPipe,
} from '@nestjs/common';
import { Request } from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import {
  UsersService,
  UpdateProfileDto,
  ChangePasswordDto,
  SetPrivateSpaceDto,
} from './users.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('用户')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /**
   * GET /users/profile
   * Returns the authenticated user's full profile with decrypted email/phone.
   */
  @Get('profile')
  @ApiOperation({ summary: '获取个人资料' })
  getProfile(@CurrentUser('id') userId: string) {
    return this.usersService.getProfile(userId);
  }

  /**
   * PATCH /users/profile
   * Update nickname and/or avatar.
   */
  @Patch('profile')
  @ApiOperation({ summary: '更新个人资料' })
  updateProfile(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.usersService.updateProfile(userId, dto);
  }

  /**
   * POST /users/change-password
   */
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '修改密码' })
  changePassword(
    @CurrentUser('id') userId: string,
    @Body() dto: ChangePasswordDto,
    @Req() req: Request,
  ) {
    const ip = req.ip;
    const ua = req.headers['user-agent'];
    return this.usersService.changePassword(userId, dto, ip, ua);
  }

  /**
   * GET /users/devices
   * List all logged-in devices.
   */
  @Get('devices')
  @ApiOperation({ summary: '获取登录设备列表' })
  getDevices(@CurrentUser('id') userId: string) {
    return this.usersService.getDevices(userId);
  }

  /**
   * DELETE /users/devices/:deviceId
   * Revoke (log out) a specific device.
   */
  @Delete('devices/:deviceId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '撤销设备登录' })
  revokeDevice(
    @CurrentUser('id') userId: string,
    @Param('deviceId', ParseUUIDPipe) deviceId: string,
    @Req() req: Request,
  ) {
    return this.usersService.revokeDevice(userId, deviceId, req.ip, req.headers['user-agent']);
  }

  /**
   * POST /users/private-space/setup
   * Set or change the private space password.
   */
  @Post('private-space/setup')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '设置私密空间密码' })
  setupPrivateSpace(
    @CurrentUser('id') userId: string,
    @Body() dto: SetPrivateSpaceDto,
    @Req() req: Request,
  ) {
    return this.usersService.setPrivateSpacePassword(userId, dto, req.ip, req.headers['user-agent']);
  }

  /**
   * POST /users/private-space/verify
   * Verify private space password and receive a short-lived session token.
   */
  @Post('private-space/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '验证私密空间密码' })
  verifyPrivateSpace(
    @CurrentUser('id') userId: string,
    @Body('password') password: string,
    @Req() req: Request,
  ) {
    return this.usersService.verifyPrivateSpace(userId, password, req.ip, req.headers['user-agent']);
  }

  /**
   * GET /users/audit-logs?page=1&limit=20
   */
  @Get('audit-logs')
  @ApiOperation({ summary: '获取操作日志' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  getAuditLogs(
    @CurrentUser('id') userId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.usersService.getAuditLogs(userId, page, limit);
  }

  /**
   * GET /users/stats
   * Storage used/total, file count by type.
   */
  @Get('stats')
  @ApiOperation({ summary: '获取存储统计' })
  getStats(@CurrentUser('id') userId: string) {
    return this.usersService.getUserStats(userId);
  }
}
