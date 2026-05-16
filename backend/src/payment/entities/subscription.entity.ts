import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index, ManyToOne, JoinColumn } from 'typeorm';
import { User } from '../../users/entities/user.entity';

export type PlanTier = 'free' | 'pro' | 'business';

export const PLAN_CONFIG: Record<PlanTier, {
  name: string;
  storageGB: number;
  monthlyPriceCents: number;
  stripePriceId: string;
  features: string[];
}> = {
  free: {
    name: 'Free',
    storageGB: 5,
    monthlyPriceCents: 0,
    stripePriceId: '', // no Stripe price for free
    features: ['5GB storage', 'Basic upload/download', 'WebDAV access'],
  },
  pro: {
    name: 'Pro',
    storageGB: 100,
    monthlyPriceCents: 999, // $9.99
    stripePriceId: process.env.STRIPE_PRO_PRICE_ID || '',
    features: ['100GB storage', 'Priority download speed', '30-day version history', 'File request links', 'WebDAV', 'Email support'],
  },
  business: {
    name: 'Business',
    storageGB: 1000,
    monthlyPriceCents: 2999, // $29.99
    stripePriceId: process.env.STRIPE_BUSINESS_PRICE_ID || '',
    features: ['1TB storage', 'Max download speed', 'Unlimited version history', 'File request links', 'WebDAV', 'Priority support', 'Admin audit log', 'API access'],
  },
};

export function planQuotaGB(tier: PlanTier): number {
  return PLAN_CONFIG[tier]?.storageGB ?? 5;
}

export function planQuotaBytes(tier: PlanTier): number {
  return planQuotaGB(tier) * 1024 * 1024 * 1024;
}

@Entity('subscriptions')
export class Subscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ name: 'user_id' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'stripe_subscription_id', unique: true, nullable: true })
  stripeSubscriptionId: string;

  @Column({ name: 'stripe_customer_id', nullable: true })
  stripeCustomerId: string;

  @Column({ length: 20, default: 'free' })
  plan: PlanTier;

  @Column({ length: 20, default: 'active' })
  status: string; // active | past_due | canceled | incomplete

  @Column({ name: 'current_period_start', type: 'timestamptz', nullable: true })
  currentPeriodStart: Date;

  @Column({ name: 'current_period_end', type: 'timestamptz', nullable: true })
  currentPeriodEnd: Date;

  @Column({ name: 'cancel_at_period_end', default: false })
  cancelAtPeriodEnd: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
