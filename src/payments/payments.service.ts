import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import {
  PaymentConfig,
  getPaymentConfigName,
} from '../common/config/payment.config';
import { getNextBillingDate } from '../common/utils/billing.util';
import { encrypt } from '../common/utils/encryption.util';
import { Payment } from '@prisma/client';
import axios from 'axios';
import * as crypto from 'crypto';

@Injectable()
export class PaymentsService {
  private paystackBaseUrl = 'https://api.paystack.co';
  private readonly paystackSecretKey: string;
  private readonly encryptionKey: string;
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    const paymentConfig = this.configService.get<PaymentConfig>(
      getPaymentConfigName(),
    )!;
    this.paystackSecretKey = paymentConfig.paystackSecretKey;
    this.encryptionKey = paymentConfig.encryptionKey;
  }

  async initializePayment(
    subscriptionId: string,
    email: string,
    userId: string,
  ) {
    const subscription = await this.prisma.memberSubscription.findUnique({
      where: { id: subscriptionId },
      include: { plan: true },
    });
    if (!subscription) throw new BadRequestException('Subscription not found');

    if (subscription.primaryMemberId !== userId) {
      throw new ForbiddenException('You can only initialize payments for your own subscriptions');
    }

    const payment = await this.prisma.payment.create({
      data: {
        subscriptionId,
        amount: subscription.plan.price,
        paymentMethod: subscription.paymentMethod,
      },
    });

    const response = await axios.post(
      `${this.paystackBaseUrl}/transaction/initialize`,
      {
        email,
        amount: subscription.plan.price * 100,
        currency: 'KES',
        reference: `gym_${payment.id}_${Date.now()}`,
        metadata: { subscriptionId, paymentId: payment.id },
      },
      {
        headers: {
          Authorization: `Bearer ${this.paystackSecretKey}`,
          'Content-Type': 'application/json',
        },
      },
    );
    return response.data.data;
  }

  async handleWebhook(rawBody: Buffer, signature: string) {
    const hash = crypto
      .createHmac('sha512', this.paystackSecretKey)
      .update(rawBody)
      .digest('hex');
    if (hash !== signature) throw new BadRequestException('Invalid signature');

    const body = JSON.parse(rawBody.toString());

    if (body.event === 'charge.success') {
      const { reference, metadata, authorization, channel } = body.data;
      const subscriptionId = metadata?.subscriptionId;
      const paymentId = metadata?.paymentId;

      // Idempotency: skip if this reference was already processed
      if (reference) {
        const existing = await this.prisma.payment.findFirst({
          where: { paystackReference: reference },
        });
        if (existing) {
          this.logger.warn(`Duplicate webhook for reference ${reference}, skipping`);
          return { received: true };
        }
      }

      if (paymentId) {
        await this.prisma.payment.update({
          where: { id: paymentId },
          data: {
            status: 'PAID',
            paystackReference: reference,
          },
        });
      }

      if (subscriptionId) {
        const subscription = await this.prisma.memberSubscription.findUnique({
          where: { id: subscriptionId },
          include: { plan: true },
        });

        if (subscription) {
          const nextBillingDate = getNextBillingDate(
            new Date(),
            subscription.plan.billingInterval,
          );

          const updateData: any = {
            status: 'ACTIVE',
            endDate: nextBillingDate,
            nextBillingDate,
          };

          // Save card authorization for future recurring charges
          if (channel === 'card' && authorization?.authorization_code) {
            updateData.paystackAuthorizationCode = this.encryptionKey
              ? encrypt(authorization.authorization_code, this.encryptionKey)
              : authorization.authorization_code;
            updateData.paymentMethod = 'CARD';
          }

          await this.prisma.memberSubscription.update({
            where: { id: subscriptionId },
            data: updateData,
          });
        }
      }

      this.logger.log(`Webhook charge.success processed for reference ${reference}`);
    }

    if (body.event === 'charge.failed') {
      const { metadata, gateway_response } = body.data;
      const paymentId = metadata?.paymentId;

      if (paymentId) {
        await this.prisma.payment.update({
          where: { id: paymentId },
          data: {
            status: 'FAILED',
            failureReason: gateway_response || 'Payment failed',
          },
        });
      }

      this.logger.warn(`Webhook charge.failed: ${gateway_response}`);
    }

    return { received: true };
  }

  async chargeAuthorization(
    subscriptionId: string,
    authorizationCode: string,
    email: string,
    amount: number,
  ): Promise<Payment> {
    const payment = await this.prisma.payment.create({
      data: {
        subscriptionId,
        amount,
        paymentMethod: 'CARD',
      },
    });

    try {
      await axios.post(
        `${this.paystackBaseUrl}/transaction/charge_authorization`,
        {
          authorization_code: authorizationCode,
          email,
          amount: amount * 100,
          currency: 'KES',
          metadata: { subscriptionId, paymentId: payment.id },
        },
        {
          headers: {
            Authorization: `Bearer ${this.paystackSecretKey}`,
            'Content-Type': 'application/json',
          },
        },
      );
    } catch (error) {
      this.logger.error(
        `Charge authorization failed for subscription ${subscriptionId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: 'FAILED',
          failureReason: 'Charge authorization request failed',
        },
      });
    }

    return payment;
  }

  async getPaymentHistory(memberId: string) {
    return this.prisma.payment.findMany({
      where: {
        subscription: { primaryMemberId: memberId },
      },
      include: { subscription: { include: { plan: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }
}
