import { Injectable, UnauthorizedException, Inject } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, UserStatus } from '../users/entities/user.entity';
import { REDIS_CLIENT } from '../common/redis/redis.module';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    @InjectRepository(User) private userRepo: Repository<User>,
    cs: ConfigService,
    @Inject(REDIS_CLIENT) private redis: any,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: cs.get<string>('JWT_SECRET'),
    });
  }

  async validate(payload: { sub: string; role: string; iat?: number }) {
    // Reject tokens issued before a force-logout was triggered
    try {
      const forceAt = await this.redis.get(`force_logout:${payload.sub}`);
      if (forceAt && payload.iat && payload.iat * 1000 < parseInt(forceAt)) {
        throw new UnauthorizedException('已被强制下线');
      }
    } catch (e) {
      if (e instanceof UnauthorizedException) throw e;
      // Redis unavailable — continue (fail open)
    }

    const user = await this.userRepo.findOne({ where: { id: payload.sub } });
    if (!user || user.status === UserStatus.DISABLED) throw new UnauthorizedException();
    return { id: user.id, username: user.username, role: user.role, quotaBytes: Number(user.quotaBytes), usedBytes: Number(user.usedBytes) };
  }
}
