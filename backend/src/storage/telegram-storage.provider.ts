import { Injectable, Logger, InternalServerErrorException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as FormData from 'form-data';
import fetch from 'node-fetch';
import { StorageProvider, UploadResult } from './storage-provider.interface';

const UPLOAD_TIMEOUT_MS = 60_000;
const READ_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 3;
const RETRY_BACKOFF_MS = [500, 1500, 4000];

@Injectable()
export class TelegramStorageProvider implements StorageProvider {
  readonly name = 'telegram';
  private readonly logger = new Logger(TelegramStorageProvider.name);
  private token: string;
  private channelId: string;
  private workersUrl: string;
  private workersSecret: string;

  constructor(private cs: ConfigService) {
    this.token = cs.get<string>('TG_BOT_TOKEN')!;
    this.channelId = cs.get<string>('TG_CHANNEL_ID')!;
    this.workersUrl = cs.get<string>('CF_WORKERS_URL') || '';
    this.workersSecret = cs.get<string>('CF_WORKERS_SECRET') || '';
  }

  private get devDirectFallback(): boolean {
    return !this.workersUrl && this.cs.get<string>('NODE_ENV') === 'development';
  }

  private async fetchWithRetry(url: string, init: any, timeoutMs: number): Promise<any> {
    let lastErr: any;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetch(url, { ...init, signal: ctrl.signal as any });
        clearTimeout(timer);
        const retryable = res.status === 429 || (res.status >= 500 && res.status < 600);
        if (retryable && attempt < MAX_RETRIES - 1) {
          lastErr = new Error(`HTTP ${res.status}`);
          await new Promise(r => setTimeout(r, RETRY_BACKOFF_MS[attempt]));
          continue;
        }
        return res;
      } catch (e: any) {
        clearTimeout(timer);
        lastErr = e;
        if (attempt < MAX_RETRIES - 1) {
          await new Promise(r => setTimeout(r, RETRY_BACKOFF_MS[attempt]));
          continue;
        }
      }
    }
    const rawMsg = lastErr?.message || 'unknown';
    this.logger.error(`Telegram upstream failed (full): ${rawMsg}`);
    const safeMsg = rawMsg
      .replace(/bot\d+:[A-Za-z0-9_-]+/g, 'bot[REDACTED]')
      .replace(/request to https?:\/\/[^\s]+ failed, reason:\s*/i, '');
    throw new ServiceUnavailableException(`Telegram 上游不可用：${safeMsg.slice(0, 200)}`);
  }

  async upload(buffer: Buffer, filename: string, mimeType: string): Promise<UploadResult> {
    if (!this.workersUrl && !this.devDirectFallback) {
      throw new ServiceUnavailableException('Telegram 上传未配置');
    }

    const form = new FormData();
    form.append('chat_id', this.channelId);
    form.append('document', buffer, { filename, contentType: mimeType });

    const url = this.workersUrl
      ? `${this.workersUrl}/upload-chunk`
      : `https://api.telegram.org/bot${this.token}/sendDocument`;

    const headers = form.getHeaders();
    if (this.workersUrl && this.workersSecret) headers['X-Workers-Secret'] = this.workersSecret;

    const res = await this.fetchWithRetry(url, { method: 'POST', body: form, headers }, UPLOAD_TIMEOUT_MS);
    if (!res.ok) {
      const text = await res.text();
      throw new InternalServerErrorException(`文件上传至 Telegram 失败: ${text.slice(0, 200)}`);
    }
    const json = await res.json() as any;
    if (!json.ok) throw new InternalServerErrorException(json.description);

    const msg = json.result;
    const doc = msg.document || msg.video || msg.audio || msg.photo?.[0];
    const thumb = (doc?.thumbnail as { file_id?: string } | undefined)?.file_id || null;
    return {
      providerKey: doc.file_id,
      providerMeta: String(msg.message_id),
      thumbnailFileId: thumb,
    };
  }

  async getUrl(key: string): Promise<string> {
    if (!this.workersUrl && !this.devDirectFallback) {
      throw new ServiceUnavailableException('Telegram 下载未配置');
    }

    if (this.workersUrl) {
      return `${this.workersUrl}/file/${encodeURIComponent(key)}`;
    }

    const res = await this.fetchWithRetry(
      `https://api.telegram.org/bot${this.token}/getFile?file_id=${key}`,
      { headers: { 'Content-Type': 'application/json' } },
      READ_TIMEOUT_MS,
    );
    const json = await res.json() as any;
    if (!json.ok) throw new InternalServerErrorException('获取文件路径失败');
    return `https://api.telegram.org/file/bot${this.token}/${json.result.file_path}`;
  }

  async delete(_key: string, meta?: string): Promise<void> {
    const messageId = meta ? parseInt(meta, 10) : 0;
    if (!messageId) return;
    try {
      await this.fetchWithRetry(
        `${this.workersUrl ? `${this.workersUrl}/api/tg` : `https://api.telegram.org/bot${this.token}`}/deleteMessage`,
        {
          method: 'POST',
          headers: this.workersSecret
            ? { 'Content-Type': 'application/json', 'X-Workers-Secret': this.workersSecret }
            : { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: this.channelId, message_id: messageId }),
        },
        READ_TIMEOUT_MS,
      );
    } catch (e: any) {
      this.logger.warn(`Delete message ${messageId} failed: ${e.message}`);
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${this.token}/getMe`,
        { headers: { 'Content-Type': 'application/json' } },
      );
      return res.ok;
    } catch {
      return false;
    }
  }
}
