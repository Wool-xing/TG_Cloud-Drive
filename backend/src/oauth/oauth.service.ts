import { Injectable, Logger, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { User } from '../users/entities/user.entity';
import { Device } from '../users/entities/device.entity';
import { Subscription, planQuotaBytes } from '../payment/entities/subscription.entity';
import { generateSalt } from '../common/encryption';

export type OAuthProvider = 'google' | 'github';

export interface OAuthProfile {
  provider: OAuthProvider;
  providerId: string;
  email: string | null;
  name: string;
  avatar: string | null;
}

@Injectable()
export class OauthService {
  private readonly logger = new Logger(OauthService.name);

  constructor(
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(Device) private deviceRepo: Repository<Device>,
    @InjectRepository(Subscription) private subRepo: Repository<Subscription>,
    private jwtService: JwtService,
    private cs: ConfigService,
  ) {}

  /** Find existing user by OAuth providerId, or create a new one */
  async findOrCreateUser(profile: OAuthProfile) {
    // Look for existing OAuth link
    const existing = await this.userRepo.findOne({
      where: { oauthProvider: profile.provider, oauthId: profile.providerId },
    });
    if (existing) {
      if (existing.status === 'disabled') throw new ConflictException('账户已被禁用');
      // Update avatar on each login
      if (profile.avatar && existing.avatar !== profile.avatar) {
        await this.userRepo.update(existing.id, { avatar: profile.avatar });
      }
      return existing;
    }

    // Generate a unique username from OAuth profile
    const baseName = profile.name
      .replace(/[^a-zA-Z0-9_一-鿿]/g, '')
      .slice(0, 20) || profile.provider + '_user';
    let username = baseName;
    let suffix = 1;
    while (await this.userRepo.findOne({ where: { username } })) {
      username = `${baseName}${suffix}`;
      suffix++;
    }

    const passwordHash = ''; // OAuth users have no password
    const mekSalt = generateSalt();

    const user = this.userRepo.create({
      username,
      passwordHash,
      mekSalt,
      nickname: profile.name.slice(0, 255),
      avatar: profile.avatar || null,
      quotaBytes: planQuotaBytes('free'),
      oauthProvider: profile.provider,
      oauthId: profile.providerId,
    });

    await this.userRepo.save(user);

    // Auto-provision free subscription
    const sub = this.subRepo.create({ userId: user.id, plan: 'free', status: 'active' });
    await this.subRepo.save(sub);

    this.logger.log(`OAuth user created: ${username} (${profile.provider})`);
    return user;
  }

  /**
   * Generate JWT tokens + create a Device record for the authenticated user.
   * Mirrors auth.service.issueTokens() so the /auth/refresh endpoint can
   * validate OAuth-issued refresh tokens (requires `type: 'refresh'` + deviceId).
   */
  async generateTokens(user: User, ip: string, ua: string) {
    const device = this.deviceRepo.create({
      userId: user.id,
      refreshTokenHash: '',
      ipAddress: ip,
      userAgent: ua,
      deviceName: this.parseDeviceName(ua),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
    await this.deviceRepo.save(device);

    const refreshSecret = this.cs.get<string>('JWT_REFRESH_SECRET');
    const refreshToken = this.jwtService.sign(
      { sub: user.id, deviceId: device.id, type: 'refresh' },
      { secret: refreshSecret, expiresIn: '30d' },
    );
    const tokenHash = this.hashRefreshToken(refreshToken, refreshSecret!);
    await this.deviceRepo.update(device.id, { refreshTokenHash: tokenHash });

    const accessToken = this.jwtService.sign(
      { sub: user.id, role: user.role, deviceId: device.id },
      { expiresIn: '2h' },
    );
    return { accessToken, refreshToken };
  }

  /**
   * Hash a refresh token for at-rest storage. Mirrors
   * auth.service.hashRefreshToken — HMAC-SHA256 with the refresh secret as pepper.
   */
  private hashRefreshToken(token: string, secret: string): string {
    return crypto.createHmac('sha256', secret).update(token).digest('hex');
  }

  /** Simple UA → device label. Mirrors auth.service.parseDeviceName. */
  private parseDeviceName(ua: string): string {
    if (!ua) return '未知设备';
    if (/mobile/i.test(ua)) return '移动端';
    if (/windows/i.test(ua)) return 'Windows';
    if (/mac/i.test(ua)) return 'macOS';
    if (/linux/i.test(ua)) return 'Linux';
    return '浏览器';
  }

  /**
   * Link an OAuth account to an existing logged-in user.
   * Only one OAuth account per provider per user.
   */
  async linkAccount(userId: string, profile: OAuthProfile) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new ConflictException('用户不存在');

    // Check if this OAuth account is already linked to another user
    const conflict = await this.userRepo.findOne({
      where: { oauthProvider: profile.provider, oauthId: profile.providerId },
    });
    if (conflict && conflict.id !== userId) {
      throw new ConflictException('此第三方账号已绑定其他用户');
    }

    await this.userRepo.update(userId, {
      oauthProvider: profile.provider,
      oauthId: profile.providerId,
      avatar: profile.avatar || user.avatar,
    });

    return { message: `${profile.provider} 账号绑定成功` };
  }

  /** Unlink an OAuth provider from a user */
  async unlinkAccount(userId: string, provider: OAuthProvider) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user || user.oauthProvider !== provider) {
      throw new ConflictException('未绑定此第三方账号');
    }
    // Don't allow unlinking if user has no password (would lock them out)
    if (!user.passwordHash) {
      throw new ConflictException('请先设置密码再解绑第三方登录');
    }
    await this.userRepo.update(userId, { oauthProvider: null, oauthId: null });
    return { message: `${provider} 账号已解绑` };
  }
}
