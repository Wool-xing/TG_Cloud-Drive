import { Test } from '@nestjs/testing';
import { ValidationPipe, CanActivate, ExecutionContext, INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { SharesController } from './shares.controller';
import { SharesService } from './shares.service';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter';
import { TransformInterceptor } from '../common/interceptors/transform.interceptor';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';

// ── guard that respects @Public ──────────────────────────────────────────

let __authGate = true;

class PublicAwareGuard implements CanActivate {
  private reflector = new Reflector();

  canActivate(ctx: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(), ctx.getClass(),
    ]);
    if (isPublic) return true;
    if (!__authGate) throw new (require('@nestjs/common').UnauthorizedException)('请先登录');
    const req = ctx.switchToHttp().getRequest();
    req.user = { id: 'u-1', username: 'tester', deviceId: 'dev-1' };
    return true;
  }
}

function buildApp(svcMock: Record<string, jest.Mock>): Promise<INestApplication> {
  return Test.createTestingModule({
    controllers: [SharesController],
    providers: [{ provide: SharesService, useValue: svcMock }],
  })
    .compile()
    .then(mod => {
      const app = mod.createNestApplication();
      app.use(cookieParser());
      app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
      app.useGlobalFilters(new HttpExceptionFilter());
      app.useGlobalInterceptors(new TransformInterceptor());
      app.useGlobalGuards(new PublicAwareGuard());
      return app.init();
    });
}

describe('SharesController — integration (supertest)', () => {
  let app: INestApplication;
  let svc: Record<string, jest.Mock>;

  beforeEach(async () => {
    __authGate = true;
    svc = {
      createShare: jest.fn(),
      listMyShares: jest.fn(),
      accessShare: jest.fn(),
      incrementDownload: jest.fn(),
      getShareToken: jest.fn(),
      deleteShare: jest.fn(),
    };
    app = await buildApp(svc);
  });

  afterEach(() => app.close());

  // ── POST /shares ──────────────────────────────────────────────────────

  describe('POST /shares', () => {
    it('returns 401 without auth', async () => {
      __authGate = false;
      const res = await request(app.getHttpServer()).post('/shares').send({});
      expect(res.status).toBe(401);
    });

    it('creates share with valid DTO', async () => {
      svc.createShare.mockResolvedValue({ id: 's-1', token: 'abc123' });
      const res = await request(app.getHttpServer())
        .post('/shares')
        .send({ nodeId: 'n-1', password: 'pwd' });
      expect(res.status).toBe(201);
      expect(res.body.data).toEqual({ id: 's-1', token: 'abc123' });
    });
  });

  // ── GET /shares/my ────────────────────────────────────────────────────

  describe('GET /shares/my', () => {
    it('returns list for authenticated user', async () => {
      svc.listMyShares.mockResolvedValue([{ id: 's-1' }]);
      const res = await request(app.getHttpServer()).get('/shares/my');
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([{ id: 's-1' }]);
    });
  });

  // ── GET /shares/access/:token (public) ────────────────────────────────

  describe('GET /shares/access/:token', () => {
    it('allows access without auth (@Public)', async () => {
      __authGate = false;
      svc.accessShare.mockResolvedValue({ nodeId: 'n-1', name: 'shared-file.txt' });
      const res = await request(app.getHttpServer()).get('/shares/access/token123?password=secret');
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ nodeId: 'n-1', name: 'shared-file.txt' });
      expect(svc.accessShare).toHaveBeenCalledWith('token123', 'secret');
    });

    it('allows access without password query param', async () => {
      __authGate = false;
      svc.accessShare.mockResolvedValue({ nodeId: 'n-1' });
      const res = await request(app.getHttpServer()).get('/shares/access/token123');
      expect(res.status).toBe(200);
    });
  });

  // ── POST /shares/access/:token/download (public) ──────────────────────

  describe('POST /shares/access/:token/download', () => {
    it('re-validates password then records download (@Public)', async () => {
      __authGate = false;
      svc.accessShare.mockResolvedValue({ shareId: 's-1' });
      svc.incrementDownload.mockResolvedValue(undefined);
      const res = await request(app.getHttpServer())
        .post('/shares/access/token123/download')
        .send({ password: 'secret' });
      expect(res.status).toBe(204);
    });
  });

  // ── GET /shares/:id/token ─────────────────────────────────────────────

  describe('GET /shares/:id/token', () => {
    it('returns full token for owner', async () => {
      svc.getShareToken.mockResolvedValue({ token: 'full-token-abc' });
      const res = await request(app.getHttpServer()).get('/shares/00000000-0000-0000-0000-000000000001/token');
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ token: 'full-token-abc' });
    });
  });

  // ── DELETE /shares/:id ────────────────────────────────────────────────

  describe('DELETE /shares/:id', () => {
    it('deletes share by id', async () => {
      svc.deleteShare.mockResolvedValue({ success: true });
      const res = await request(app.getHttpServer()).delete('/shares/00000000-0000-0000-0000-000000000001');
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ success: true });
    });
  });
});
