import { Controller, Post, Get, Body, Req, Headers, RawBodyRequest, HttpCode } from '@nestjs/common';
import { Request } from 'express';
import { PaymentService } from './payment.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { PlanTier } from './entities/subscription.entity';

@Controller('api/payment')
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @Post('checkout')
  async createCheckout(@CurrentUser('id') userId: string, @Body('plan') plan: PlanTier) {
    return this.paymentService.createCheckoutSession(userId, plan);
  }

  @Post('portal')
  async createPortal(@CurrentUser('id') userId: string) {
    return this.paymentService.createPortalSession(userId);
  }

  @Get('subscription')
  async getSubscription(@CurrentUser('id') userId: string) {
    return this.paymentService.getSubscription(userId);
  }

  /**
   * Stripe webhook — must receive raw body for signature verification.
   * Express raw body is configured in main.ts for this route.
   */
  @Public()
  @Post('webhook')
  @HttpCode(200)
  async webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
  ) {
    return this.paymentService.handleWebhook(req.rawBody!, signature);
  }
}
