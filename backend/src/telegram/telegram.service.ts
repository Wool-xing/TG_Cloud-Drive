import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import fetch from 'node-fetch';
import * as FormData from 'form-data';

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private token: string;
  private channelId: string;
  private workersUrl: string;
  private workersSecret: string;

  constructor(private cs: ConfigService) {
    this.token = cs.get<string>('TG_BOT_TOKEN');
    this.channelId = cs.get<string>('TG_CHANNEL_ID');
    this.workersUrl = cs.get<string>('CF_WORKERS_URL');
    this.workersSecret = cs.get<string>('CF_WORKERS_SECRET');
  }

  private get apiBase() {
    if (this.workersUrl) return `${this.workersUrl}/api/tg`;
    return `https://api.telegram.org/bot${this.token}`;
  }

  private defaultHeaders() {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.workersSecret) h['X-Workers-Secret'] = this.workersSecret;
    return h;
  }

  async sendDocument(buffer: Buffer, filename: string, mimeType: string): Promise<{ fileId: string; messageId: number }> {
    const form = new FormData();
    form.append('chat_id', this.channelId);
    form.append('document', buffer, { filename, contentType: mimeType });

    const url = this.workersUrl
      ? `${this.workersUrl}/upload-chunk`
      : `https://api.telegram.org/bot${this.token}/sendDocument`;

    const headers = form.getHeaders();
    if (this.workersSecret) headers['X-Workers-Secret'] = this.workersSecret;

    const res = await fetch(url, { method: 'POST', body: form, headers });
    if (!res.ok) {
      const text = await res.text();
      this.logger.error(`Telegram upload failed: ${text}`);
      throw new InternalServerErrorException('文件上传至 Telegram 失败');
    }
    const json = await res.json() as any;
    if (!json.ok) throw new InternalServerErrorException(json.description);

    const msg = json.result;
    const doc = msg.document || msg.video || msg.audio || msg.photo?.[0];
    return { fileId: doc.file_id, messageId: msg.message_id };
  }

  async getFileUrl(fileId: string): Promise<string> {
    const res = await fetch(`${this.apiBase}/getFile?file_id=${fileId}`, {
      headers: this.defaultHeaders(),
    });
    const json = await res.json() as any;
    if (!json.ok) throw new InternalServerErrorException('获取文件路径失败');
    const filePath = json.result.file_path;
    if (this.workersUrl) {
      return `${this.workersUrl}/file/${encodeURIComponent(fileId)}`;
    }
    return `https://api.telegram.org/file/bot${this.token}/${filePath}`;
  }

  async deleteMessage(messageId: number) {
    await fetch(`${this.apiBase}/deleteMessage`, {
      method: 'POST',
      headers: this.defaultHeaders(),
      body: JSON.stringify({ chat_id: this.channelId, message_id: messageId }),
    }).catch(e => this.logger.warn(`Delete message failed: ${e.message}`));
  }

  buildSignedDownloadUrl(fileId: string, expiresInSeconds = 3600): string {
    const crypto = require('crypto');
    const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
    const secret = this.workersSecret || this.cs.get('JWT_SECRET');
    const sig = crypto.createHmac('sha256', secret).update(`${fileId}:${exp}`).digest('hex').slice(0, 16);
    const token = Buffer.from(JSON.stringify({ fileId, exp, sig })).toString('base64url');
    if (this.workersUrl) return `${this.workersUrl}/file/${token}`;
    return `/api/files/download/${token}`;
  }
}
