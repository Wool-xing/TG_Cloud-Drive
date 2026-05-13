import {
  Injectable, UnauthorizedException, BadRequestException,
  ConflictException, ForbiddenException, Inject,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { User, UserRole, UserStatus } from '../users/entities/user.entity';
import { Device } from '../users/entities/device.entity';
import { AuditLog } from '../users/entities/audit-log.entity';
import { REDIS_CLIENT } from '../common/redis/redis.module';
import {
  hashPassword, comparePassword, generateSecureToken, encryptField,
  generateSalt, hashIdentifier, normalizeEmail, normalizePhone,
} from '../common/encryption';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { VerificationService } from '../verification/verification.service';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(Device) private deviceRepo: Repository<Device>,
    @InjectRepository(AuditLog) private auditRepo: Repository<AuditLog>,
    @Inject(REDIS_CLIENT) private redis: any,
    private jwtService: JwtService,
    private configService: ConfigService,
    private verificationService: VerificationService,
  ) {}

  async register(dto: RegisterDto) {
    const { username, password, email, phone, code } = dto;
    const target = email || phone;
    if (!target) throw new BadRequestException('请提供邮箱或手机号');

    // Verify against the raw target — sendCode stored it as-is. Hashing & dedup
    // below uses the normalized form to make login case-/format-insensitive.
    await this.verificationService.verify(target, code, 'register');

    const exists = await this.userRepo.findOne({ where: { username } });
    if (exists) throw new ConflictException('用户名已被使用');

    const masterKey = this.configService.get<string>('ENCRYPTION_MASTER_KEY');
    // validateEnvOrExit() guarantees masterKey at boot; defense in depth here.
    if (!masterKey) throw new BadRequestException('服务加密配置异常，请联系管理员');

    const normalizedEmail = email ? normalizeEmail(email) : null;
    const normalizedPhone = phone ? normalizePhone(phone) : null;
    const emailHash = normalizedEmail ? hashIdentifier(normalizedEmail, masterKey) : null;
    const phoneHash = normalizedPhone ? hashIdentifier(normalizedPhone, masterKey) : null;

    // O(1) duplicate check via unique indexes — replaces the previous full-table
    // scan + per-row decryption pattern (DoS vector + user-enumeration timing).
    if (emailHash) {
      const dup = await this.userRepo.findOne({ where: { emailHash } });
      if (dup) throw new ConflictException('该邮箱已被注册');
    }
    if (phoneHash) {
      const dup = await this.userRepo.findOne({ where: { phoneHash } });
      if (dup) throw new ConflictException('该手机号已被注册');
    }

    const passwordHash = await hashPassword(password);
    const mekSalt = generateSalt();

    const user = this.userRepo.create({
      username,
      passwordHash,
      mekSalt,
      quotaBytes: (this.configService.get<number>('DEFAULT_USER_QUOTA_GB') || 50) * 1024 * 1024 * 1024,
      // Encrypted fields store the normalized form so decrypting yields a value
      // consistent with what login/dedup compare against.
      emailEncrypted: normalizedEmail ? encryptField(normalizedEmail, masterKey) : null,
      emailHash,
      phoneEncrypted: normalizedPhone ? encryptField(normalizedPhone, masterKey) : null,
      phoneHash,
    });

    await this.userRepo.save(user);
    await this.auditLog(user.id, 'register', null, null, null);
    return { message: '注册成功' };
  }

  async login(dto: LoginDto, ip: string, ua: string) {
    const { identifier, password } = dto;
    const user = await this.findUserByIdentifier(identifier);

    if (!user) throw new UnauthorizedException('用户名或密码错误');
    if (user.status === UserStatus.DISABLED) throw new ForbiddenException('账号已被禁用');

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const mins = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
      throw new ForbiddenException(`账号已锁定，请 ${mins} 分钟后再试`);
    }

    const valid = await comparePassword(password, user.passwordHash);
    if (!valid) {
      await this.handleFailedLogin(user);
      throw new UnauthorizedException('用户名或密码错误');
    }

    await this.userRepo.update(user.id, { loginAttempts: 0, lockedUntil: null });
    const tokens = await this.issueTokens(user, ip, ua);
    await this.auditLog(user.id, 'login', null, ip, ua);

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: this.safeUser(user),
      mekSalt: user.mekSalt,
    };
  }

  async refresh(refreshToken: string, ip: string, ua: string) {
    let payload: any;
    try {
      payload = this.jwtService.verify(refreshToken, {
        secret: this.configService.get('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('刷新令牌无效');
    }

    const device = await this.deviceRepo.findOne({ where: { id: payload.deviceId } });
    if (!device || device.expiresAt < new Date()) {
      throw new UnauthorizedException('登录已过期，请重新登录');
    }

    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    if (device.refreshTokenHash !== tokenHash) {
      throw new UnauthorizedException('登录令牌已失效');
    }

    const user = await this.userRepo.findOne({ where: { id: payload.sub } });
    if (!user || user.status === UserStatus.DISABLED) throw new UnauthorizedException();

    const accessToken = this.signAccess(user, device.id);
    await this.deviceRepo.update(device.id, { lastActiveAt: new Date(), ipAddress: ip });
    return { accessToken };
  }

  async logout(deviceId: string) {
    // Guard against accidental "delete all" if access token lacks deviceId
    if (!deviceId) throw new UnauthorizedException('登录令牌缺少设备标识');
    await this.deviceRepo.delete({ id: deviceId });
    return { message: '已退出登录' };
  }

  async logoutAll(userId: string) {
    await this.deviceRepo.delete({ userId });
    return { message: '已退出所有设备' };
  }

  private async handleFailedLogin(user: User) {
    const maxAttempts = this.configService.get<number>('LOGIN_LOCK_ATTEMPTS', 5);
    const lockMins = this.configService.get<number>('LOGIN_LOCK_MINUTES', 15);
    const attempts = user.loginAttempts + 1;
    const update: Partial<User> = { loginAttempts: attempts };
    if (attempts >= maxAttempts) {
      update.lockedUntil = new Date(Date.now() + lockMins * 60 * 1000);
      update.loginAttempts = 0;
    }
    await this.userRepo.update(user.id, update);
  }

  private async issueTokens(user: User, ip: string, ua: string) {
    const device = this.deviceRepo.create({
      userId: user.id,
      refreshTokenHash: '',
      ipAddress: ip,
      userAgent: ua,
      deviceName: this.parseDeviceName(ua),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
    await this.deviceRepo.save(device);

    const refreshToken = this.jwtService.sign(
      { sub: user.id, deviceId: device.id, type: 'refresh' },
      { secret: this.configService.get('JWT_REFRESH_SECRET'), expiresIn: '30d' },
    );
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    await this.deviceRepo.update(device.id, { refreshTokenHash: tokenHash });

    const accessToken = this.signAccess(user, device.id);
    return { accessToken, refreshToken, deviceId: device.id };
  }

  private signAccess(user: User, deviceId: string) {
    return this.jwtService.sign({ sub: user.id, role: user.role, deviceId });
  }

  private async findUserByIdentifier(identifier: string) {
    // 1. Username lookup (unique index, O(1)).
    const byUsername = await this.userRepo.findOne({ where: { username: identifier } });
    if (byUsername) return byUsername;

    const masterKey = this.configService.get<string>('ENCRYPTION_MASTER_KEY');
    if (!masterKey) return null;

    // 2. Email-by-hash lookup (unique index, O(1)).
    // Replaces the previous full-table scan + per-row decryption, which was both
    // a DoS vector and a timing side-channel for user enumeration.
    if (identifier.includes('@')) {
      const emailHash = hashIdentifier(normalizeEmail(identifier), masterKey);
      const byEmail = await this.userRepo.findOne({ where: { emailHash } });
      if (byEmail) return byEmail;
    }

    // 3. Phone-by-hash lookup (unique index, O(1)).
    const phoneCandidate = normalizePhone(identifier);
    if (/^\d{11}$/.test(phoneCandidate)) {
      const phoneHash = hashIdentifier(phoneCandidate, masterKey);
      const byPhone = await this.userRepo.findOne({ where: { phoneHash } });
      if (byPhone) return byPhone;
    }

    return null;
  }

  private parseDeviceName(ua: string): string {
    if (!ua) return '未知设备';
    if (/mobile/i.test(ua)) return '移动端';
    if (/windows/i.test(ua)) return 'Windows';
    if (/mac/i.test(ua)) return 'macOS';
    if (/linux/i.test(ua)) return 'Linux';
    return '浏览器';
  }

  safeUser(user: User) {
    return {
      id: user.id,
      username: user.username,
      nickname: user.nickname,
      avatar: user.avatar,
      role: user.role,
      quotaBytes: Number(user.quotaBytes),
      usedBytes: Number(user.usedBytes),
      createdAt: user.createdAt,
    };
  }

  private async auditLog(userId: string, action: string, nodeId: string, ip: string, ua: string) {
    await this.auditRepo.save(this.auditRepo.create({ userId, action, nodeId, ipAddress: ip, userAgent: ua }));
  }
}
