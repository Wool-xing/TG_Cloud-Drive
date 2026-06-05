import { Test } from '@nestjs/testing';
import { ValidationPipe, CanActivate, ExecutionContext, INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as request from 'supertest';
import { VerificationController } from './verification.controller';
import { VerificationService } from './verification.service';
import { VerificationPurpose } from './verification.entity';
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

function buildApp(svc: { sendCode: jest.Mock }): Promise<INestApplication> {
  return Test.createTestingModule({
    controllers: [VerificationController],
    providers: [{ provide: VerificationService, useValue: svc }],
  })
    .compile()
    .then(mod => {
      const app = mod.createNestApplication();
      app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
      app.useGlobalFilters(new HttpExceptionFilter());
      app.useGlobalInterceptors(new TransformInterceptor());
      app.useGlobalGuards(new PublicAwareGuard());
      return app.init();
    });
}

describe('VerificationController — integration (supertest)', () => {
  let app: INestApplication;
  let svc: { sendCode: jest.Mock };

  beforeEach(async () => {
    svc = { sendCode: jest.fn() };
    app = await buildApp(svc);
  });

  afterEach(() => app.close());

  describe('POST /verification/send', () => {
    it('returns 400 when purpose is invalid enum value', async () => {
      const res = await request(app.getHttpServer())
        .post('/verification/send')
        .send({ target: 'a@b.com', purpose: 'invalid' });
      expect(res.status).toBe(400);
    });

    it('returns 400 when target missing', async () => {
      const res = await request(app.getHttpServer())
        .post('/verification/send')
        .send({ purpose: VerificationPurpose.REGISTER });
      expect(res.status).toBe(400);
    });

    it('sends code with valid DTO (@Public)', async () => {
      svc.sendCode.mockResolvedValue({ sent: true, code: '123456' });
      const res = await request(app.getHttpServer())
        .post('/verification/send')
        .send({ target: 'a@b.com', purpose: VerificationPurpose.REGISTER });
      expect(res.status).toBe(201);
      expect(res.body.data).toEqual({ sent: true, code: '123456' });
    });

    it('works with LOGIN purpose', async () => {
      svc.sendCode.mockResolvedValue({ sent: true });
      const res = await request(app.getHttpServer())
        .post('/verification/send')
        .send({ target: '13800138000', purpose: VerificationPurpose.LOGIN });
      expect(res.status).toBe(201);
      expect(svc.sendCode).toHaveBeenCalledWith('13800138000', VerificationPurpose.LOGIN);
    });
  });
});
