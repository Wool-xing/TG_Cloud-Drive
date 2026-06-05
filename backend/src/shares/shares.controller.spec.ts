import { Test, TestingModule } from '@nestjs/testing';
import { SharesController } from './shares.controller';
import { SharesService } from './shares.service';

describe('SharesController', () => {
  let controller: SharesController;
  let sharesService: Record<string, jest.Mock>;

  beforeEach(async () => {
    sharesService = {
      createShare: jest.fn(),
      listMyShares: jest.fn(),
      accessShare: jest.fn(),
      incrementDownload: jest.fn(),
      getShareToken: jest.fn(),
      deleteShare: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SharesController],
      providers: [{ provide: SharesService, useValue: sharesService }],
    }).compile();

    controller = module.get<SharesController>(SharesController);
    jest.clearAllMocks();
  });

  // ── POST /shares ───────────────────────────────────────────────────────

  describe('POST /shares', () => {
    it('delegates to sharesService.createShare', async () => {
      const dto = { nodeId: 'n-1', password: 'pwd', expiresAt: '2027-01-01' };
      sharesService.createShare.mockResolvedValue({ id: 's-1', token: 'abc' });
      const result = await controller.create('u-1', dto as any);
      expect(sharesService.createShare).toHaveBeenCalledWith('u-1', dto);
      expect(result).toEqual({ id: 's-1', token: 'abc' });
    });
  });

  // ── GET /shares/my ─────────────────────────────────────────────────────

  describe('GET /shares/my', () => {
    it('delegates to sharesService.listMyShares', async () => {
      sharesService.listMyShares.mockResolvedValue([{ id: 's-1' }]);
      const result = await controller.listMy('u-1');
      expect(sharesService.listMyShares).toHaveBeenCalledWith('u-1');
      expect(result).toEqual([{ id: 's-1' }]);
    });
  });

  // ── GET /shares/access/:token (public) ─────────────────────────────────

  describe('GET /shares/access/:token', () => {
    it('delegates with token and optional password', async () => {
      sharesService.accessShare.mockResolvedValue({ nodeId: 'n-1', name: 'file.txt' });
      const result = await controller.access('abc123', 'pwd');
      expect(sharesService.accessShare).toHaveBeenCalledWith('abc123', 'pwd');
      expect(result).toEqual({ nodeId: 'n-1', name: 'file.txt' });
    });

    it('passes undefined password when not provided', async () => {
      sharesService.accessShare.mockResolvedValue({ nodeId: 'n-1' });
      await controller.access('abc123');
      expect(sharesService.accessShare).toHaveBeenCalledWith('abc123', undefined);
    });
  });

  // ── POST /shares/access/:token/download (public) ───────────────────────

  describe('POST /shares/access/:token/download', () => {
    it('re-validates access then increments download', async () => {
      sharesService.accessShare.mockResolvedValue({ shareId: 's-1' });
      await controller.recordDownload('abc123', { password: 'pwd' });
      expect(sharesService.accessShare).toHaveBeenCalledWith('abc123', 'pwd');
      expect(sharesService.incrementDownload).toHaveBeenCalledWith('s-1');
    });
  });

  // ── GET /shares/:id/token ──────────────────────────────────────────────

  describe('GET /shares/:id/token', () => {
    it('delegates to sharesService.getShareToken', async () => {
      sharesService.getShareToken.mockResolvedValue({ token: 'full-token' });
      const result = await controller.getToken('u-1', 's-1');
      expect(sharesService.getShareToken).toHaveBeenCalledWith('u-1', 's-1');
      expect(result).toEqual({ token: 'full-token' });
    });
  });

  // ── DELETE /shares/:id ─────────────────────────────────────────────────

  describe('DELETE /shares/:id', () => {
    it('delegates to sharesService.deleteShare', async () => {
      sharesService.deleteShare.mockResolvedValue({ success: true });
      const result = await controller.delete('u-1', 's-1');
      expect(sharesService.deleteShare).toHaveBeenCalledWith('u-1', 's-1');
      expect(result).toEqual({ success: true });
    });
  });
});
