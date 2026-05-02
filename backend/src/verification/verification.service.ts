import { Injectable, BadRequestException, Inject } from '@nestjs/common';
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
    const limited = await this.redis.get(rateLimitKey).catch(() => null);
    if (limited) throw new BadRequestException('请等待 1 分钟后再发送验证码');

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await this.repo.save(this.repo.create({ target, code, purpose, expiresAt }));
    await this.redis.set(rateLimitKey, '1', 'EX', 60).catch(() => {});

    if (target.includes('@')) {
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
