import { Test } from '@nestjs/testing';
import { ValidationPipe, CanActivate, ExecutionContext, INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as request from 'supertest';
import { FileRequestController } from './file-request.controller';
import { FilesService } from './files.service';
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

describe('FileRequestController — integration (supertest)', () => {
  let app: INestApplication;
  let files: { getFileRequest: jest.Mock; uploadToFileRequest: jest.Mock };

  beforeEach(async () => {
    files = { getFileRequest: jest.fn(), uploadToFileRequest: jest.fn() };
    const mod = await Test.createTestingModule({
      controllers: [FileRequestController],
      providers: [{ provide: FilesService, useValue: files }],
    }).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalInterceptors(new TransformInterceptor());
    app.useGlobalGuards(new PublicAwareGuard());
    await app.init();
  });

  afterEach(() => app.close());

  describe('GET /file-request/:token', () => {
    it('returns file request info (public, no auth)', async () => {
      files.getFileRequest.mockResolvedValue({ token: 'abc', folderName: 'uploads', maxFiles: 100 });
      const res = await request(app.getHttpServer()).get('/file-request/abc');
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ token: 'abc', folderName: 'uploads', maxFiles: 100 });
    });
  });

  describe('POST /file-request/:token/upload', () => {
    it('uploads file to request (public, no auth)', async () => {
      files.uploadToFileRequest.mockResolvedValue({ success: true });
      const res = await request(app.getHttpServer())
        .post('/file-request/abc/upload')
        .attach('file', Buffer.from('content'), 'test.txt');
      expect(res.status).toBe(201);
      expect(res.body.data).toEqual({ success: true });
    });
  });
});
