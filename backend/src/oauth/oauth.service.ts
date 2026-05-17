import { Injectable, Logger, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { User } from '../users/entities/user.entity';
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

  /** Generate JWT tokens for the authenticated user */
  generateTokens(user: User) {
    const payload = { sub: user.id, username: user.username, role: user.role };
    const accessToken = this.jwtService.sign(payload, { expiresIn: '2h' });
    const refreshToken = this.jwtService.sign(payload, {
      secret: this.cs.get<string>('JWT_REFRESH_SECRET'),
      expiresIn: '30d',
    });
    return { accessToken, refreshToken };
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
