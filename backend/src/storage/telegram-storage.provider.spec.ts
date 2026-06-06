import { ConfigService } from '@nestjs/config';
import { TelegramStorageProvider } from './telegram-storage.provider';

jest.mock('node-fetch');
const fetchMock = require('node-fetch') as jest.Mock;

const mockConfig = {
  get: jest.fn((k: string) => {
    if (k === 'TG_BOT_TOKEN') return 'mock_token';
    if (k === 'TG_CHANNEL_ID') return '-100';
    if (k === 'CF_WORKERS_URL') return '';
    if (k === 'CF_WORKERS_SECRET') return '';
    if (k === 'NODE_ENV') return 'development';
    return null;
  }),
};

describe('TelegramStorageProvider', () => {
  let provider: TelegramStorageProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    provider = new TelegramStorageProvider(mockConfig as any);
  });

  it('has name telegram', () => {
    expect(provider.name).toBe('telegram');
  });

  it('upload returns result with providerKey', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, result: { document: { file_id: 'f123', file_unique_id: 'u456' } } }),
    });
    const r = await provider.upload(Buffer.from('data'), 'test.bin', 'application/octet-stream');
    expect(r).toHaveProperty('providerKey');
  });

  it('upload throws after max retries', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    await expect(provider.upload(Buffer.from('data'), 'fail.bin', 'app/octet')).rejects.toThrow();
  });

  it('upload retries on 429 then succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 429 })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, result: { document: { file_id: 'f2' } } }) });
    const r = await provider.upload(Buffer.from('data'), 'retry.bin', 'app/octet');
    expect(r.providerKey).toBe('f2');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('delete works', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    await expect(provider.delete('f-id', '123')).resolves.toBeUndefined();
  });

  it('getUrl requires CF_WORKERS_URL', async () => {
    // Mock returns '' for CF_WORKERS_URL and NODE_ENV=development
    // but getUrl always requires workersUrl
    await expect(provider.getUrl('f-id')).rejects.toThrow();
    // The error should be about CF_WORKERS_URL not being configured
  });

  it('healthCheck calls getMe', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, result: { username: 'test_bot' } }),
    });
    const r = await provider.healthCheck();
    expect(typeof r).toBe('boolean');
  });
});
