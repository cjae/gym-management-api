import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import {
  PaymentConfig,
  getPaymentConfigName,
} from '../common/config/payment.config';
import { getNextBillingDate } from '../common/utils/billing.util';
import { Payment } from '@prisma/client';
import axios from 'axios';
import * as crypto from 'crypto';

@Injectable()
export class PaymentsService {
  private paystackBaseUrl = 'https://api.paystack.co';
  private readonly paystackSecretKey: string;

  constructor(
    private prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    const paymentConfig = this.configService.get<PaymentConfig>(
      getPaymentConfigName(),
    )!;
    this.paystackSecretKey = paymentConfig.paystackSecretKey;
  }

  async initializePayment(subscriptionId: string, email: string) {
    const subscription = await this.prisma.memberSubscription.findUnique({
      where: { id: subscriptionId },
      include: { plan: true },
    });
    if (!subscription) throw new BadRequestException('Subscription not found');

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

  async handleWebhook(body: any, signature: string) {
    const hash = crypto
      .createHmac('sha512', this.paystackSecretKey)
      .update(JSON.stringify(body))
      .digest('hex');
    if (hash !== signature) throw new BadRequestException('Invalid signature');

    if (body.event === 'charge.success') {
      const { reference, metadata, authorization, channel } = body.data;
      const subscriptionId = metadata?.subscriptionId;
      const paymentId = metadata?.paymentId;

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
            updateData.paystackAuthorizationCode =
              authorization.authorization_code;
            updateData.paymentMethod = 'CARD';
          }

          await this.prisma.memberSubscription.update({
            where: { id: subscriptionId },
            data: updateData,
          });
        }
      }
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
    } catch {
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
