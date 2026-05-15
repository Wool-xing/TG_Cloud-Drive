import { Injectable, UnauthorizedException, ServiceUnavailableException, Inject } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, UserStatus } from '../users/entities/user.entity';
import { Device } from '../users/entities/device.entity';
import { REDIS_CLIENT } from '../common/redis/redis.module';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(Device) private deviceRepo: Repository<Device>,
    cs: ConfigService,
    @Inject(REDIS_CLIENT) private redis: any,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: cs.get<string>('JWT_SECRET'),
    });
  }

  async validate(payload: { sub: string; role: string; deviceId?: string; iat?: number; type?: string }) {
    // Defense-in-depth (P1-A7): reject tokens whose `type` claim marks them as
    // non-access tokens. private_space tokens are signed with the SAME
    // JWT_SECRET as access tokens (see users.service.verifyPrivateSpace) — so
    // without this gate, an attacker holding a 30-min private_space token could
    // call any access-protected endpoint as the same user. Access tokens issued
    // by auth.service.signAccess() carry no `type` field, so they pass.
    // refresh tokens use JWT_REFRESH_SECRET and shouldn't reach here, but the
    // blacklist covers accidental cross-strategy submission too.
    if (payload.type === 'private_space' || payload.type === 'refresh') {
      throw new UnauthorizedException('令牌类型无效');
    }

    // Reject tokens issued before a force-logout was triggered.
    // Fail-CLOSED: if Redis is unreachable we refuse the request rather than silently
    // letting a possibly-revoked token through. Returns 503 so the client can
    // distinguish "service degraded — retry" from 401 "token expired — re-login".
    try {
      const forceAt = await this.redis.get(`force_logout:${payload.sub}`);
      if (forceAt && payload.iat) {
        // JWT iat is second-precision; force_logout is millisecond-precision.
        // Comparing iat*1000 < forceAt rejects any token whose iat second
        // floor-truncates the force-logout millisecond — i.e. a re-login that
        // happens in the same wall-clock second as the force-logout write is
        // incorrectly invalidated. Compare in seconds with a 1s grace so a
        // legitimate re-login immediately after change-password is accepted,
        // while any token issued *before* the force-logout still fails.
        if (payload.iat < Math.floor(parseInt(forceAt) / 1000)) {
          throw new UnauthorizedException('已被强制下线');
        }
      }
    } catch (e) {
      if (e instanceof UnauthorizedException) throw e;
      throw new ServiceUnavailableException('鉴权服务暂时不可用，请稍后重试');
    }

    // P1-A15: bind the access token to a live Device row. Without this, a stolen
    // access token remains usable for its full ~2 h TTL even after the legitimate
    // user (or an admin via forceLogout) deletes the device session. Pair with
    // auth.service.issueTokens(), which stamps every access token with the
    // owning device's id. Tokens minted before this code shipped also carry a
    // deviceId, so the check is universally applicable.
    // Defense-in-depth alongside D6 (force_logout) and refresh-token revocation:
    // force_logout covers password-change blast radius, this covers per-device
    // revocation (single-device logout / admin force-logout).
    if (payload.deviceId) {
      const device = await this.deviceRepo.findOne({ where: { id: payload.deviceId } });
      if (!device || device.expiresAt < new Date()) {
        throw new UnauthorizedException('登录会话已失效');
      }
    }

    const user = await this.userRepo.findOne({ where: { id: payload.sub } });
    if (!user || user.status === UserStatus.DISABLED) throw new UnauthorizedException();
    return {
      id: user.id,
      username: user.username,
      role: user.role,
      deviceId: payload.deviceId,
      quotaBytes: Number(user.quotaBytes),
      usedBytes: Number(user.usedBytes),
    };
  }
}
