import { ConfigService } from '@nestjs/config';
import { LocalStorageProvider } from './local-storage.provider';

describe('LocalStorageProvider', () => {
  let provider: LocalStorageProvider;

  beforeEach(() => {
    const cs = { get: (k: string) => k === 'LOCAL_STORAGE_DIR' ? '/tmp/ls-test' : null } as any;
    provider = new LocalStorageProvider(cs);
  });

  // ── getUrl (tests sanitizeKey via public API) ──────────────────────

  describe('getUrl', () => {
    it('throws for traversal key with ..', async () => {
      await expect(provider.getUrl('../.env')).rejects.toThrow(/traversal|denied/i);
    });

    it('throws for traversal key with forward slash', async () => {
      await expect(provider.getUrl('foo/bar')).rejects.toThrow();
    });

    it('throws for traversal key with backslash', async () => {
      await expect(provider.getUrl('foo\\bar')).rejects.toThrow();
    });

    it('throws for null byte in key', async () => {
      await expect(provider.getUrl('legit\x00bad')).rejects.toThrow();
    });

    it('throws for non-existent UUID key', async () => {
      await expect(provider.getUrl('00000000-0000-0000-0000-000000000000')).rejects.toThrow(/not found/i);
    });
  });

  // ── delete (silently drops traversal keys) ─────────────────────────

  describe('delete', () => {
    it('silently ignores traversal key', async () => {
      await expect(provider.delete('../.env')).resolves.toBeUndefined();
    });
  });

  // ── upload ─────────────────────────────────────────────────────────

  describe('upload', () => {
    it('generates a UUID key (safe, not user-controlled)', async () => {
      const result = await provider.upload(Buffer.from('data'), 'test.txt', 'text/plain');
      expect(result.providerKey).toMatch(/^[0-9a-f-]+$/);
      expect(result.etag).toBeDefined();
    });
  });

  // ── healthCheck ────────────────────────────────────────────────────

  describe('healthCheck', () => {
    it('returns boolean', async () => {
      const result = await provider.healthCheck();
      expect(typeof result).toBe('boolean');
    });
  });
});
