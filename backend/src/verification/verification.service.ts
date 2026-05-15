import { Injectable, BadRequestException, ServiceUnavailableException, Inject, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan, IsNull } from 'typeorm';
import * as crypto from 'crypto';
import { VerificationCode, VerificationPurpose } from './verification.entity';
import { MailService } from '../mail/mail.service';
import { REDIS_CLIENT } from '../common/redis/redis.module';

@Injectable()
export class VerificationService {
  private readonly logger = new Logger(VerificationService.name);

  constructor(
    @InjectRepository(VerificationCode) private repo: Repository<VerificationCode>,
    @Inject(REDIS_CLIENT) private redis: any,
    private mailService: MailService,
  ) {}

  async sendCode(target: string, purpose: VerificationPurpose) {
    // F1: key MUST include purpose. Without it, an unauthenticated
    // /auth/register sendCode to victim@example.com burns the victim's
    // CHANGE_PASSWORD rate budget — attacker re-issues every 55s to
    // permanently block legitimate password recovery. fail counter and
    // lock keys already include purpose (`vc:fail:${purpose}:${target}`,
    // `vc:lock:${purpose}:${target}`); aligning the rate key closes the
    // last cross-purpose channel.
    const rateLimitKey = `vc:rate:${purpose}:${target}`;

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

    // P1-A5: Math.random() is a non-cryptographic PRNG — its internal state is
    // observable and predictable (V8 xorshift can be reversed from a few outputs).
    // For an attacker who can sample one code (e.g. during their own signup) and
    // race within the 5-minute TTL, this would allow predicting another victim's
    // code. crypto.randomInt is CSPRNG-backed; range is [min, max) inclusive of
    // 6-digit outputs from 100000 to 999999.
    const code = crypto.randomInt(100000, 1000000).toString();
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
    // P1-A6: brute-force defense at the (target, purpose) tuple.
    // Without this, an attacker who controls only the per-IP Throttler rate
    // (10/min for the verify endpoint = 600/hour) could still grind through a
    // chunk of the 1,000,000-code space during a single 5-minute code TTL
    // (~50 attempts) — non-trivial when chained with IP rotation. A per-target
    // counter caps total guesses regardless of IP. Fail-CLOSED on Redis outage:
    // refuse to verify rather than let unbounded brute-force through.
    const failKey = `vc:fail:${purpose}:${target}`;
    const lockKey = `vc:lock:${purpose}:${target}`;
    const maxAttempts = 5;
    const lockSeconds = 15 * 60;

    let locked: string | null;
    try {
      locked = await this.redis.get(lockKey);
    } catch (e) {
      throw new ServiceUnavailableException('验证码服务暂时不可用，请稍后重试');
    }
    if (locked) {
      throw new BadRequestException('验证码连续错误次数过多，请 15 分钟后再试');
    }

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

    if (!record) {
      // Atomic increment + TTL window. TTL matches the longest plausible code
      // lifetime (5 min) so the counter only burns once per code generation.
      let fails: number;
      try {
        fails = await this.redis.incr(failKey);
        if (fails === 1) await this.redis.expire(failKey, 5 * 60);
      } catch (e) {
        throw new ServiceUnavailableException('验证码服务暂时不可用，请稍后重试');
      }
      if (fails >= maxAttempts) {
        // Surface lock-write failures. Silent `.catch(() => {})` previously
        // hid the case where an attacker who can induce Redis errors at the
        // 5th-failed-attempt moment never gets locked out — visibility in
        // ops logs lets us catch that pattern even if the lock didn't write.
        await this.redis
          .set(lockKey, '1', 'EX', lockSeconds)
          .catch((err: unknown) =>
            this.logger.warn(
              `lock write failed for ${lockKey}: ${(err as Error).message}`,
            ),
          );
        await this.redis
          .del(failKey)
          .catch((err: unknown) =>
            this.logger.warn(
              `fail-counter clear failed for ${failKey}: ${(err as Error).message}`,
            ),
          );
        throw new BadRequestException('验证码连续错误次数过多，请 15 分钟后再试');
      }
      throw new BadRequestException('验证码错误或已过期');
    }

    // P1-A9: atomic compare-and-set on `usedAt` prevents concurrent reuse of
    // the same code. Two requests that both passed the SELECT above (e.g.
    // attacker racing the legit user, or double-clicking a submit button) will
    // both reach this point — the conditional UPDATE only flips usedAt where it
    // is still NULL, so exactly one wins; the loser gets affected=0 and is
    // rejected. Without this, an attacker who once observed a victim's code
    // (e.g. via a shared email tenant) could race the legit registration and
    // potentially complete a hijacked register/changeEmail flow.
    const result = await this.repo.update(
      { id: record.id, usedAt: IsNull() },
      { usedAt: new Date() },
    );
    if (result.affected !== 1) {
      throw new BadRequestException('验证码已被使用，请重新发送');
    }
    // Clear failure counter on success so a legit user isn't punished for
    // typos earlier in the same code's TTL.
    await this.redis
      .del(failKey)
      .catch((err: unknown) =>
        this.logger.warn(
          `fail-counter clear failed for ${failKey} on success: ${(err as Error).message}`,
        ),
      );
    return true;
  }
}
