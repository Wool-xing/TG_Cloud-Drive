import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PaymentService } from './payment.service';
import { Subscription, PlanTier, planQuotaBytes } from './entities/subscription.entity';
import { User } from '../users/entities/user.entity';

describe('PaymentService', () => {
  let service: PaymentService;
  let subRepo: any;
  let userRepo: any;

  beforeEach(async () => {
    subRepo = { findOne: jest.fn(), create: jest.fn(), save: jest.fn(), update: jest.fn() };
    userRepo = { findOne: jest.fn(), update: jest.fn() };
    const mockConfig = {
      get: jest.fn((key: string) => {
        if (key === 'APP_URL') return 'https://tgpan.example.com';
        if (key === 'DEFAULT_USER_QUOTA_GB') return 50;
        return null;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentService,
        { provide: getRepositoryToken(Subscription), useValue: subRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get(PaymentService);
  });

  describe('createCheckoutSession', () => {
    it('throws for free plan', async () => {
      await expect(
        service.createCheckoutSession('user-1', 'free'),
      ).rejects.toThrow('Free plan does not require payment');
    });

    it('throws when user not found', async () => {
      userRepo.findOne.mockResolvedValue(null);
      await expect(
        service.createCheckoutSession('user-1', 'pro'),
      ).rejects.toThrow('User not found');
    });
  });

  describe('getSubscription', () => {
    it('returns default free tier when no subscription exists', async () => {
      subRepo.findOne.mockResolvedValue(null);
      userRepo.findOne.mockResolvedValue({ quotaBytes: 10 * 1024 * 1024 * 1024, usedBytes: 0 });
      const result = await service.getSubscription('user-1');
      expect(result.plan).toBe('free');
      expect(result.status).toBe('active');
    });

    it('returns real subscription details', async () => {
      subRepo.findOne.mockResolvedValue({
        plan: 'pro', status: 'active',
        currentPeriodEnd: new Date('2026-06-01'),
        cancelAtPeriodEnd: false,
      });
      userRepo.findOne.mockResolvedValue({ quotaBytes: 100 * 1024 * 1024 * 1024, usedBytes: 500 });
      const result = await service.getSubscription('user-1');
      expect(result.plan).toBe('pro');
      expect(result.quotaBytes).toBe(100 * 1024 * 1024 * 1024);
    });
  });

  describe('handleWebhook', () => {
    it('rejects missing signature', async () => {
      await expect(service.handleWebhook(Buffer.from('{}'), '')).rejects.toThrow();
    });

    it('handles valid webhook event', async () => {
      subRepo.findOne.mockResolvedValue(null);
      subRepo.create.mockReturnValue({});
      subRepo.save.mockResolvedValue({});
      const payload = JSON.stringify({ type: 'customer.subscription.updated', data: { object: {} } });
      const r = await service.handleWebhook(Buffer.from(payload), 'valid_sig');
      expect(r).toHaveProperty('received', true);
    });
  });

  describe('createPortalSession', () => {
    it('throws when no billing account', async () => {
      subRepo.findOne.mockResolvedValue(null);
      await expect(
        service.createPortalSession('user-1'),
      ).rejects.toThrow('No billing account found');
    });
  });

  describe('planQuotaBytes', () => {
    it('returns non-zero for free plan', () => {
      expect(planQuotaBytes('free')).toBeGreaterThan(0);
    });

    it('returns larger quota for pro', () => {
      expect(planQuotaBytes('pro')).toBeGreaterThan(planQuotaBytes('free'));
    });

    it('returns largest for business', () => {
      expect(planQuotaBytes('business')).toBeGreaterThan(planQuotaBytes('pro'));
    });
  });
});
