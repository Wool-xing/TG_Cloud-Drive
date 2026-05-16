import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
const Stripe = require('stripe');
import { User } from '../users/entities/user.entity';
import { Subscription, PlanTier, PLAN_CONFIG, planQuotaBytes } from './entities/subscription.entity';

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);
  private stripe: any;
  private webhookSecret: string;

  constructor(
    @InjectRepository(Subscription) private subRepo: Repository<Subscription>,
    @InjectRepository(User) private userRepo: Repository<User>,
    private cs: ConfigService,
  ) {
    const key = cs.get<string>('STRIPE_SECRET_KEY');
    this.webhookSecret = cs.get<string>('STRIPE_WEBHOOK_SECRET') || '';
    if (key) {
      this.stripe = new Stripe(key);
    }
  }

  /** Create a Stripe Checkout session for upgrading from free */
  async createCheckoutSession(userId: string, plan: PlanTier): Promise<{ url: string }> {
    if (plan === 'free') throw new BadRequestException('Free plan does not require payment');

    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const priceId = PLAN_CONFIG[plan].stripePriceId;
    if (!priceId) throw new BadRequestException(`No Stripe price configured for ${plan} plan`);

    let sub = await this.subRepo.findOne({ where: { userId } });
    const customerId = sub?.stripeCustomerId;

    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${this.cs.get<string>('APP_URL')}/profile?billing=success`,
      cancel_url: `${this.cs.get<string>('APP_URL')}/profile?billing=canceled`,
      client_reference_id: userId,
      customer: customerId || undefined,
      customer_email: !customerId ? undefined : undefined,
      metadata: { userId, plan },
      subscription_data: { metadata: { userId, plan } },
    });

    return { url: session.url! };
  }

  /** Create a Stripe Customer Portal session for managing billing */
  async createPortalSession(userId: string): Promise<{ url: string }> {
    const sub = await this.subRepo.findOne({ where: { userId } });
    if (!sub?.stripeCustomerId) throw new BadRequestException('No billing account found');

    const session = await this.stripe.billingPortal.sessions.create({
      customer: sub.stripeCustomerId,
      return_url: `${this.cs.get<string>('APP_URL')}/profile`,
    });

    return { url: session.url };
  }

  /** Get current subscription info for the user */
  async getSubscription(userId: string) {
    const sub = await this.subRepo.findOne({ where: { userId } });
    if (!sub) {
      // User hasn't been through billing flow yet — default free tier
      const user = await this.userRepo.findOne({ where: { id: userId } });
      return {
        plan: 'free' as PlanTier,
        status: 'active',
        quotaBytes: user?.quotaBytes ?? planQuotaBytes('free'),
        usedBytes: user?.usedBytes ?? 0,
      };
    }
    const user = await this.userRepo.findOne({ where: { id: userId } });
    return {
      plan: sub.plan,
      status: sub.status,
      currentPeriodEnd: sub.currentPeriodEnd,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      quotaBytes: user?.quotaBytes ?? planQuotaBytes(sub.plan),
      usedBytes: user?.usedBytes ?? 0,
    };
  }

  /** Handle Stripe webhook events */
  async handleWebhook(rawBody: Buffer, signature: string): Promise<{ received: boolean }> {
    let event: any;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
    } catch (e: any) {
      this.logger.error(`Webhook signature verification failed: ${e.message}`);
      throw new BadRequestException('Invalid webhook signature');
    }

    try {
      await this.processEvent(event);
    } catch (e: any) {
      this.logger.error(`Webhook event ${event.type} processing failed: ${e.message}`);
    }

    return { received: true };
  }

  private async processEvent(event: any) {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        if (session.mode === 'subscription') {
          await this.handleCheckoutCompleted(session);
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const stripeSub = event.data.object;
        await this.syncSubscription(stripeSub);
        break;
      }
      case 'customer.subscription.deleted': {
        const stripeSub = event.data.object;
        await this.handleSubscriptionCanceled(stripeSub);
        break;
      }
      case 'invoice.paid': {
        await this.handleInvoicePaid(event.data.object);
        break;
      }
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        if (invoice.subscription) {
          const stripeSub = await this.stripe.subscriptions.retrieve(invoice.subscription as string);
          await this.syncSubscription(stripeSub);
        }
        break;
      }
    }
  }

  private async handleCheckoutCompleted(session: any) {
    const userId = session.metadata?.userId || session.client_reference_id;
    if (!userId) return;

    const plan = (session.metadata?.plan || 'pro') as PlanTier;
    const stripeCustomerId = session.customer as string;
    const stripeSubscriptionId = session.subscription as string;

    let sub = await this.subRepo.findOne({ where: { userId } });
    if (sub) {
      sub.stripeCustomerId = stripeCustomerId;
      sub.stripeSubscriptionId = stripeSubscriptionId;
      sub.plan = plan;
      sub.status = 'active';
      await this.subRepo.save(sub);
    } else {
      sub = this.subRepo.create({
        userId, plan, status: 'active',
        stripeCustomerId, stripeSubscriptionId,
      });
      await this.subRepo.save(sub);
    }

    // Update user quota
    await this.userRepo.update(userId, { quotaBytes: planQuotaBytes(plan) });
    this.logger.log(`User ${userId} upgraded to ${plan}`);
  }

  private async syncSubscription(stripeSub: any) {
    const userId = stripeSub.metadata?.userId;
    if (!userId) return;

    const plan = (stripeSub.metadata?.plan || 'pro') as PlanTier;
    const status = stripeSub.status;
    const item = stripeSub.items.data[0];

    let sub = await this.subRepo.findOne({ where: { userId } });
    if (!sub) {
      sub = this.subRepo.create({
        userId,
        stripeSubscriptionId: stripeSub.id,
        stripeCustomerId: stripeSub.customer as string,
        plan,
        status,
        currentPeriodStart: new Date(stripeSub.current_period_start * 1000),
        currentPeriodEnd: new Date(stripeSub.current_period_end * 1000),
        cancelAtPeriodEnd: stripeSub.cancel_at_period_end,
      });
    } else {
      sub.status = status;
      sub.currentPeriodStart = new Date(stripeSub.current_period_start * 1000);
      sub.currentPeriodEnd = new Date(stripeSub.current_period_end * 1000);
      sub.cancelAtPeriodEnd = stripeSub.cancel_at_period_end;
      if (item?.price?.id) {
        // Map price ID to plan tier
        if (item.price.id === PLAN_CONFIG.business.stripePriceId) sub.plan = 'business';
        else if (item.price.id === PLAN_CONFIG.pro.stripePriceId) sub.plan = 'pro';
      }
    }
    await this.subRepo.save(sub);

    const quota = planQuotaBytes(sub.plan);
    await this.userRepo.update(userId, { quotaBytes: quota });

    this.logger.log(`Subscription synced: user=${userId} plan=${sub.plan} status=${status}`);
  }

  private async handleSubscriptionCanceled(stripeSub: any) {
    const userId = stripeSub.metadata?.userId;
    if (!userId) return;

    await this.subRepo.update({ userId }, { status: 'canceled', plan: 'free' });
    await this.userRepo.update(userId, { quotaBytes: planQuotaBytes('free') });
    this.logger.log(`Subscription canceled for user ${userId} — downgraded to free`);
  }

  private async handleInvoicePaid(invoice: any) {
    // Could store payment history here for audit
    this.logger.log(`Invoice paid: ${invoice.id} amount=${invoice.amount_paid}`);
  }
}
