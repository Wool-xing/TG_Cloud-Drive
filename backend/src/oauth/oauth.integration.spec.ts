import { Test } from '@nestjs/testing';
import { ValidationPipe, CanActivate, ExecutionContext, INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as request from 'supertest';
import { OauthController } from './oauth.controller';
import { OauthService } from './oauth.service';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter';
import { TransformInterceptor } from '../common/interceptors/transform.interceptor';

let __authGate = true;

class MockAuthGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    if (!__authGate) throw new (require('@nestjs/common').UnauthorizedException)('请先登录');
    const req = ctx.switchToHttp().getRequest();
    req.user = { id: 'u-1', username: 'tester' };
    return true;
  }
}

const mockConfig = {
  get: (key: string) => {
    if (key === 'APP_URL') return 'http://localhost:2222';
    if (key === 'NODE_ENV') return 'development';
    return null;
  },
};

function buildApp(svcMock: Record<string, jest.Mock>): Promise<INestApplication> {
  return Test.createTestingModule({
    controllers: [OauthController],
    providers: [
      { provide: OauthService, useValue: svcMock },
      { provide: ConfigService, useValue: mockConfig },
    ],
  })
    .compile()
    .then(mod => {
      const app = mod.createNestApplication();
      app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
      app.useGlobalFilters(new HttpExceptionFilter());
      app.useGlobalInterceptors(new TransformInterceptor());
      app.useGlobalGuards(new MockAuthGuard());
      return app.init();
    });
}

describe('OauthController — integration (supertest)', () => {
  let app: INestApplication;
  let svc: Record<string, jest.Mock>;

  beforeEach(async () => {
    __authGate = true;
    svc = {
      findOrCreateUser: jest.fn(),
      generateTokens: jest.fn(),
      unlinkAccount: jest.fn(),
    };
    app = await buildApp(svc);
  });

  afterEach(() => app.close());

  describe('POST /api/oauth/link/google', () => {
    it('returns not-implemented message (auth required)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/oauth/link/google')
        .send({ code: 'some-code' });
      expect(res.status).toBe(201);
      expect(res.body.data).toEqual({ message: '请在浏览器中通过跳转方式绑定' });
    });

    it('returns 401 without auth', async () => {
      __authGate = false;
      const res = await request(app.getHttpServer()).post('/api/oauth/link/google');
      expect(res.status).toBe(401);
    });
  });

  describe('DELETE /api/oauth/unlink', () => {
    it('returns 401 without auth', async () => {
      __authGate = false;
      const res = await request(app.getHttpServer()).delete('/api/oauth/unlink');
      expect(res.status).toBe(401);
    });

    it('unlinks Google account', async () => {
      svc.unlinkAccount.mockResolvedValue({ success: true });
      const res = await request(app.getHttpServer())
        .delete('/api/oauth/unlink')
        .send({ provider: 'google' });
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ success: true });
      expect(svc.unlinkAccount).toHaveBeenCalledWith('u-1', 'google');
    });

    it('unlinks GitHub account', async () => {
      svc.unlinkAccount.mockResolvedValue({ success: true });
      const res = await request(app.getHttpServer())
        .delete('/api/oauth/unlink')
        .send({ provider: 'github' });
      expect(res.status).toBe(200);
      expect(svc.unlinkAccount).toHaveBeenCalledWith('u-1', 'github');
    });
  });
});
