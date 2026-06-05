import { Test, TestingModule } from '@nestjs/testing';
import { WebdavController } from './webdav.controller';
import { WebdavService } from './webdav.service';

describe('WebdavController', () => {
  let controller: WebdavController;
  let webdavService: { handle: jest.Mock };

  beforeEach(async () => {
    webdavService = { handle: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [WebdavController],
      providers: [{ provide: WebdavService, useValue: webdavService }],
    }).compile();

    controller = module.get<WebdavController>(WebdavController);
    jest.clearAllMocks();
  });

  describe('ALL /dav', () => {
    it('delegates req/res to webdav.handle', async () => {
      const req = { method: 'PROPFIND' };
      const res = { status: jest.fn() };
      await controller.handleRoot(req as any, res as any);
      expect(webdavService.handle).toHaveBeenCalledWith(req, res);
    });
  });

  describe('ALL /dav/*path', () => {
    it('delegates req/res to webdav.handle', async () => {
      const req = { method: 'GET' };
      const res = { status: jest.fn() };
      await controller.handlePath(req as any, res as any, 'folder/file.txt');
      expect(webdavService.handle).toHaveBeenCalledWith(req, res);
    });
  });
});
