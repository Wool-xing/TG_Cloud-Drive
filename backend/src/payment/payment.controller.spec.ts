import { Test, TestingModule } from '@nestjs/testing';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';

describe('PaymentController', () => {
  let controller: PaymentController;
  let paymentService: Record<string, jest.Mock>;

  beforeEach(async () => {
    paymentService = {
      createCheckoutSession: jest.fn(),
      createPortalSession: jest.fn(),
      getSubscription: jest.fn(),
      handleWebhook: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PaymentController],
      providers: [{ provide: PaymentService, useValue: paymentService }],
    }).compile();

    controller = module.get<PaymentController>(PaymentController);
    jest.clearAllMocks();
  });

  describe('POST /api/payment/checkout', () => {
    it('delegates to paymentService.createCheckoutSession', async () => {
      paymentService.createCheckoutSession.mockResolvedValue({ url: 'https://stripe.com/checkout' });
      const result = await controller.createCheckout('u-1', 'pro');
      expect(paymentService.createCheckoutSession).toHaveBeenCalledWith('u-1', 'pro');
      expect(result).toEqual({ url: 'https://stripe.com/checkout' });
    });
  });

  describe('POST /api/payment/portal', () => {
    it('delegates to paymentService.createPortalSession', async () => {
      paymentService.createPortalSession.mockResolvedValue({ url: 'https://stripe.com/portal' });
      const result = await controller.createPortal('u-1');
      expect(paymentService.createPortalSession).toHaveBeenCalledWith('u-1');
      expect(result).toEqual({ url: 'https://stripe.com/portal' });
    });
  });

  describe('GET /api/payment/subscription', () => {
    it('delegates to paymentService.getSubscription', async () => {
      paymentService.getSubscription.mockResolvedValue({ plan: 'free' });
      const result = await controller.getSubscription('u-1');
      expect(paymentService.getSubscription).toHaveBeenCalledWith('u-1');
      expect(result).toEqual({ plan: 'free' });
    });
  });

  describe('POST /api/payment/webhook', () => {
    it('delegates raw body and signature to handleWebhook', async () => {
      paymentService.handleWebhook.mockResolvedValue({ received: true });
      const req = { rawBody: Buffer.from('{}') } as any;
      const result = await controller.webhook(req, 'sig_abc');
      expect(paymentService.handleWebhook).toHaveBeenCalledWith(Buffer.from('{}'), 'sig_abc');
      expect(result).toEqual({ received: true });
    });
  });
});
