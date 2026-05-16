import { Injectable, Logger, InternalServerErrorException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
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
    // P1-B20 (续): sanitize error message before bubbling to the client.
    // Pre-fix `lastErr.message` from node-fetch on a network failure included
    // the full URL — `request to https://api.telegram.org/bot{TOKEN}/...` —
    // which then surfaced as a frontend toast / 5xx body. The bot token was
    // leaked verbatim every time the upstream was unreachable. Strip any
    // bot{...} segment so a user sees `Telegram 上游不可用：网络错误` while
    // the full message stays in server logs only.
    const rawMsg = lastErr?.message || 'unknown';
    this.logger.error(`Telegram upstream failed (full): ${rawMsg}`);
    const safeMsg = rawMsg
      .replace(/bot\d+:[A-Za-z0-9_-]+/g, 'bot[REDACTED]')
      // node-fetch wraps the URL in 'request to <url> failed, reason: ...'.
      // Drop everything up through the URL so the reason is the only thing
      // returned to the client.
      .replace(/request to https?:\/\/[^\s]+ failed, reason:\s*/i, '');
    throw new ServiceUnavailableException(`Telegram 上游不可用：${safeMsg.slice(0, 200)}`);
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

  /** Dev-mode escape hatch — only used when NODE_ENV=development AND
   *  CF_WORKERS_URL is missing. Localhost-only fallback so dev installs can
   *  exercise upload/download without a real Worker deployed. Production
   *  startup is still blocked by env-validator (see common/env-validator.ts
   *  L134-142), so this branch never activates in NODE_ENV=production. */
  private get devDirectFallback(): boolean {
    return !this.workersUrl && this.cs.get<string>('NODE_ENV') === 'development';
  }

  async sendDocument(buffer: Buffer, filename: string, mimeType: string): Promise<{ fileId: string; messageId: number; thumbnailFileId: string | null }> {
    // P1-B20 (续): refuse direct-Telegram mode in PRODUCTION. The direct mode
    // hits api.telegram.org via fetch — on failure the node-fetch error
    // message `request to .../bot{TOKEN}/sendDocument failed` would relay
    // to the frontend toast, leaking the token. env-validator already gates
    // production startup; this is the runtime double-gate for prod
    // mis-config drift.
    //
    // DEV-FALLBACK 2026-05-16: allow direct mode in NODE_ENV=development so
    // local installs can test upload/download without a Worker. The
    // fetchWithRetry sanitizer (L67-72) already strips bot{TOKEN} from error
    // messages, so a network failure surfaces a redacted message even in
    // dev. Production deployment MUST still configure CF_WORKERS_URL — the
    // env-validator blocks startup, this is just a runtime safety net.
    if (!this.workersUrl && !this.devDirectFallback) {
      this.logger.error('sendDocument called without CF_WORKERS_URL — direct mode would leak bot token, refusing');
      throw new ServiceUnavailableException(
        '上传服务未配置：CF_WORKERS_URL 缺失。请部署 Cloudflare Worker 后再用上传功能（避免 bot token 经错误消息泄漏）',
      );
    }
    if (this.devDirectFallback) {
      this.logger.warn(
        '[DEV-FALLBACK] sendDocument 直走 api.telegram.org — bot token 仅在 server 内, 错误已 sanitize. 生产前必须配 CF_WORKERS_URL.',
      );
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
      this.logger.error(`Telegram upload failed: ${text}`);
      throw new InternalServerErrorException('文件上传至 Telegram 失败');
    }
    const json = await res.json() as any;
    if (!json.ok) throw new InternalServerErrorException(json.description);

    const msg = json.result;
    const doc = msg.document || msg.video || msg.audio || msg.photo?.[0];
    const thumb = (doc?.thumbnail as { file_id?: string } | undefined)?.file_id || null;
    return { fileId: doc.file_id, messageId: msg.message_id, thumbnailFileId: thumb };
  }

  async getFileUrl(fileId: string): Promise<string> {
    // P1-B20: refuse direct Telegram file URL in PRODUCTION. The direct URL
    // embeds the bot token and is returned to the browser — pre-fix,
    // downloading a single file leaked the bot token via DevTools / proxy /
    // share-link target.
    //
    // DEV-FALLBACK 2026-05-16: allow direct mode in NODE_ENV=development for
    // local install testing. Bot token DOES go to the local browser in this
    // mode — acceptable for localhost dev where the only viewer is the
    // developer. Anything that exposes the dev backend to a public origin
    // would re-leak; env-validator blocks production startup, but this is
    // explicitly a localhost-only escape hatch.
    if (!this.workersUrl && !this.devDirectFallback) {
      this.logger.error('getFileUrl called without CF_WORKERS_URL — direct mode would leak bot token, refusing');
      throw new ServiceUnavailableException(
        '下载服务未配置：CF_WORKERS_URL 缺失。请部署 Cloudflare Worker 后再用下载/预览功能（避免 bot token 经浏览器 URL 泄漏）',
      );
    }
    if (this.devDirectFallback) {
      this.logger.warn(
        '[DEV-FALLBACK] getFileUrl 返回 api.telegram.org 直链 — bot token 进浏览器 URL. 仅 localhost dev 可用, 生产前必须配 CF_WORKERS_URL.',
      );
    }
    const res = await this.fetchWithRetry(
      `${this.apiBase}/getFile?file_id=${fileId}`,
      { headers: this.defaultHeaders() },
      READ_TIMEOUT_MS,
    );
    const json = await res.json() as any;
    if (!json.ok) throw new InternalServerErrorException('获取文件路径失败');
    if (this.workersUrl) {
      return `${this.workersUrl}/file/${encodeURIComponent(fileId)}`;
    }
    // Dev fallback: build the canonical Telegram file URL. file_path comes
    // from getFile response (e.g. "documents/file_123.bin").
    return `https://api.telegram.org/file/bot${this.token}/${json.result.file_path}`;
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

}
