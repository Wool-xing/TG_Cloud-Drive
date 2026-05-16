export interface UploadResult {
  /** Provider-specific key or fileId for retrieval */
  providerKey: string;
  /** Message ID (Telegram) or ETag (R2) — used for delete */
  providerMeta?: string;
  /** Etag or hash */
  etag?: string;
  /** Thumbnail file ID (Telegram only) */
  thumbnailFileId?: string | null;
}

export interface StorageProvider {
  readonly name: string;
  /** Upload a single chunk/file — returns provider key */
  upload(buffer: Buffer, filename: string, mimeType: string): Promise<UploadResult>;
  /** Get a download/access URL for the stored object */
  getUrl(key: string): Promise<string>;
  /** Delete the stored object */
  delete(key: string, meta?: string): Promise<void>;
  /** Check if the provider is healthy */
  healthCheck(): Promise<boolean>;
}
