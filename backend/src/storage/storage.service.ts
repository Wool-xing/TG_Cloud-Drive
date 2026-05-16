import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { R2StorageProvider } from './r2-storage.provider';
import { TelegramStorageProvider } from './telegram-storage.provider';
import { UploadResult } from './storage-provider.interface';

export type StorageBackend = 'r2' | 'telegram';

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private primary: StorageBackend;

  constructor(
    private r2: R2StorageProvider,
    private telegram: TelegramStorageProvider,
  ) {
    // R2 is primary if configured, else fall back to Telegram
    this.primary = r2.isEnabled() ? 'r2' : 'telegram';
    this.logger.log(`Storage primary: ${this.primary}`);
  }

  /** Which backend is currently primary */
  getPrimary(): StorageBackend {
    return this.primary;
  }

  /** Force a specific backend (for migration, testing) */
  private provider(name: StorageBackend) {
    return name === 'r2' ? this.r2 : this.telegram;
  }

  /**
   * Upload a chunk to primary storage.
   * key format: {userId}/{nodeId}/chunk_{index} (R2) or filename (Telegram)
   */
  async upload(
    backend: StorageBackend,
    buffer: Buffer,
    key: string,
    mimeType: string,
  ): Promise<UploadResult> {
    const provider = this.provider(backend);
    const filename = backend === 'r2' ? key : `chunk_${Date.now()}`;
    return provider.upload(buffer, filename, mimeType);
  }

  /** Get a download URL from the specified backend */
  async getUrl(backend: StorageBackend, key: string): Promise<string> {
    return this.provider(backend).getUrl(key);
  }

  /** Delete an object from the specified backend */
  async delete(backend: StorageBackend, key: string, meta?: string): Promise<void> {
    return this.provider(backend).delete(key, meta);
  }

  /** Delete multiple objects from R2 */
  async deleteMany(keys: string[]): Promise<void> {
    if (this.r2.isEnabled()) {
      await this.r2.deleteMany(keys);
    }
  }

  /** Build an R2 object key for a chunk */
  buildR2Key(userId: string, nodeId: string, chunkIndex: number): string {
    return R2StorageProvider.buildKey(userId, nodeId, chunkIndex);
  }

  /** Health check on the primary storage backend */
  async healthCheck(): Promise<{ primary: StorageBackend; healthy: boolean }> {
    try {
      const healthy = await this.provider(this.primary).healthCheck();
      return { primary: this.primary, healthy };
    } catch {
      return { primary: this.primary, healthy: false };
    }
  }
}
