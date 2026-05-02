import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

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
    await this.send(to, 'TG云盘 - 验证码', `
      <div style="font-family:sans-serif;max-width:500px;margin:auto">
        <h2>TG云盘验证码</h2>
        <p>您的验证码为：</p>
        <div style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#2563eb;padding:20px 0">${code}</div>
        <p>验证码 5 分钟内有效，请勿泄露给他人。</p>
      </div>
    `);
  }

  async sendPasswordReset(to: string, resetUrl: string) {
    await this.send(to, 'TG云盘 - 重置密码', `
      <div style="font-family:sans-serif;max-width:500px;margin:auto">
        <h2>重置密码</h2>
        <p>点击下方按钮重置您的密码（链接 30 分钟内有效）：</p>
        <a href="${resetUrl}" style="display:inline-block;padding:12px 24px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px">重置密码</a>
      </div>
    `);
  }

  async sendShareNotification(to: string, filename: string, shareUrl: string) {
    await this.send(to, 'TG云盘 - 分享被访问通知', `
      <div style="font-family:sans-serif;max-width:500px;margin:auto">
        <h2>分享被访问</h2>
        <p>您分享的文件 <strong>${filename}</strong> 刚刚被访问。</p>
        <a href="${shareUrl}">查看分享</a>
      </div>
    `);
  }
}
