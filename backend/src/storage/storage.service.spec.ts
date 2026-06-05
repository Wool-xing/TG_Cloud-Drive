import { Test, TestingModule } from '@nestjs/testing';
import { StorageService } from './storage.service';
import { R2StorageProvider } from './r2-storage.provider';
import { TelegramStorageProvider } from './telegram-storage.provider';
import { LocalStorageProvider } from './local-storage.provider';

describe('StorageService', () => {
  let service: StorageService;
  let mockR2: any;
  let mockTelegram: any;
  let mockLocal: any;

  beforeEach(async () => {
    mockR2 = {
      isEnabled: jest.fn().mockReturnValue(true),
      upload: jest.fn(),
      getUrl: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
      healthCheck: jest.fn(),
    };
    (mockR2 as any).constructor = { buildKey: jest.fn((uid, nid, ci) => `${uid}/${nid}/chunk_${ci}`) };

    mockTelegram = {
      isEnabled: jest.fn().mockReturnValue(true),
      upload: jest.fn(),
      getUrl: jest.fn(),
      delete: jest.fn(),
      healthCheck: jest.fn(),
    };

    mockLocal = {
      isEnabled: jest.fn().mockReturnValue(false),
      upload: jest.fn(),
      getUrl: jest.fn(),
      delete: jest.fn(),
      healthCheck: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorageService,
        { provide: R2StorageProvider, useValue: mockR2 },
        { provide: TelegramStorageProvider, useValue: mockTelegram },
        { provide: LocalStorageProvider, useValue: mockLocal },
      ],
    }).compile();

    service = module.get(StorageService);
  });

  describe('getPrimary', () => {
    it('returns r2 when r2 is enabled', () => {
      expect(service.getPrimary()).toBe('r2');
    });

    it('returns local when r2 is disabled', async () => {
      mockR2.isEnabled.mockReturnValue(false);
      mockLocal.isEnabled.mockReturnValue(true);
      const m = await Test.createTestingModule({
        providers: [
          StorageService,
          { provide: R2StorageProvider, useValue: mockR2 },
          { provide: TelegramStorageProvider, useValue: mockTelegram },
          { provide: LocalStorageProvider, useValue: mockLocal },
        ],
      }).compile();
      const svc = m.get(StorageService);
      expect(svc.getPrimary()).toBe('local');
    });
  });

  describe('upload', () => {
    it('delegates to R2 upload with key as filename', async () => {
      const buf = Buffer.from('data');
      mockR2.upload.mockResolvedValue({ key: 'k1', size: 100 });
      const r = await service.upload('r2', buf, 'user/n1/chunk_0', 'application/octet-stream');
      expect(mockR2.upload).toHaveBeenCalledWith(buf, 'user/n1/chunk_0', 'application/octet-stream');
      expect(r).toEqual({ key: 'k1', size: 100 });
    });

    it('delegates to Telegram upload with timestamped filename', async () => {
      const before = Date.now();
      mockTelegram.upload.mockResolvedValue({ key: 'tg-file-id', size: 200 });
      const r = await service.upload('telegram', Buffer.from('x'), 'any-key', 'image/png');
      expect(mockTelegram.upload).toHaveBeenCalled();
      const callFilename = mockTelegram.upload.mock.calls[0][1] as string;
      expect(callFilename).toMatch(/^chunk_\d+$/);
      expect(Number(callFilename.slice(6))).toBeGreaterThanOrEqual(before);
      expect(r).toEqual({ key: 'tg-file-id', size: 200 });
    });
  });

  describe('getUrl', () => {
    it('delegates to R2 getUrl', async () => {
      mockR2.getUrl.mockResolvedValue('https://r2.example.com/obj');
      const url = await service.getUrl('r2', 'key1');
      expect(url).toBe('https://r2.example.com/obj');
      expect(mockR2.getUrl).toHaveBeenCalledWith('key1');
    });

    it('delegates to Telegram getUrl', async () => {
      mockTelegram.getUrl.mockResolvedValue('https://t.me/file/123');
      const url = await service.getUrl('telegram', 'file-id');
      expect(url).toBe('https://t.me/file/123');
    });
  });

  describe('delete', () => {
    it('delegates to provider delete', async () => {
      await service.delete('r2', 'key1', 'meta1');
      expect(mockR2.delete).toHaveBeenCalledWith('key1', 'meta1');
    });
  });

  describe('deleteMany', () => {
    it('calls R2 deleteMany when enabled', async () => {
      await service.deleteMany(['k1', 'k2']);
      expect(mockR2.deleteMany).toHaveBeenCalledWith(['k1', 'k2']);
    });

    it('skips when R2 is disabled', async () => {
      mockR2.isEnabled.mockReturnValue(false);
      await service.deleteMany(['k1']);
      expect(mockR2.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('buildR2Key', () => {
    it('delegates to R2StorageProvider.buildKey', () => {
      const key = service.buildR2Key('user-1', 'node-a', 3);
      expect(key).toBe('user-1/node-a/chunk_3');
    });
  });

  describe('healthCheck', () => {
    it('returns healthy when primary is up', async () => {
      mockR2.healthCheck.mockResolvedValue(true);
      const r = await service.healthCheck();
      expect(r).toEqual({ primary: 'r2', healthy: true });
    });

    it('returns unhealthy when primary throws', async () => {
      mockR2.healthCheck.mockRejectedValue(new Error('down'));
      const r = await service.healthCheck();
      expect(r).toEqual({ primary: 'r2', healthy: false });
    });
  });
});
