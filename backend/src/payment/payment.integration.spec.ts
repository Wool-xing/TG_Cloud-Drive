import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { createTestApp, setAuthGate } from '../__tests__/test-utils';

describe('PaymentController', () => {
  let app: INestApplication;
  let svc: Record<string, jest.Mock>;

  beforeEach(async () => {
    setAuthGate(true);
    svc = { createCheckoutSession: jest.fn(), createPortalSession: jest.fn(), getSubscription: jest.fn(), handleWebhook: jest.fn() };
    app = await createTestApp(PaymentController, [{ provide: PaymentService, useValue: svc }], { rawBody: true });
  });

  afterEach(() => app.close());

  it('POST /api/payment/checkout → 401 without auth', async () => {
    setAuthGate(false);
    const res = await request(app.getHttpServer()).post('/api/payment/checkout').send({ plan: 'pro' });
    expect(res.status).toBe(401);
  });

  it('POST /api/payment/checkout → creates session', async () => {
    svc.createCheckoutSession.mockResolvedValue({ url: 'https://stripe.com/checkout' });
    const res = await request(app.getHttpServer()).post('/api/payment/checkout').send({ plan: 'pro' });
    expect(res.status).toBe(201);
  });

  it('POST /api/payment/portal → creates portal', async () => {
    svc.createPortalSession.mockResolvedValue({ url: 'https://stripe.com/portal' });
    const res = await request(app.getHttpServer()).post('/api/payment/portal');
    expect(res.status).toBe(201);
  });

  it('GET /api/payment/subscription → returns plan', async () => {
    svc.getSubscription.mockResolvedValue({ plan: 'free' });
    const res = await request(app.getHttpServer()).get('/api/payment/subscription');
    expect(res.status).toBe(200);
    expect(res.body.data.plan).toBe('free');
  });

  it('POST /api/payment/webhook → handles raw body', async () => {
    svc.handleWebhook.mockResolvedValue({ received: true });
    const res = await request(app.getHttpServer()).post('/api/payment/webhook').set('stripe-signature', 'sig_abc').send('{}');
    expect(res.status).toBe(200);
    expect(svc.handleWebhook).toHaveBeenCalledWith(expect.any(Buffer), 'sig_abc');
  });
});
