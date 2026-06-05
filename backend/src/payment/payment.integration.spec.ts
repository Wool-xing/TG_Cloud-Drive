import { Test } from '@nestjs/testing';
import { ValidationPipe, CanActivate, ExecutionContext, INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
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

function buildApp(svcMock: Record<string, jest.Mock>): Promise<INestApplication> {
  return Test.createTestingModule({
    controllers: [PaymentController],
    providers: [{ provide: PaymentService, useValue: svcMock }],
  })
    .compile()
    .then(mod => {
      const app = mod.createNestApplication({ rawBody: true });
      app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
      app.useGlobalFilters(new HttpExceptionFilter());
      app.useGlobalInterceptors(new TransformInterceptor());
      app.useGlobalGuards(new MockAuthGuard());
      return app.init();
    });
}

describe('PaymentController — integration (supertest)', () => {
  let app: INestApplication;
  let svc: Record<string, jest.Mock>;

  beforeEach(async () => {
    __authGate = true;
    svc = {
      createCheckoutSession: jest.fn(),
      createPortalSession: jest.fn(),
      getSubscription: jest.fn(),
      handleWebhook: jest.fn(),
    };
    app = await buildApp(svc);
  });

  afterEach(() => app.close());

  describe('POST /api/payment/checkout', () => {
    it('returns 401 without auth', async () => {
      __authGate = false;
      const res = await request(app.getHttpServer()).post('/api/payment/checkout').send({ plan: 'pro' });
      expect(res.status).toBe(401);
    });

    it('creates checkout session', async () => {
      svc.createCheckoutSession.mockResolvedValue({ url: 'https://stripe.com/checkout' });
      const res = await request(app.getHttpServer())
        .post('/api/payment/checkout')
        .send({ plan: 'pro' });
      expect(res.status).toBe(201);
      expect(res.body.data).toEqual({ url: 'https://stripe.com/checkout' });
    });
  });

  describe('POST /api/payment/portal', () => {
    it('creates portal session', async () => {
      svc.createPortalSession.mockResolvedValue({ url: 'https://stripe.com/portal' });
      const res = await request(app.getHttpServer()).post('/api/payment/portal');
      expect(res.status).toBe(201);
      expect(res.body.ok).toBe(true);
    });
  });

  describe('GET /api/payment/subscription', () => {
    it('returns subscription for user', async () => {
      svc.getSubscription.mockResolvedValue({ plan: 'free', quotaBytes: 10737418240 });
      const res = await request(app.getHttpServer()).get('/api/payment/subscription');
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ plan: 'free', quotaBytes: 10737418240 });
    });
  });

  describe('POST /api/payment/webhook', () => {
    it('handles Stripe webhook with raw body', async () => {
      svc.handleWebhook.mockResolvedValue({ received: true });
      const res = await request(app.getHttpServer())
        .post('/api/payment/webhook')
        .set('stripe-signature', 'sig_abc')
        .send('{}');
      expect(res.status).toBe(200);
      expect(svc.handleWebhook).toHaveBeenCalledWith(expect.any(Buffer), 'sig_abc');
    });
  });
});
