import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import * as dotenv from 'dotenv'; dotenv.config();
import { TelegramService } from './telegram.service';

const mockConfig = { get: jest.fn((k: string) => {
  if (k === 'TG_BOT_TOKEN') return '123:abc';
  if (k === 'TG_CHANNEL_ID') return '-100';
  if (k === 'CF_WORKERS_URL') return '';
  if (k === 'CF_WORKERS_SECRET') return '';
  if (k === 'NODE_ENV') return 'development';
  return null;
})};

describe('TelegramService (REAL CONFIG)', () => {
  let service: TelegramService;

  beforeAll(async () => {
    const m = await Test.createTestingModule({
      providers: [
        TelegramService,
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();
    service = m.get<TelegramService>(TelegramService);
  });

  it('getFileUrl requires CF_WORKERS_URL', async () => {
    await expect(service.getFileUrl('file-id')).rejects.toThrow();
  });

  it('service is defined', () => {
    expect(service).toBeDefined();
  });
});
