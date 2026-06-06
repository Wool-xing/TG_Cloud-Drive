import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import * as dotenv from 'dotenv'; dotenv.config();
import { TelegramService } from './telegram.service';

jest.mock('node-fetch');
const fetchMock = require('node-fetch') as jest.Mock;

// Override ALL env-dependent config to prevent .env leakage
const mockConfig = { get: jest.fn((k: string) => {
  if (k === 'TG_BOT_TOKEN') return 'mock_bot_token';
  if (k === 'TG_CHANNEL_ID') return '-100';
  if (k === 'CF_WORKERS_URL') return '';  // always empty = test devDirectFallback path
  if (k === 'CF_WORKERS_SECRET') return '';
  if (k === 'NODE_ENV') return 'development';
  return null;
})};

describe('TelegramService', () => {
  let service: TelegramService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const m = await Test.createTestingModule({
      providers: [
        TelegramService,
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();
    service = m.get<TelegramService>(TelegramService);
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  it('getFileUrl rejects without CF_WORKERS_URL', async () => {
    await expect(service.getFileUrl('file-id')).rejects.toThrow();
  });

  it('sendDocument succeeds', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, result: { document: { file_id: 'f1', file_unique_id: 'u1' } } }),
    });
    const r = await service.sendDocument(Buffer.from('data'), 'test.bin', 'application/octet-stream');
    expect(r).toHaveProperty('fileId');
  });

  it('sendDocument retries on 429', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 429 })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, result: { document: { file_id: 'f2', file_unique_id: 'u2' } } }) });
    const r = await service.sendDocument(Buffer.from('data'), 'retry.bin', 'app/octet');
    expect(r).toHaveProperty('fileId');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('sendDocument throws after max retries', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    await expect(service.sendDocument(Buffer.from('data'), 'fail.bin', 'app/octet')).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
