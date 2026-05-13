import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
  ServiceUnavailableException,
  Inject,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { User, UserRole, UserStatus } from '../users/entities/user.entity';
import { NodeType } from '../files/entities/node.entity';
import { Device } from '../users/entities/device.entity';
import { AuditLog } from '../users/entities/audit-log.entity';
import { Node } from '../files/entities/node.entity';
import { REDIS_CLIENT } from '../common/redis/redis.module';
import { decryptField, encryptField, hashPassword, generateSalt } from '../common/encryption';
import { MailService } from '../mail/mail.service';

export interface UpdateUserAdminDto {
  role?: UserRole;
  status?: UserStatus;
  quotaBytes?: number;
  nickname?: string;
  username?: string;
}

export interface UpdateSystemConfigDto {
  [key: string]: any;
}

export interface CreateUserAdminDto {
  username: string;
  password: string;
  email?: string;
  phone?: string;
  role?: UserRole;
  nickname?: string;
  quotaGb?: number;
}

const SYSTEM_CONFIG_REDIS_KEY = 'system:config';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(Device) private deviceRepo: Repository<Device>,
    @InjectRepository(AuditLog) private auditRepo: Repository<AuditLog>,
    @InjectRepository(Node) private nodeRepo: Repository<Node>,
    @Inject(REDIS_CLIENT) private redis: any,
    private cs: ConfigService,
    private mailService: MailService,
  ) {}

  // ─── Users ───────────────────────────────────────────────────────────────────

  async listUsers(
    page = 1,
    limit = 20,
    search?: string,
  ): Promise<{ users: any[]; total: number; page: number; limit: number }> {
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(100, Math.max(1, limit));
    const masterKey = this.cs.get<string>('ENCRYPTION_MASTER_KEY');

    const qb = this.userRepo.createQueryBuilder('u').where('u.deleted_at IS NULL');

    if (search) {
      qb.andWhere(
        '(u.username ILIKE :search OR u.nickname ILIKE :search)',
        { search: `%${search}%` },
      );
    }

    qb.orderBy('u.created_at', 'DESC')
      .skip((safePage - 1) * safeLimit)
      .take(safeLimit);

    const [users, total] = await qb.getManyAndCount();

    const users_out = users.map(u => this.safeUserAdmin(u, masterKey));
    return { users: users_out, total, page: safePage, limit: safeLimit };
  }

  async updateUser(
    adminId: string,
    userId: string,
    dto: UpdateUserAdminDto,
  ): Promise<any> {
    if (adminId === userId) {
      throw new BadRequestException('不能修改自身账户角色或状态');
    }

    const user = await this.userRepo.findOne({ where: { id: userId, deletedAt: IsNull() } });
    if (!user) throw new NotFoundException('用户不存在');

    if (dto.username !== undefined) {
      const trimmed = dto.username.trim();
      if (!trimmed) throw new BadRequestException('用户名不能为空');
      if (trimmed !== user.username) {
        const existing = await this.userRepo.findOne({ where: { username: trimmed } });
        if (existing) throw new ConflictException('用户名已被使用');
        user.username = trimmed;
      }
    }
    if (dto.role !== undefined) user.role = dto.role;
    if (dto.status !== undefined) user.status = dto.status;
    if (dto.quotaBytes !== undefined) {
      if (dto.quotaBytes < 0) throw new BadRequestException('配额不能为负数');
      user.quotaBytes = dto.quotaBytes;
    }
    if (dto.nickname !== undefined) user.nickname = dto.nickname;

    await this.userRepo.save(user);
    await this.audit(adminId, 'admin.user.update', null, null, null, { targetUserId: userId });

    const masterKey = this.cs.get<string>('ENCRYPTION_MASTER_KEY');
    return this.safeUserAdmin(user, masterKey);
  }

  async deleteUser(adminId: string, userId: string): Promise<{ message: string }> {
    if (adminId === userId) {
      throw new BadRequestException('不能删除自己的账户');
    }

    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('用户不存在');

    // Physical delete (hard delete) so the username can be reused
    await this.deviceRepo.delete({ userId });
    await this.userRepo.delete(userId);

    await this.audit(adminId, 'admin.user.delete', null, null, null, { targetUserId: userId, username: user.username });
    return { message: '用户已删除' };
  }

  async forceLogout(adminId: string, userId: string): Promise<{ message: string }> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('用户不存在');

    // Delete all device sessions (refresh tokens immediately useless)
    const deleted = await this.deviceRepo.delete({ userId });

    // Fail-CLOSED: the redis flag is what rejects already-issued access tokens
    // (which can live up to JWT_EXPIRES_IN, currently 2h). If Redis is down the
    // admin MUST be told the force-logout is only partially in effect — devices
    // gone, but unexpired access tokens may still work.
    try {
      await this.redis.set(`force_logout:${userId}`, Date.now().toString(), 'EX', 86400);
    } catch (e) {
      throw new ServiceUnavailableException(
        `强制下线部分成功：已清空 ${deleted.affected ?? 0} 个设备会话，但 Redis 不可用，已签发的 access token 可能在过期前仍可使用。请稍后重试。`,
      );
    }

    await this.audit(adminId, 'admin.user.force_logout', null, null, null, {
      targetUserId: userId,
      devicesRevoked: deleted.affected,
    });
    return { message: `已强制退出 ${deleted.affected ?? 0} 个设备` };
  }

  // ─── Dashboard ───────────────────────────────────────────────────────────────

  async getDashboard(): Promise<any> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayUploads = await this.auditRepo
      .createQueryBuilder('a')
      .where("a.action = 'upload'")
      .andWhere('a.created_at >= :today', { today })
      .getCount();

    const storageResult = await this.userRepo
      .createQueryBuilder('u')
      .select('SUM(u.used_bytes)', 'totalUsed')
      .where('u.deleted_at IS NULL')
      .getRawOne();
    const totalStorageBytes = parseInt(storageResult?.totalUsed || '0', 10);

    const totalUsers = await this.userRepo.count({ where: { deletedAt: IsNull() } });

    // Recent 20 audit logs
    const recentLogsRaw = await this.auditRepo
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.user', 'u')
      .orderBy('a.created_at', 'DESC')
      .limit(20)
      .getMany();

    const recentLogs = recentLogsRaw.map(a => ({
      id: a.id,
      action: a.action,
      nodeName: a.nodeName,
      ipAddress: a.ipAddress,
      createdAt: a.createdAt,
      username: a.user?.username ?? null,
    }));

    // Top 10 users by storage usage
    const topStorageUsers = await this.userRepo
      .createQueryBuilder('u')
      .select(['u.id', 'u.username', 'u.nickname', 'u.usedBytes', 'u.quotaBytes'])
      .where('u.deleted_at IS NULL')
      .orderBy('u.usedBytes', 'DESC')
      .limit(10)
      .getMany();

    return {
      totalUsers,
      todayUploads,
      totalStorageBytes,
      tgApiSuccessRate: 100,
      recentLogs,
      topStorageUsers: topStorageUsers.map(u => ({
        id: u.id,
        username: u.username,
        nickname: u.nickname,
        usedBytes: Number(u.usedBytes),
        quotaBytes: Number(u.quotaBytes),
      })),
    };
  }

  // ─── Files ───────────────────────────────────────────────────────────────────

  async listAllFiles(
    page = 1,
    limit = 20,
    userId?: string,
    search?: string,
  ): Promise<{ files: any[]; total: number; page: number; limit: number }> {
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(100, Math.max(1, limit));

    // Build base filters without joins to avoid TypeORM DISTINCT+ORDER BY pagination bug
    const buildBase = () => {
      const qb = this.nodeRepo.createQueryBuilder('n')
        .where('n.deleted_at IS NULL')
        .andWhere('n.is_private = :isPrivate', { isPrivate: false })
        .andWhere('n.type = :nodeType', { nodeType: NodeType.FILE });
      if (userId) qb.andWhere('n.user_id = :userId', { userId });
      if (search) qb.andWhere('n.name ILIKE :search', { search: `%${search}%` });
      return qb;
    };

    const total = await buildBase().getCount();

    // Step 1: get paginated IDs with no joins (safe LIMIT/OFFSET)
    const idRows = await buildBase()
      .select('n.id')
      .orderBy('n.createdAt', 'DESC')
      .skip((safePage - 1) * safeLimit)
      .take(safeLimit)
      .getMany();

    if (idRows.length === 0) {
      return { files: [], total, page: safePage, limit: safeLimit };
    }

    // Step 2: load full data + user info by IDs (no pagination, no DISTINCT issue)
    const nodeIds = idRows.map(n => n.id);
    const nodes = await this.nodeRepo
      .createQueryBuilder('n')
      .leftJoinAndSelect('n.user', 'u')
      .where('n.id IN (:...nodeIds)', { nodeIds })
      .orderBy('n.createdAt', 'DESC')
      .getMany();

    const items = nodes.map(n => ({
      id: n.id,
      name: n.name,
      size: Number(n.size),
      mimeType: n.mimeType,
      md5Plain: n.md5Plain,
      userId: n.userId,
      username: n.user?.username ?? null,
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
    }));

    return { files: items, total, page: safePage, limit: safeLimit };
  }

  async deleteFileAdmin(
    adminId: string,
    nodeId: string,
  ): Promise<{ message: string }> {
    const node = await this.nodeRepo.findOne({ where: { id: nodeId, deletedAt: IsNull() } });
    if (!node) throw new NotFoundException('文件不存在');

    node.deletedAt = new Date();
    await this.nodeRepo.save(node);

    await this.audit(adminId, 'admin.file.delete', nodeId, null, null, {
      fileName: node.name,
      ownerId: node.userId,
    });

    return { message: '文件已删除' };
  }

  // ─── System Config ────────────────────────────────────────────────────────────

  async getSystemConfig(): Promise<any> {
    // Base config from environment, using frontend-compatible field names
    const envConfig: Record<string, any> = {
      defaultQuotaGB: this.cs.get<number>('DEFAULT_USER_QUOTA_GB') ?? 10,
      maxFoldersPerDir: this.cs.get<number>('MAX_FOLDERS_PER_DIR') ?? 1000,
      registrationMode: 'open',
      fileTypeBlacklist: [],
      verificationCodeTTL: 600,
      loginFailLockCount: this.cs.get<number>('LOGIN_LOCK_ATTEMPTS') ?? 5,
      loginLockDuration: (this.cs.get<number>('LOGIN_LOCK_MINUTES') ?? 15) * 60,
      shareDefaultExpireDays: 7,
      cfWorkersUrl: this.cs.get<string>('CF_WORKERS_URL') ?? '',
      smtp: {
        host: this.cs.get<string>('SMTP_HOST') ?? '',
        port: this.cs.get<number>('SMTP_PORT') ?? 587,
        user: this.cs.get<string>('SMTP_USER') ?? '',
        pass: '',
        from: this.cs.get<string>('SMTP_FROM') ?? '',
      },
    };

    // Merge runtime overrides from Redis
    let runtimeConfig: Record<string, any> = {};
    try {
      const raw = await this.redis.get(SYSTEM_CONFIG_REDIS_KEY);
      if (raw) runtimeConfig = JSON.parse(raw);
    } catch (err) {
      this.logger.warn(`Redis get system config failed: ${err.message}`);
    }

    const merged = { ...envConfig, ...runtimeConfig };
    // Always merge smtp as object (not override)
    if (runtimeConfig.smtp) {
      merged.smtp = { ...envConfig.smtp, ...runtimeConfig.smtp };
    }
    return merged;
  }

  async updateSystemConfig(
    adminId: string,
    dto: UpdateSystemConfigDto,
  ): Promise<any> {
    const allowedKeys = new Set([
      'defaultQuotaGB',
      'maxFoldersPerDir',
      'registrationMode',
      'fileTypeBlacklist',
      'verificationCodeTTL',
      'loginFailLockCount',
      'loginLockDuration',
      'shareDefaultExpireDays',
      'cfWorkersUrl',
      'smtp',
    ]);

    const sanitized: Record<string, any> = {};
    for (const [k, v] of Object.entries(dto)) {
      if (allowedKeys.has(k)) sanitized[k] = v;
    }

    if (Object.keys(sanitized).length === 0) {
      throw new BadRequestException('没有可更新的合法配置项');
    }

    // Merge with existing runtime config
    let existing: Record<string, any> = {};
    try {
      const raw = await this.redis.get(SYSTEM_CONFIG_REDIS_KEY);
      if (raw) existing = JSON.parse(raw);
    } catch {}

    const merged = { ...existing, ...sanitized };
    // Merge smtp as object
    if (sanitized.smtp && existing.smtp) {
      merged.smtp = { ...existing.smtp, ...sanitized.smtp };
    }
    await this.redis.set(SYSTEM_CONFIG_REDIS_KEY, JSON.stringify(merged));

    await this.audit(adminId, 'admin.config.update', null, null, null, { updated: Object.keys(sanitized) });
    return merged;
  }

  // ─── Audit Logs ───────────────────────────────────────────────────────────────

  async getAuditLogs(
    page = 1,
    limit = 20,
    userId?: string,
    action?: string,
  ): Promise<{ items: any[]; total: number; page: number; limit: number }> {
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(200, Math.max(1, limit));

    const qb = this.auditRepo
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.user', 'u');

    if (userId) qb.andWhere('a.user_id = :userId', { userId });
    if (action) qb.andWhere('a.action ILIKE :action', { action: `%${action}%` });

    qb.orderBy('a.created_at', 'DESC')
      .skip((safePage - 1) * safeLimit)
      .take(safeLimit);

    const [items, total] = await qb.getManyAndCount();

    const mapped = items.map(a => ({
      id: a.id,
      userId: a.userId,
      username: a.user?.username ?? null,
      action: a.action,
      nodeId: a.nodeId,
      nodeName: a.nodeName,
      ipAddress: a.ipAddress,
      userAgent: a.userAgent,
      metadata: a.metadata,
      createdAt: a.createdAt,
    }));

    return { items: mapped, total, page: safePage, limit: safeLimit };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  private safeUserAdmin(user: User, masterKey?: string): any {
    let email: string | null = null;
    let phone: string | null = null;

    if (masterKey) {
      try {
        if (user.emailEncrypted) email = decryptField(user.emailEncrypted, masterKey);
      } catch {}
      try {
        if (user.phoneEncrypted) phone = decryptField(user.phoneEncrypted, masterKey);
      } catch {}
    }

    return {
      id: user.id,
      username: user.username,
      nickname: user.nickname,
      avatar: user.avatar,
      email,
      phone,
      role: user.role,
      status: user.status,
      quotaBytes: Number(user.quotaBytes),
      usedBytes: Number(user.usedBytes),
      loginAttempts: user.loginAttempts,
      lockedUntil: user.lockedUntil,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  // ─── Create User (admin) ──────────────────────────────────────────────────────

  async createUser(adminId: string, dto: CreateUserAdminDto): Promise<any> {
    const { username, password, email, phone, role, nickname, quotaGb } = dto;
    const exists = await this.userRepo.findOne({ where: { username } });
    if (exists) throw new BadRequestException('用户名已存在');

    const masterKey = this.cs.get<string>('ENCRYPTION_MASTER_KEY');
    const passwordHash = await hashPassword(password);
    const mekSalt = generateSalt();
    const defaultQuota = (quotaGb || this.cs.get<number>('DEFAULT_USER_QUOTA_GB', 50)) * 1024 * 1024 * 1024;

    const user = this.userRepo.create({
      username, passwordHash, mekSalt, nickname,
      role: role || UserRole.USER,
      quotaBytes: defaultQuota,
      emailEncrypted: email && masterKey ? encryptField(email, masterKey) : null,
      phoneEncrypted: phone && masterKey ? encryptField(phone, masterKey) : null,
    });
    await this.userRepo.save(user);
    await this.audit(adminId, 'admin.user.create', null, null, null, { targetUser: username });
    return this.safeUserAdmin(user, masterKey);
  }

  // ─── Test Email ───────────────────────────────────────────────────────────────

  async testEmail(adminId: string, to: string): Promise<{ message: string }> {
    if (!to || !to.includes('@')) throw new BadRequestException('请提供有效的邮箱地址');
    await this.mailService.sendVerificationCode(to, '123456');
    await this.audit(adminId, 'admin.test-email', null, null, null, { to });
    return { message: `测试邮件已发送至 ${to}，请检查收件箱` };
  }

  private async audit(
    userId: string,
    action: string,
    nodeId: string | null,
    ip: string | null,
    ua: string | null,
    metadata?: Record<string, any>,
  ): Promise<void> {
    try {
      await this.auditRepo.save(
        this.auditRepo.create({ userId, action, nodeId, ipAddress: ip, userAgent: ua, metadata }),
      );
    } catch (err) {
      this.logger.warn(`Audit log failed: ${err.message}`);
    }
  }
}
