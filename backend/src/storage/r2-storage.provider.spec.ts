import { ConfigService } from '@nestjs/config';
import { R2StorageProvider } from './r2-storage.provider';

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(),
  PutObjectCommand: jest.fn(),
  GetObjectCommand: jest.fn(),
  DeleteObjectCommand: jest.fn(),
  HeadObjectCommand: jest.fn(),
}));

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://r2.example.com/signed-url'),
}));

const mockS3Send = jest.fn();
const { S3Client } = require('@aws-sdk/client-s3');
S3Client.mockImplementation(() => ({ send: mockS3Send }));

const enabledConfig = {
  get: jest.fn((k: string) => {
    if (k === 'R2_ENDPOINT') return 'https://r2.example.com';
    if (k === 'R2_ACCESS_KEY_ID') return 'ak';
    if (k === 'R2_SECRET_ACCESS_KEY') return 'sk';
    if (k === 'R2_BUCKET') return 'bucket';
    if (k === 'R2_PUBLIC_URL') return 'https://pub.example.com';
    return null;
  }),
};

const disabledConfig = {
  get: jest.fn(() => null),
};

describe('R2StorageProvider', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  describe('with R2 configured', () => {
    let provider: R2StorageProvider;

    beforeEach(() => { provider = new R2StorageProvider(enabledConfig as any); });

    it('is enabled', () => { expect(provider.isEnabled()).toBe(true); });

    it('upload succeeds', async () => {
      mockS3Send.mockResolvedValue({ ETag: '"abc123"' });
      const r = await provider.upload(Buffer.from('data'), 'key-path', 'text/plain');
      expect(r.providerKey).toBe('key-path');
    });

    it('getUrl with public URL', async () => {
      const r = await provider.getUrl('my-key');
      expect(r).toContain('pub.example.com');
    });

    it('delete succeeds', async () => {
      mockS3Send.mockResolvedValue({});
      await expect(provider.delete('key')).resolves.toBeUndefined();
    });

    it('healthCheck returns true on 404', async () => {
      const err = Object.assign(new Error('NotFound'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } });
      mockS3Send.mockRejectedValue(err);
      expect(await provider.healthCheck()).toBe(true);
    });

    it('buildKey validates UUID inputs', () => {
      expect(() => R2StorageProvider.buildKey('bad', 'also-bad', 0)).toThrow();
      expect(R2StorageProvider.buildKey('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 3))
        .toContain('chunk_3');
    });
  });

  describe('without R2 configured', () => {
    let provider: R2StorageProvider;
    beforeEach(() => { provider = new R2StorageProvider(disabledConfig as any); });

    it('is disabled', () => { expect(provider.isEnabled()).toBe(false); });
    it('upload throws', async () => { await expect(provider.upload(Buffer.from(''), '', '')).rejects.toThrow(); });
    it('getUrl throws', async () => { await expect(provider.getUrl('k')).rejects.toThrow(); });
  });
});
