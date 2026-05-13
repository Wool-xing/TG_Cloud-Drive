import { Injectable, BadRequestException, ServiceUnavailableException, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { VerificationCode, VerificationPurpose } from './verification.entity';
import { MailService } from '../mail/mail.service';
import { REDIS_CLIENT } from '../common/redis/redis.module';

@Injectable()
export class VerificationService {
  constructor(
    @InjectRepository(VerificationCode) private repo: Repository<VerificationCode>,
    @Inject(REDIS_CLIENT) private redis: any,
    private mailService: MailService,
  ) {}

  async sendCode(target: string, purpose: VerificationPurpose) {
    const rateLimitKey = `vc:rate:${target}`;

    // Fail-CLOSED: rate-limit check + reservation must succeed BEFORE any side
    // effects (DB write, email send). Order: get → set → DB save → mail.
    // If Redis is down, refuse — better to delay legit signups during an outage
    // than to let attackers burn SMTP/SMS quota by spamming sendCode.
    let limited: string | null;
    try {
      limited = await this.redis.get(rateLimitKey);
    } catch (e) {
      throw new ServiceUnavailableException('验证码服务暂时不可用，请稍后重试');
    }
    if (limited) throw new BadRequestException('请等待 1 分钟后再发送验证码');

    try {
      await this.redis.set(rateLimitKey, '1', 'EX', 60);
    } catch (e) {
      throw new ServiceUnavailableException('验证码服务暂时不可用，请稍后重试');
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await this.repo.save(this.repo.create({ target, code, purpose, expiresAt }));

    if (target.includes('@')) {
      // TODO(next-fix): mail send is also silently swallowed — same default-
      // permissive pattern as the old redis catches. Tracked as P1-I5/邮件.
      await this.mailService.sendVerificationCode(target, code).catch(() => {});
    }

    return {
      message: '验证码已发送',
      ...(process.env.NODE_ENV === 'development' ? { code } : {}),
    };
  }

  async verify(target: string, code: string, purpose: string) {
    const record = await this.repo.findOne({
      where: {
        target,
        code,
        purpose: purpose as VerificationPurpose,
        expiresAt: MoreThan(new Date()),
        usedAt: null,
      },
      order: { createdAt: 'DESC' },
    });
    if (!record) throw new BadRequestException('验证码错误或已过期');
    await this.repo.update(record.id, { usedAt: new Date() });
    return true;
  }
}
