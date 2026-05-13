import { Injectable, Logger, InternalServerErrorException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import fetch from 'node-fetch';
import * as FormData from 'form-data';

// P1-B21: bounded retry + timeout wrapper. Pre-fix, sendDocument /
// getFileUrl could hang forever on Telegram outages, holding a chunk's
// HTTP worker thread until OS-level keepalive timeouts. The retry/backoff
// is bounded so a sustained Telegram outage surfaces as 503 quickly, not
// as a stalled upload.
const UPLOAD_TIMEOUT_MS = 60_000;       // single try; chunk size capped at 20 MB
const READ_TIMEOUT_MS = 15_000;         // metadata calls (getFile, deleteMessage)
const MAX_RETRIES = 3;
const RETRY_BACKOFF_MS = [500, 1500, 4000];

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

  /** P1-B21: fetch with AbortController-based timeout + retry on 429/5xx/network. */
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
        // Network failure or timeout: retry unless it's the last attempt.
        if (attempt < MAX_RETRIES - 1) {
          await new Promise(r => setTimeout(r, RETRY_BACKOFF_MS[attempt]));
          continue;
        }
      }
    }
    throw new ServiceUnavailableException(`Telegram 上游不可用：${lastErr?.message || 'unknown'}`);
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

    const res = await this.fetchWithRetry(url, { method: 'POST', body: form, headers }, UPLOAD_TIMEOUT_MS);
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
    const res = await this.fetchWithRetry(
      `${this.apiBase}/getFile?file_id=${fileId}`,
      { headers: this.defaultHeaders() },
      READ_TIMEOUT_MS,
    );
    const json = await res.json() as any;
    if (!json.ok) throw new InternalServerErrorException('获取文件路径失败');
    const filePath = json.result.file_path;
    if (this.workersUrl) {
      return `${this.workersUrl}/file/${encodeURIComponent(fileId)}`;
    }
    return `https://api.telegram.org/file/bot${this.token}/${filePath}`;
  }

  async deleteMessage(messageId: number) {
    // P1-B21: best-effort delete; do NOT block the calling delete path on
    // Telegram availability. Bounded retry on transient failure, swallowed
    // on persistent failure (logged for cleanup job to retry later).
    try {
      await this.fetchWithRetry(
        `${this.apiBase}/deleteMessage`,
        {
          method: 'POST',
          headers: this.defaultHeaders(),
          body: JSON.stringify({ chat_id: this.channelId, message_id: messageId }),
        },
        READ_TIMEOUT_MS,
      );
    } catch (e: any) {
      this.logger.warn(`Delete message ${messageId} failed after retries: ${e.message}`);
    }
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
