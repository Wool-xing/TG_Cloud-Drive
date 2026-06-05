import { Test } from '@nestjs/testing';
import { ValidationPipe, CanActivate, ExecutionContext, INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as request from 'supertest';
import { WebdavController } from './webdav.controller';
import { WebdavService } from './webdav.service';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter';
import { TransformInterceptor } from '../common/interceptors/transform.interceptor';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';

class PublicAwareGuard implements CanActivate {
  private reflector = new Reflector();
  canActivate(ctx: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(), ctx.getClass(),
    ]);
    if (isPublic) return true;
    throw new (require('@nestjs/common').UnauthorizedException)('请先登录');
  }
}

describe('WebdavController — integration (supertest)', () => {
  let app: INestApplication;
  let webdav: { handle: jest.Mock };

  beforeEach(async () => {
    webdav = { handle: jest.fn() };
    const mod = await Test.createTestingModule({
      controllers: [WebdavController],
      providers: [{ provide: WebdavService, useValue: webdav }],
    }).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalInterceptors(new TransformInterceptor());
    app.useGlobalGuards(new PublicAwareGuard());
    await app.init();
  });

  afterEach(() => app.close());

  describe('ALL /dav', () => {
    it('serves root WebDAV request (public, no auth)', async () => {
      webdav.handle.mockImplementation((_req, res) => res.status(207).send(''));
      const res = await request(app.getHttpServer()).propfind('/dav');
      // WebDAV response bypasses transform interceptor (res.send used directly)
      expect(res.status).toBe(207);
      expect(webdav.handle).toHaveBeenCalled();
    });
  });

  describe('ALL /dav/*path', () => {
    it('serves sub-path WebDAV request', async () => {
      webdav.handle.mockImplementation((_req, res) => res.status(207).send(''));
      const res = await request(app.getHttpServer()).get('/dav/folder/file.txt');
      expect(res.status).toBe(207);
      expect(webdav.handle).toHaveBeenCalled();
    });
  });
});
