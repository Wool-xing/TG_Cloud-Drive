import { Injectable, Logger, ServiceUnavailableException, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { Resend } from 'resend';
import { REDIS_CLIENT } from '../common/redis/redis.module';

// P1-I5: HTML escape for variables interpolated into email templates.
// Pre-fix, sendShareNotification rendered `<strong>${filename}</strong>` —
// an attacker uploading a file named `<img src=x onerror="...">.pdf` could
// inject markup into a recipient's email client (many clients still allow
// limited HTML even when JS is stripped: link spoofing, image beacons, etc).
function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

@Injectable()
export class MailService {
  private transporter: nodemailer.Transporter | null = null;
  private resend: Resend | null = null;
  private readonly from: string;
  private readonly logger = new Logger(MailService.name);

  constructor(
    private cs: ConfigService,
    @Inject(REDIS_CLIENT) private redis: any,
  ) {
    this.from = cs.get('SMTP_FROM') || 'TG云盘 <noreply@tgpan.com>';

    // Resend API (primary — higher deliverability)
    const resendKey = cs.get('RESEND_API_KEY');
    if (resendKey) {
      this.resend = new Resend(resendKey);
      this.logger.log('Mail: Resend API configured (primary)');
    }

    // nodemailer SMTP (fallback)
    const host = cs.get('SMTP_HOST');
    if (host) {
      this.transporter = nodemailer.createTransport({
        host,
        port: cs.get<number>('SMTP_PORT', 587),
        secure: cs.get<number>('SMTP_PORT', 587) === 465,
        auth: { user: cs.get('SMTP_USER'), pass: cs.get('SMTP_PASS') },
      });
      this.logger.log('Mail: SMTP configured (fallback)');
    }

    if (!this.resend && !this.transporter) {
      this.logger.warn('Mail: Neither Resend nor SMTP configured — emails will be logged only');
    }
  }

  /**
   * P1-I6: global daily quota guard around send(). Pre-fix, every caller (incl.
   * admin testEmail and the verification flow) could trigger unbounded SMTP
   * sends — a single attacker could burn the relay quota / get the sending
   * domain blacklisted. Bucket is global across recipients; per-IP / per-user
   * gates live in the calling controllers (B1 throttler, A6 fail counter).
   * Fail-CLOSED on Redis outage: refuse to send rather than risk uncapped
   * delivery during an availability incident.
   */
  private async checkQuotaOrThrow() {
    const max = this.cs.get<number>('MAIL_DAILY_QUOTA', 1000);
    const dayKey = `mail:quota:${new Date().toISOString().slice(0, 10)}`;
    let count: number;
    try {
      count = await this.redis.incr(dayKey);
      if (count === 1) await this.redis.expire(dayKey, 86400);
    } catch (e) {
      throw new ServiceUnavailableException('邮件服务暂时不可用，请稍后重试');
    }
    if (count > max) {
      throw new ServiceUnavailableException(`邮件日发送量已达上限 (${max})`);
    }
  }

  private async send(to: string, subject: string, html: string) {
    await this.checkQuotaOrThrow();

    // Try Resend API first
    if (this.resend) {
      try {
        const { error } = await this.resend.emails.send({ from: this.from, to, subject, html });
        if (error) throw error;
        return;
      } catch (e: any) {
        this.logger.warn(`Resend send failed (will try SMTP): ${e.message}`);
      }
    }

    // Fall back to SMTP
    if (this.transporter) {
      await this.transporter.sendMail({ from: this.from, to, subject, html });
      return;
    }

    // Neither available — log only (dev mode)
    this.logger.warn(`[MAIL DEV] To: ${to} | Subject: ${subject}`);
  }

  async sendVerificationCode(to: string, code: string) {
    // code is server-generated 6-digit numeric (P1-A5 CSPRNG); still escape
    // defensively in case a future caller passes a non-numeric token.
    await this.send(to, 'TG云盘 - 验证码', `
      <div style="font-family:sans-serif;max-width:500px;margin:auto">
        <h2>TG云盘验证码</h2>
        <p>您的验证码为：</p>
        <div style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#2563eb;padding:20px 0">${esc(code)}</div>
        <p>验证码 5 分钟内有效，请勿泄露给他人。</p>
      </div>
    `);
  }

  async sendPasswordReset(to: string, resetUrl: string) {
    // resetUrl is server-built; but if it ever flows from a request param
    // (e.g. a future feature), unescaped interpolation would let an attacker
    // craft a `"><script>` payload embedded in the href.
    await this.send(to, 'TG云盘 - 重置密码', `
      <div style="font-family:sans-serif;max-width:500px;margin:auto">
        <h2>重置密码</h2>
        <p>点击下方按钮重置您的密码（链接 30 分钟内有效）：</p>
        <a href="${esc(resetUrl)}" style="display:inline-block;padding:12px 24px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px">重置密码</a>
      </div>
    `);
  }

  async sendShareNotification(to: string, filename: string, shareUrl: string) {
    // filename is the real injection surface — user uploads carry arbitrary
    // names. Escape both filename and shareUrl.
    await this.send(to, 'TG云盘 - 分享被访问通知', `
      <div style="font-family:sans-serif;max-width:500px;margin:auto">
        <h2>分享被访问</h2>
        <p>您分享的文件 <strong>${esc(filename)}</strong> 刚刚被访问。</p>
        <a href="${esc(shareUrl)}">查看分享</a>
      </div>
    `);
  }
}
