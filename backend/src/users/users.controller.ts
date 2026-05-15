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
import { IsEmail, IsMobilePhone, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import {
  UsersService,
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

class SendBindEmailCodeDto {
  @IsEmail({}, { message: '邮箱格式不正确' })
  @MaxLength(200)
  email!: string;
}

// Promoted from `interface` in users.service.ts. Interfaces are erased at
// runtime so ValidationPipe couldn't run class-validator on them — any
// payload (null username, oversized fields, wrong types) reached the
// service unchecked. Class form makes validation actually fire.
class UpdateProfileDto {
  @IsOptional() @IsString() @MaxLength(50)
  username?: string;

  @IsOptional() @IsString() @MaxLength(255)
  nickname?: string;

  @IsOptional() @IsString() @MaxLength(500)
  avatar?: string;

  // notifications kept as `any`-shaped object because the service writes it
  // through to a JSON column without per-field business logic; validating
  // its shape belongs to the notifications feature, not this controller.
  @IsOptional()
  notifications?: any;
}

class ChangePasswordDto {
  @IsString() @MinLength(1) @MaxLength(128)
  oldPassword!: string;

  // Same regex as RegisterDto/ResetPasswordDto for consistency. Without it,
  // a 1-character "new" password would pass class-validator and only hit
  // the length check in service — easy to forget when the API evolves.
  @IsString()
  @MinLength(8) @MaxLength(64)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^a-zA-Z\d])/, {
    message: '密码必须包含大小写字母、数字和特殊字符',
  })
  newPassword!: string;

  // A8: required by service when an email is bound. Optional at DTO level
  // because email-less accounts use the legacy single-factor path.
  @IsOptional() @IsString() @MinLength(6) @MaxLength(6)
  emailCode?: string;
}

class SendBindPhoneCodeDto {
  @IsMobilePhone('zh-CN', {}, { message: '手机号格式不正确' })
  @MaxLength(20)
  phone!: string;
}

class BindPhoneDto {
  @IsMobilePhone('zh-CN', {}, { message: '手机号格式不正确' })
  @MaxLength(20)
  phone!: string;

  @IsString() @MinLength(6) @MaxLength(6)
  code!: string;

  @IsOptional() @IsString() @MinLength(6) @MaxLength(6)
  oldPhoneCode?: string;
}

class BindEmailDto {
  @IsEmail({}, { message: '邮箱格式不正确' })
  @MaxLength(200)
  email!: string;

  @IsString()
  @MinLength(6)
  @MaxLength(6)
  code!: string;

  // A11: required server-side when changing an already-bound email.
  // Optional in the DTO so first-time bind doesn't need it.
  @IsOptional()
  @IsString()
  @MinLength(6)
  @MaxLength(6)
  oldEmailCode?: string;
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
   * A8 follow-up POST /users/bind-email/send-code
   * Sends an OTP to the *new* email address. Auth-required so the session
   * proves account control, and the OTP proves inbox control — both needed
   * to bind. Same throttle profile as change-password OTP.
   */
  @Post('bind-email/send-code')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({ summary: '获取绑定/更换邮箱验证码' })
  sendBindEmailCode(
    @CurrentUser('id') userId: string,
    @Body() dto: SendBindEmailCodeDto,
  ) {
    return this.usersService.sendBindEmailCode(userId, dto.email);
  }

  /**
   * A11 POST /users/bind-email/send-code-old
   * Sends an OTP to the user's currently-bound email — used as the old-side
   * factor when changing email. First-time bind doesn't need it (no old side).
   */
  @Post('bind-email/send-code-old')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({ summary: '获取换邮箱旧邮箱验证码' })
  sendBindEmailOldCode(@CurrentUser('id') userId: string) {
    return this.usersService.sendBindEmailOldCode(userId);
  }

  /**
   * A8 follow-up POST /users/bind-email
   * Atomically updates emailEncrypted + emailHash after OTP verification.
   * A11: when an email is already bound, an oldEmailCode is also required.
   */
  @Post('bind-email')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: '绑定/更换邮箱' })
  bindEmail(
    @CurrentUser('id') userId: string,
    @Body() dto: BindEmailDto,
    @Req() req: Request,
  ) {
    return this.usersService.bindEmail(
      userId, dto.email, dto.code, dto.oldEmailCode, req.ip, req.headers['user-agent'],
    );
  }

  // ─── Bind / Change Phone ──────────────────────────────────────────────
  // Same shape as bind-email above. See users.service.ts for the dual-
  // confirm rationale (first-time bind single-factor, change-phone needs
  // OTP to both old and new numbers). Dev mode returns the code in the
  // response; prod needs an SMS gateway wired into VerificationService.

  @Post('bind-phone/send-code')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({ summary: '获取绑定/更换手机号验证码' })
  sendBindPhoneCode(
    @CurrentUser('id') userId: string,
    @Body() dto: SendBindPhoneCodeDto,
  ) {
    return this.usersService.sendBindPhoneCode(userId, dto.phone);
  }

  @Post('bind-phone/send-code-old')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({ summary: '获取换手机号旧号验证码' })
  sendBindPhoneOldCode(@CurrentUser('id') userId: string) {
    return this.usersService.sendBindPhoneOldCode(userId);
  }

  @Post('bind-phone')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: '绑定/更换手机号' })
  bindPhone(
    @CurrentUser('id') userId: string,
    @Body() dto: BindPhoneDto,
    @Req() req: Request,
  ) {
    return this.usersService.bindPhone(
      userId, dto.phone, dto.code, dto.oldPhoneCode, req.ip, req.headers['user-agent'],
    );
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
