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
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import {
  UsersService,
  UpdateProfileDto,
  ChangePasswordDto,
  SetPrivateSpaceDto,
} from './users.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';

// P1-A4: explicit DTO classes so ValidationPipe (registered globally) actually
// runs class-validator over the body. The legacy SetPrivateSpaceDto in
// users.service is an interface — TypeScript types are erased at runtime, so
// interface-typed @Body() params were accepted as-is (including null / number /
// nested objects), letting malformed payloads reach service-layer code that
// expected strings. These class DTOs replace the controller-facing type.

class SetPrivateSpacePasswordDto {
  @IsString()
  @MinLength(8, { message: '私密空间密码至少需要 8 位' })
  @MaxLength(128)
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  currentPassword?: string;
}

class VerifyPrivateSpacePasswordDto {
  @IsString()
  @MinLength(1, { message: '请输入密码' })
  @MaxLength(128)
  password!: string;
}

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
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
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
   * A8 POST /users/change-password/send-code
   * Sends a 6-digit email OTP to the authenticated user's bound email.
   * Rate-limited per IP (controller) + per-target (verification.service).
   */
  @Post('change-password/send-code')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({ summary: '获取改密码邮箱验证码' })
  sendChangePasswordCode(@CurrentUser('id') userId: string) {
    return this.usersService.sendChangePasswordCode(userId);
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
    @Body() dto: SetPrivateSpacePasswordDto,
    @Req() req: Request,
  ) {
    return this.usersService.setPrivateSpacePassword(userId, dto, req.ip, req.headers['user-agent']);
  }

  /**
   * POST /users/private-space/verify
   * Verify private space password and receive a short-lived session token.
   */
  // P1-A3: tight per-IP rate limit on private-space password verification.
  // Without this, attackers who already hold a stolen access token could
  // brute-force the private-space password from anywhere. Pair with the
  // per-user fail counter in users.service.verifyPrivateSpace (5 attempts → 15-min lock).
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('private-space/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '验证私密空间密码' })
  verifyPrivateSpace(
    @CurrentUser('id') userId: string,
    @Body() dto: VerifyPrivateSpacePasswordDto,
    @Req() req: Request,
  ) {
    return this.usersService.verifyPrivateSpace(userId, dto.password, req.ip, req.headers['user-agent']);
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
