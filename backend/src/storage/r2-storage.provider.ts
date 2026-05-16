import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { StorageProvider, UploadResult } from './storage-provider.interface';

@Injectable()
export class R2StorageProvider implements StorageProvider {
  readonly name = 'r2';
  private readonly logger = new Logger(R2StorageProvider.name);
  private client: S3Client;
  private bucket: string;
  private publicUrl: string;
  private enabled: boolean;

  constructor(private cs: ConfigService) {
    const endpoint = cs.get<string>('R2_ENDPOINT');
    const accessKeyId = cs.get<string>('R2_ACCESS_KEY_ID');
    const secretAccessKey = cs.get<string>('R2_SECRET_ACCESS_KEY');
    this.bucket = cs.get<string>('R2_BUCKET') || '';
    this.publicUrl = cs.get<string>('R2_PUBLIC_URL') || '';

    this.enabled = !!(endpoint && accessKeyId && secretAccessKey && this.bucket);
    if (this.enabled) {
      this.client = new S3Client({
        region: 'auto',
        endpoint,
        credentials: { accessKeyId, secretAccessKey },
        forcePathStyle: false,
      });
      this.logger.log(`R2 storage enabled — bucket: ${this.bucket}`);
    } else {
      this.logger.warn('R2 storage NOT configured — uploads will use Telegram fallback');
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  private ensureEnabled(): void {
    if (!this.enabled) {
      throw new ServiceUnavailableException('R2 存储未配置');
    }
  }

  /** Build object key: {userId}/{nodeId}/chunk_{index} */
  static buildKey(userId: string, nodeId: string, chunkIndex: number): string {
    return `${userId}/${nodeId}/chunk_${chunkIndex}`;
  }

  async upload(buffer: Buffer, filename: string, mimeType: string): Promise<UploadResult> {
    this.ensureEnabled();

    // Upload uses a temp key; the real key is assigned by the caller
    const actualKey = filename; // filename is already the R2 key from the caller

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: actualKey,
      Body: buffer,
      ContentType: mimeType,
      ContentLength: buffer.length,
    });

    try {
      const res = await this.client.send(command);
      return {
        providerKey: actualKey,
        etag: res.ETag?.replace(/"/g, '') || '',
      };
    } catch (e: any) {
      this.logger.error(`R2 upload failed: ${e.message}`);
      throw new ServiceUnavailableException(`R2 上传失败：${e.message.slice(0, 200)}`);
    }
  }

  async getUrl(key: string): Promise<string> {
    this.ensureEnabled();

    // If public URL is configured, use it (faster, no signing overhead)
    if (this.publicUrl) {
      return `${this.publicUrl.replace(/\/$/, '')}/${encodeURIComponent(key)}`;
    }

    // Otherwise generate a pre-signed URL (1 hour expiry)
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    try {
      return await getSignedUrl(this.client, command, { expiresIn: 3600 });
    } catch (e: any) {
      this.logger.error(`R2 getSignedUrl failed: ${e.message}`);
      throw new ServiceUnavailableException(`R2 生成下载链接失败`);
    }
  }

  async delete(key: string): Promise<void> {
    this.ensureEnabled();
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (e: any) {
      this.logger.warn(`R2 delete failed (non-fatal): ${e.message}`);
    }
  }

  async deleteMany(keys: string[]): Promise<void> {
    this.ensureEnabled();
    // R2 doesn't support batch delete natively, but we can do parallel deletes
    await Promise.allSettled(
      keys.map(key =>
        this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key })).catch(() => {})
      )
    );
  }

  async healthCheck(): Promise<boolean> {
    if (!this.enabled) return false;
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: '.healthcheck' }));
      return true;
    } catch (e: any) {
      // 404 is OK — bucket exists and we have access, just the test key doesn't exist
      if (e.name === 'NotFound' || e.$metadata?.httpStatusCode === 404) return true;
      return false;
    }
  }
}
