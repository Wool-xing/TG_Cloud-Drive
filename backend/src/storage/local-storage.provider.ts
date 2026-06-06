import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { StorageProvider, UploadResult } from './storage-provider.interface';

/**
 * Local filesystem storage provider — DEV ONLY.
 *
 * Stores files under the configured LOCAL_STORAGE_DIR (default: ./local-storage).
 * Each upload gets a UUID filename. The original filename and MIME are stored
 * in a sidecar .meta.json.
 *
 * NOT for production — no replication, no access control, no durability.
 */
@Injectable()
export class LocalStorageProvider implements StorageProvider {
  readonly name = 'local';
  private readonly logger = new Logger(LocalStorageProvider.name);
  private readonly dir: string;

  constructor(private cs: ConfigService) {
    this.dir = cs.get<string>('LOCAL_STORAGE_DIR', './local-storage');
    try {
      if (!fs.existsSync(this.dir)) {
        fs.mkdirSync(this.dir, { recursive: true });
      }
    } catch {
      // Fallback to /tmp if working dir not writable (Docker non-root)
      this.dir = '/tmp/local-storage';
      if (!fs.existsSync(this.dir)) fs.mkdirSync(this.dir, { recursive: true });
    }
    this.logger.warn(`⚠️  LOCAL STORAGE ACTIVE (DEV ONLY) — files stored in ${path.resolve(this.dir)}`);
  }

  /**
   * Reject keys that attempt path traversal. Call BEFORE path.join().
   * Allowed: alphanumeric, hyphens, underscores (UUID / random-id).
   * Blocked: .. / \ \x00 and any key whose resolved path escapes baseDir.
   */
  private sanitizeKey(key: string): string {
    if (!key || typeof key !== 'string') throw new Error('Invalid storage key');
    if (/\.\.|[/\\]|\x00/.test(key)) throw new Error('Path traversal denied');
    const resolved = path.resolve(this.dir, key);
    if (!resolved.startsWith(path.resolve(this.dir) + path.sep) &&
        resolved !== path.resolve(this.dir)) {
      throw new Error('Path traversal denied');
    }
    return key;
  }

  async upload(buffer: Buffer, _filename: string, mimeType: string): Promise<UploadResult> {
    const id = crypto.randomUUID();
    const filePath = path.join(this.dir, id);
    fs.writeFileSync(filePath, buffer);
    fs.writeFileSync(filePath + '.meta.json', JSON.stringify({ filename: _filename, mimeType, size: buffer.length }));
    return { providerKey: id, etag: crypto.createHash('md5').update(buffer).digest('hex') };
  }

  async getUrl(key: string): Promise<string> {
    this.sanitizeKey(key);
    const filePath = path.join(this.dir, key);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Local file not found: ${key}`);
    }
    return `/api/files/local-proxy/${key}`;
  }

  async delete(key: string, _meta?: string): Promise<void> {
    try { this.sanitizeKey(key); } catch { return; }
    const filePath = path.join(this.dir, key);
    try { fs.unlinkSync(filePath); } catch {}
    try { fs.unlinkSync(filePath + '.meta.json'); } catch {}
  }

  async healthCheck(): Promise<boolean> {
    try {
      fs.accessSync(this.dir, fs.constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }
}
