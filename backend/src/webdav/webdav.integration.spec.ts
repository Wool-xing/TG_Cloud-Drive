import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { WebdavController } from './webdav.controller';
import { WebdavService } from './webdav.service';
import { createTestApp } from '../__tests__/test-utils';

describe('WebdavController', () => {
  let app: INestApplication;
  let webdav: { handle: jest.Mock };

  beforeEach(async () => {
    webdav = { handle: jest.fn() };
    app = await createTestApp(WebdavController, [{ provide: WebdavService, useValue: webdav }]);
  });

  afterEach(() => app.close());

  it('ALL /dav → delegates to webdav.handle (public)', async () => {
    webdav.handle.mockImplementation((_req, res) => res.status(207).send(''));
    const res = await request(app.getHttpServer()).propfind('/dav');
    expect(res.status).toBe(207);
    expect(webdav.handle).toHaveBeenCalled();
  });

  it('ALL /dav/*path → delegates sub-path', async () => {
    webdav.handle.mockImplementation((_req, res) => res.status(207).send(''));
    const res = await request(app.getHttpServer()).get('/dav/folder/file.txt');
    expect(res.status).toBe(207);
    expect(webdav.handle).toHaveBeenCalled();
  });
});
