import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentConfig, getPaymentConfigName } from '../common/config/payment.config';
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
    const paymentConfig = this.configService.get<PaymentConfig>(getPaymentConfigName())!;
    this.paystackSecretKey = paymentConfig.paystackSecretKey;
  }

  async initializePayment(subscriptionId: string, email: string) {
    const subscription = await this.prisma.memberSubscription.findUnique({
      where: { id: subscriptionId },
      include: { plan: true },
    });
    if (!subscription) throw new BadRequestException('Subscription not found');

    const response = await axios.post(
      `${this.paystackBaseUrl}/transaction/initialize`,
      {
        email,
        amount: subscription.plan.price * 100,
        currency: 'KES',
        reference: `gym_${subscriptionId}_${Date.now()}`,
        metadata: { subscriptionId },
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
      const { reference, metadata } = body.data;
      if (metadata?.subscriptionId) {
        await this.prisma.memberSubscription.update({
          where: { id: metadata.subscriptionId },
          data: {
            paymentStatus: 'PAID',
            paystackReference: reference,
            status: 'ACTIVE',
          },
        });
      }
    }
    return { received: true };
  }

  async getPaymentHistory(memberId: string) {
    return this.prisma.memberSubscription.findMany({
      where: { primaryMemberId: memberId, paymentStatus: 'PAID' },
      include: { plan: true },
      orderBy: { createdAt: 'desc' },
    });
  }
}
