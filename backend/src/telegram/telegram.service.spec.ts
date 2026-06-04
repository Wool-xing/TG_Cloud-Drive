import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { TelegramService } from './telegram.service';

describe('TelegramService', () => {
  let service: TelegramService;
  let mockConfig: any;

  beforeEach(async () => {
    mockConfig = {
      get: jest.fn((key: string) => {
        if (key === 'TG_BOT_TOKEN') return '12345:abc-token';
        if (key === 'TG_CHANNEL_ID') return '-100123';
        if (key === 'CF_WORKERS_URL') return '';
        if (key === 'CF_WORKERS_SECRET') return '';
        if (key === 'NODE_ENV') return 'development';
        return null;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [TelegramService, { provide: ConfigService, useValue: mockConfig }],
    }).compile();

    service = module.get(TelegramService);
  });

  describe('apiBase', () => {
    it('returns direct Telegram URL when no Worker configured', () => {
      expect((service as any).apiBase).toBe('https://api.telegram.org/bot12345:abc-token');
    });

    it('returns worker URL when configured', async () => {
      mockConfig.get.mockImplementation((key: string) => {
        if (key === 'CF_WORKERS_URL') return 'https://tg-worker.example.com';
        if (key === 'TG_BOT_TOKEN') return '12345:abc-token';
        return null;
      });
      const m = await Test.createTestingModule({
        providers: [TelegramService, { provide: ConfigService, useValue: mockConfig }],
      }).compile();
      const svc = m.get(TelegramService);
      expect((svc as any).apiBase).toBe('https://tg-worker.example.com/api/tg');
    });
  });

  describe('defaultHeaders', () => {
    it('includes X-Workers-Secret when secret configured', async () => {
      mockConfig.get.mockImplementation((key: string) => {
        if (key === 'CF_WORKERS_SECRET') return 'secret123';
        if (key === 'TG_BOT_TOKEN') return 'token';
        return null;
      });
      const m = await Test.createTestingModule({
        providers: [TelegramService, { provide: ConfigService, useValue: mockConfig }],
      }).compile();
      const svc = m.get(TelegramService);
      const h = (svc as any).defaultHeaders();
      expect(h['X-Workers-Secret']).toBe('secret123');
    });
  });

  describe('devDirectFallback', () => {
    it('returns true in development without worker URL', () => {
      expect((service as any).devDirectFallback).toBe(true);
    });

    it('returns false when worker URL is set', async () => {
      mockConfig.get.mockImplementation((key: string) => {
        if (key === 'CF_WORKERS_URL') return 'https://worker.example.com';
        if (key === 'TG_BOT_TOKEN') return 'token';
        if (key === 'NODE_ENV') return 'development';
        return null;
      });
      const m = await Test.createTestingModule({
        providers: [TelegramService, { provide: ConfigService, useValue: mockConfig }],
      }).compile();
      const svc = m.get(TelegramService);
      expect((svc as any).devDirectFallback).toBe(false);
    });

    it('returns false in production even without worker URL', async () => {
      mockConfig.get.mockImplementation((key: string) => {
        if (key === 'NODE_ENV') return 'production';
        if (key === 'TG_BOT_TOKEN') return 'token';
        return null;
      });
      const m = await Test.createTestingModule({
        providers: [TelegramService, { provide: ConfigService, useValue: mockConfig }],
      }).compile();
      const svc = m.get(TelegramService);
      expect((svc as any).devDirectFallback).toBe(false);
    });
  });

  describe('sendDocument', () => {
    it('refuses without worker URL in production', async () => {
      mockConfig.get.mockImplementation((key: string) => {
        if (key === 'NODE_ENV') return 'production';
        return null;
      });
      const m = await Test.createTestingModule({
        providers: [TelegramService, { provide: ConfigService, useValue: mockConfig }],
      }).compile();
      const svc = m.get(TelegramService);
      await expect(svc.sendDocument(Buffer.from('x'), 'f.bin', 'application/octet-stream'))
        .rejects.toThrow('CF_WORKERS_URL 缺失');
    });
  });

  describe('getFileUrl', () => {
    it('refuses without worker URL in production', async () => {
      mockConfig.get.mockImplementation((key: string) => {
        if (key === 'NODE_ENV') return 'production';
        return null;
      });
      const m = await Test.createTestingModule({
        providers: [TelegramService, { provide: ConfigService, useValue: mockConfig }],
      }).compile();
      const svc = m.get(TelegramService);
      await expect(svc.getFileUrl('file-id'))
        .rejects.toThrow('CF_WORKERS_URL 缺失');
    });
  });
});
