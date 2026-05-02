import {
  Controller,
  Get,
  Patch,
  Post,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  ParseIntPipe,
  DefaultValuePipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import {
  AdminService,
  UpdateUserAdminDto,
  UpdateSystemConfigDto,
  CreateUserAdminDto,
} from './admin.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('管理员')
@ApiBearerAuth()
@Roles('admin')
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  // ─── Dashboard ───────────────────────────────────────────────────────────────

  /**
   * GET /admin/dashboard
   */
  @Get('dashboard')
  @ApiOperation({ summary: '获取控制台概览数据' })
  getDashboard() {
    return this.adminService.getDashboard();
  }

  // ─── Users ───────────────────────────────────────────────────────────────────

  /**
   * GET /admin/users?page=1&limit=20&search=xxx
   */
  @Get('users')
  @ApiOperation({ summary: '获取用户列表' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'search', required: false, type: String })
  listUsers(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('search') search?: string,
  ) {
    return this.adminService.listUsers(page, limit, search);
  }

  /**
   * POST /admin/users — create user directly (no verification code)
   */
  @Post('users')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '管理员直接创建用户（跳过验证码）' })
  createUser(
    @CurrentUser('id') adminId: string,
    @Body() dto: CreateUserAdminDto,
  ) {
    return this.adminService.createUser(adminId, dto);
  }

  /**
   * PATCH /admin/users/:id
   */
  @Patch('users/:id')
  @ApiOperation({ summary: '更新用户信息（角色/状态/配额等）' })
  updateUser(
    @CurrentUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) userId: string,
    @Body() dto: UpdateUserAdminDto,
  ) {
    return this.adminService.updateUser(adminId, userId, dto);
  }

  /**
   * DELETE /admin/users/:id
   */
  @Delete('users/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '软删除用户' })
  deleteUser(
    @CurrentUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) userId: string,
  ) {
    return this.adminService.deleteUser(adminId, userId);
  }

  /**
   * POST /admin/users/:id/force-logout
   */
  @Post('users/:id/force-logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '强制用户下线（删除所有设备会话）' })
  forceLogout(
    @CurrentUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) userId: string,
  ) {
    return this.adminService.forceLogout(adminId, userId);
  }

  // ─── Files ───────────────────────────────────────────────────────────────────

  /**
   * GET /admin/files?page=1&limit=20&userId=xxx&search=xxx
   */
  @Get('files')
  @ApiOperation({ summary: '查看所有文件（不含私密文件）' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'userId', required: false, type: String })
  @ApiQuery({ name: 'search', required: false, type: String })
  listFiles(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('userId') userId?: string,
    @Query('search') search?: string,
  ) {
    return this.adminService.listAllFiles(page, limit, userId, search);
  }

  /**
   * DELETE /admin/files/:nodeId
   */
  @Delete('files/:nodeId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '管理员删除任意文件' })
  deleteFile(
    @CurrentUser('id') adminId: string,
    @Param('nodeId', ParseUUIDPipe) nodeId: string,
  ) {
    return this.adminService.deleteFileAdmin(adminId, nodeId);
  }

  // ─── Audit Logs ───────────────────────────────────────────────────────────────

  /**
   * GET /admin/audit-logs?page=1&limit=20&userId=xxx&action=xxx
   */
  @Get('audit-logs')
  @ApiOperation({ summary: '查看全局操作日志' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'userId', required: false, type: String })
  @ApiQuery({ name: 'action', required: false, type: String })
  getAuditLogs(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('userId') userId?: string,
    @Query('action') action?: string,
  ) {
    return this.adminService.getAuditLogs(page, limit, userId, action);
  }

  // ─── System Config ─────────────────────────────────────────────────────────────

  /**
   * GET /admin/config
   */
  @Get('config')
  @ApiOperation({ summary: '获取系统配置' })
  getConfig() {
    return this.adminService.getSystemConfig();
  }

  /**
   * PATCH /admin/config
   */
  @Patch('config')
  @ApiOperation({ summary: '更新系统运行时配置（存储至Redis）' })
  updateConfig(
    @CurrentUser('id') adminId: string,
    @Body() dto: UpdateSystemConfigDto,
  ) {
    return this.adminService.updateSystemConfig(adminId, dto);
  }

  /**
   * POST /admin/test-email — send a test email to verify SMTP config
   */
  @Post('test-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '发送测试邮件验证 SMTP 配置' })
  testEmail(
    @CurrentUser('id') adminId: string,
    @Body('to') to: string,
  ) {
    return this.adminService.testEmail(adminId, to);
  }
}
