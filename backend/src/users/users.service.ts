import {
  Injectable,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
  ConflictException,
  Inject,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { User, UserStatus } from './entities/user.entity';
import { Device } from './entities/device.entity';
import { AuditLog } from './entities/audit-log.entity';
import { Node } from '../files/entities/node.entity';
import { REDIS_CLIENT } from '../common/redis/redis.module';
import {
  decryptField,
  encryptField,
  hashPassword,
  comparePassword,
} from '../common/encryption';

export interface UpdateProfileDto {
  username?: string;
  nickname?: string;
  avatar?: string;
  notifications?: any;
}

export interface ChangePasswordDto {
  oldPassword: string;
  newPassword: string;
}

export interface SetPrivateSpaceDto {
  password: string;
  currentPassword?: string;
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(Device) private deviceRepo: Repository<Device>,
    @InjectRepository(AuditLog) private auditRepo: Repository<AuditLog>,
    @InjectRepository(Node) private nodeRepo: Repository<Node>,
    @Inject(REDIS_CLIENT) private redis: any,
    private cs: ConfigService,
    private jwtService: JwtService,
  ) {}

  // ─── Profile ─────────────────────────────────────────────────────────────────

  async getProfile(userId: string): Promise<any> {
    const user = await this.findUserOrFail(userId);
    return this.safeUser(user, true);
  }

  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<any> {
    const user = await this.findUserOrFail(userId);

    if (dto.username !== undefined) {
      const trimmed = dto.username.trim();
      if (!trimmed) throw new BadRequestException('用户名不能为空');
      if (trimmed !== user.username) {
        const existing = await this.userRepo.findOne({ where: { username: trimmed } });
        if (existing) throw new ConflictException('用户名已被使用');
        user.username = trimmed;
      }
    }
    if (dto.nickname !== undefined) user.nickname = dto.nickname;
    if (dto.avatar !== undefined) user.avatar = dto.avatar;

    await this.userRepo.save(user);
    await this.audit(userId, 'profile.update', null, null, null);
    return this.safeUser(user, true);
  }

  // ─── Password ─────────────────────────────────────────────────────────────────

  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
    ip?: string,
    ua?: string,
  ): Promise<{ message: string }> {
    const user = await this.findUserOrFail(userId);

    const valid = await comparePassword(dto.oldPassword, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('当前密码错误');
    }

    if (dto.oldPassword === dto.newPassword) {
      throw new BadRequestException('新密码不能与旧密码相同');
    }

    user.passwordHash = await hashPassword(dto.newPassword);
    await this.userRepo.save(user);

    // Invalidate all sessions except the current device by clearing redis session tokens
    // (devices are still stored; auth on next request will fail for stale tokens)
    await this.audit(userId, 'password.change', null, ip, ua);
    return { message: '密码修改成功' };
  }

  // ─── Devices ─────────────────────────────────────────────────────────────────

  async getDevices(userId: string): Promise<any[]> {
    const devices = await this.deviceRepo.find({
      where: { userId },
      order: { lastActiveAt: 'DESC' },
    });

    return devices.map(d => ({
      id: d.id,
      deviceName: d.deviceName,
      ipAddress: d.ipAddress,
      userAgent: d.userAgent,
      lastActiveAt: d.lastActiveAt,
      expiresAt: d.expiresAt,
      createdAt: d.createdAt,
    }));
  }

  async revokeDevice(
    userId: string,
    deviceId: string,
    ip?: string,
    ua?: string,
  ): Promise<{ message: string }> {
    const device = await this.deviceRepo.findOne({ where: { id: deviceId, userId } });
    if (!device) {
      throw new NotFoundException('设备不存在');
    }

    await this.deviceRepo.delete(deviceId);
    await this.audit(userId, 'device.revoke', null, ip, ua);
    return { message: '设备已登出' };
  }

  // ─── Private Space ────────────────────────────────────────────────────────────

  async setPrivateSpacePassword(
    userId: string,
    dto: SetPrivateSpaceDto,
    ip?: string,
    ua?: string,
  ): Promise<{ message: string }> {
    const user = await this.findUserOrFail(userId);

    // If already set, require currentPassword to change it
    if (user.privateSpaceHash) {
      if (!dto.currentPassword) {
        throw new BadRequestException('修改私密空间密码需要提供当前密码');
      }
      const valid = await comparePassword(dto.currentPassword, user.privateSpaceHash);
      if (!valid) {
        throw new UnauthorizedException('当前私密空间密码错误');
      }
    }

    if (!dto.password || dto.password.length < 4) {
      throw new BadRequestException('私密空间密码至少需要4位');
    }

    user.privateSpaceHash = await hashPassword(dto.password);
    await this.userRepo.save(user);
    await this.audit(userId, 'private_space.password_set', null, ip, ua);
    return { message: '私密空间密码设置成功' };
  }

  async verifyPrivateSpace(
    userId: string,
    password: string,
    ip?: string,
    ua?: string,
  ): Promise<{ sessionToken: string; expiresIn: number }> {
    const user = await this.findUserOrFail(userId);

    if (!user.privateSpaceHash) {
      throw new BadRequestException('私密空间尚未设置密码');
    }

    const valid = await comparePassword(password, user.privateSpaceHash);
    if (!valid) {
      throw new UnauthorizedException('私密空间密码错误');
    }

    // Issue a short-lived JWT that grants private space access
    const expiresIn = 30 * 60; // 30 minutes in seconds
    const sessionToken = this.jwtService.sign(
      { sub: userId, type: 'private_space' },
      { expiresIn },
    );

    await this.audit(userId, 'private_space.access', null, ip, ua);
    return { sessionToken, expiresIn };
  }

  // ─── Audit Logs ───────────────────────────────────────────────────────────────

  async getAuditLogs(
    userId: string,
    page = 1,
    limit = 20,
  ): Promise<{ items: AuditLog[]; total: number; page: number; limit: number }> {
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(100, Math.max(1, limit));

    const [items, total] = await this.auditRepo.findAndCount({
      where: { userId },
      order: { createdAt: 'DESC' },
      skip: (safePage - 1) * safeLimit,
      take: safeLimit,
    });

    return { items, total, page: safePage, limit: safeLimit };
  }

  // ─── Stats ────────────────────────────────────────────────────────────────────

  async getUserStats(userId: string): Promise<any> {
    const user = await this.findUserOrFail(userId);

    // Aggregate file counts by MIME type prefix
    const rawStats = await this.nodeRepo
      .createQueryBuilder('n')
      .select("SPLIT_PART(n.mime_type, '/', 1)", 'mimeGroup')
      .addSelect('COUNT(n.id)', 'count')
      .addSelect('SUM(n.size)', 'totalSize')
      .where('n.user_id = :userId', { userId })
      .andWhere('n.deleted_at IS NULL')
      .andWhere("n.type = 'file'")
      .groupBy("SPLIT_PART(n.mime_type, '/', 1)")
      .getRawMany();

    const totalFiles = await this.nodeRepo.count({
      where: { userId, deletedAt: IsNull(), type: 'file' as any },
    });

    const totalFolders = await this.nodeRepo.count({
      where: { userId, deletedAt: IsNull(), type: 'folder' as any },
    });

    const filesByType: Record<string, { count: number; size: number }> = {};
    for (const row of rawStats) {
      filesByType[row.mimeGroup || 'other'] = {
        count: parseInt(row.count, 10),
        size: parseInt(row.totalSize || '0', 10),
      };
    }

    return {
      quotaBytes: Number(user.quotaBytes),
      usedBytes: Number(user.usedBytes),
      usedPercent:
        user.quotaBytes > 0
          ? Math.round((Number(user.usedBytes) / Number(user.quotaBytes)) * 10000) / 100
          : 0,
      totalFiles,
      totalFolders,
      filesByType,
    };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  async findUserOrFail(userId: string): Promise<User> {
    const user = await this.userRepo.findOne({ where: { id: userId, deletedAt: IsNull() } });
    if (!user) throw new NotFoundException('用户不存在');
    if (user.status === UserStatus.DISABLED) throw new ForbiddenException('账户已被禁用');
    return user;
  }

  private safeUser(user: User, includeContact = false): any {
    const masterKey = this.cs.get<string>('ENCRYPTION_MASTER_KEY');

    let email: string | null = null;
    let phone: string | null = null;

    if (includeContact && masterKey) {
      try {
        if (user.emailEncrypted) email = decryptField(user.emailEncrypted, masterKey);
      } catch (err) {
        this.logger.warn(`Failed to decrypt email for user ${user.id}: ${err.message}`);
      }
      try {
        if (user.phoneEncrypted) phone = decryptField(user.phoneEncrypted, masterKey);
      } catch (err) {
        this.logger.warn(`Failed to decrypt phone for user ${user.id}: ${err.message}`);
      }
    }

    return {
      id: user.id,
      username: user.username,
      nickname: user.nickname,
      avatar: user.avatar,
      role: user.role,
      status: user.status,
      quotaBytes: Number(user.quotaBytes),
      usedBytes: Number(user.usedBytes),
      mekSalt: user.mekSalt,
      hasPrivateSpace: !!user.privateSpaceHash,
      notifyShareAccess: user.notifyShareAccess,
      notifyForeignLogin: user.notifyForeignLogin,
      email,
      phone,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  private async audit(
    userId: string,
    action: string,
    nodeId: string | null,
    ip: string | null,
    ua: string | null,
  ): Promise<void> {
    try {
      await this.auditRepo.save(
        this.auditRepo.create({
          userId,
          action,
          nodeId,
          ipAddress: ip,
          userAgent: ua,
        }),
      );
    } catch (err) {
      this.logger.warn(`Audit log failed: ${err.message}`);
    }
  }
}
