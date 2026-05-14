import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

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
  private transporter: nodemailer.Transporter;
  private readonly logger = new Logger(MailService.name);

  constructor(private cs: ConfigService) {
    const host = cs.get('SMTP_HOST');
    if (host) {
      this.transporter = nodemailer.createTransport({
        host,
        port: cs.get<number>('SMTP_PORT', 587),
        secure: cs.get<number>('SMTP_PORT', 587) === 465,
        auth: { user: cs.get('SMTP_USER'), pass: cs.get('SMTP_PASS') },
      });
    }
  }

  private async send(to: string, subject: string, html: string) {
    if (!this.transporter) {
      this.logger.warn(`[MAIL DEV] To: ${to} | Subject: ${subject}`);
      return;
    }
    await this.transporter.sendMail({
      from: this.cs.get('SMTP_FROM'),
      to, subject, html,
    });
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
