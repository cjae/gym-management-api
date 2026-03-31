import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { GymSettingsService } from '../gym-settings/gym-settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailService } from '../email/email.service';
import {
  PaymentConfig,
  getPaymentConfigName,
} from '../common/config/payment.config';
import {
  getNextBillingDate,
  getCycleStartDate,
} from '../common/utils/billing.util';
import { encrypt } from '../common/utils/encryption.util';
import { addPaystackCommission } from '../common/utils/paystack-commission.util';
import {
  NotificationType,
  Payment,
  PaymentMethod,
  Prisma,
} from '@prisma/client';
import axios from 'axios';
import * as crypto from 'crypto';

interface PaystackInitializeResponse {
  data: {
    authorization_url: string;
    access_code: string;
    reference: string;
  };
}

interface PaystackWebhookAuthorization {
  authorization_code?: string;
}

interface PaystackWebhookMetadata {
  subscriptionId?: string;
  paymentId?: string;
}

interface PaystackWebhookData {
  reference?: string;
  metadata?: PaystackWebhookMetadata;
  authorization?: PaystackWebhookAuthorization;
  channel?: string;
  gateway_response?: string;
}

interface PaystackWebhookBody {
  event: string;
  data: PaystackWebhookData;
}

@Injectable()
export class PaymentsService {
  private paystackBaseUrl = 'https://api.paystack.co';
  private readonly paystackSecretKey: string;
  private readonly encryptionKey: string;
  private readonly paystackCallbackUrl: string;
  private readonly paystackCancelUrl: string;
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly eventEmitter: EventEmitter2,
    private readonly gymSettingsService: GymSettingsService,
    private readonly notificationsService: NotificationsService,
    private readonly emailService: EmailService,
  ) {
    const paymentConfig = this.configService.get<PaymentConfig>(
      getPaymentConfigName(),
    )!;
    this.paystackSecretKey = paymentConfig.paystackSecretKey;
    this.encryptionKey = paymentConfig.encryptionKey;
    this.paystackCallbackUrl = paymentConfig.paystackCallbackUrl;
    this.paystackCancelUrl = paymentConfig.paystackCancelUrl;
  }

  async initializePayment(
    subscriptionId: string,
    email: string,
    userId: string,
  ) {
    this.logger.debug('initializePayment called', {
      subscriptionId,
      userId,
    });

    const subscription = await this.prisma.memberSubscription.findUnique({
      where: { id: subscriptionId },
      include: { plan: true },
    });
    if (!subscription) {
      this.logger.warn('Subscription not found', { subscriptionId });
      throw new BadRequestException('Subscription not found');
    }

    this.logger.debug('Subscription found', {
      id: subscription.id,
      paymentMethod: subscription.paymentMethod,
      status: subscription.status,
    });

    if (subscription.primaryMemberId !== userId) {
      throw new ForbiddenException(
        'You can only initialize payments for your own subscriptions',
      );
    }

    // Expire any existing PENDING payment for this subscription
    const existingPending = await this.prisma.payment.findFirst({
      where: {
        subscriptionId,
        status: 'PENDING',
      },
    });
    if (existingPending) {
      await this.prisma.payment.update({
        where: { id: existingPending.id },
        data: { status: 'EXPIRED' },
      });
    }

    const channelMap: Record<
      string,
      {
        channel: string;
        onlineMethod: 'CARD' | 'MOBILE_MONEY' | 'BANK_TRANSFER';
      }
    > = {
      CARD: { channel: 'card', onlineMethod: 'CARD' },
      CARD_IN_PERSON: { channel: 'card', onlineMethod: 'CARD' },
      MOBILE_MONEY: { channel: 'mobile_money', onlineMethod: 'MOBILE_MONEY' },
      MOBILE_MONEY_IN_PERSON: {
        channel: 'mobile_money',
        onlineMethod: 'MOBILE_MONEY',
      },
      BANK_TRANSFER: {
        channel: 'bank_transfer',
        onlineMethod: 'BANK_TRANSFER',
      },
      BANK_TRANSFER_IN_PERSON: {
        channel: 'bank_transfer',
        onlineMethod: 'BANK_TRANSFER',
      },
    };

    const mapping = channelMap[subscription.paymentMethod];
    if (!mapping) {
      throw new BadRequestException(
        `Unsupported payment method: ${subscription.paymentMethod}`,
      );
    }

    const { channel, onlineMethod } = mapping;

    const basePrice = subscription.originalPlanPrice ?? subscription.plan.price;
    const effectiveAmount = basePrice - (subscription.discountAmount ?? 0);

    const payment = await this.prisma.payment.create({
      data: {
        subscriptionId,
        amount: effectiveAmount,
        paymentMethod: onlineMethod,
      },
    });

    const chargeAmount = addPaystackCommission(effectiveAmount, onlineMethod);

    const channels = [channel];

    const payload = {
      email,
      amount: chargeAmount * 100,
      currency: 'KES',
      channels,
      reference: `gym_${payment.id}_${Date.now()}`,
      ...(this.paystackCallbackUrl && {
        callback_url: this.paystackCallbackUrl,
      }),
      metadata: {
        subscriptionId,
        paymentId: payment.id,
        ...(this.paystackCancelUrl && {
          cancel_action: this.paystackCancelUrl,
        }),
      },
    };

    this.logger.debug('Initializing Paystack payment', {
      method: subscription.paymentMethod,
      channel,
      amount: chargeAmount * 100,
      baseAmount: effectiveAmount,
    });

    try {
      const response = await axios.post<PaystackInitializeResponse>(
        `${this.paystackBaseUrl}/transaction/initialize`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${this.paystackSecretKey}`,
            'Content-Type': 'application/json',
          },
        },
      );
      return response.data.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        this.logger.error('Paystack initialization failed', {
          status: error.response?.status,
          body: error.response?.data,
          payload: { ...payload, email: '***' },
        });
      } else {
        this.logger.error(
          'Paystack initialization failed',
          error instanceof Error ? error.stack : String(error),
        );
      }
      throw new BadRequestException('Payment initialization failed');
    }
  }

  async handleWebhook(rawBody: Buffer, signature: string) {
    const hash = crypto
      .createHmac('sha512', this.paystackSecretKey)
      .update(rawBody)
      .digest('hex');
    if (hash !== signature) throw new BadRequestException('Invalid signature');

    const body: PaystackWebhookBody = JSON.parse(
      rawBody.toString(),
    ) as PaystackWebhookBody;

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
          this.logger.warn(
            `Duplicate webhook for reference ${reference}, skipping`,
          );
          return { received: true };
        }
      }

      if (paymentId) {
        const updatedPayment = await this.prisma.payment.update({
          where: { id: paymentId },
          data: {
            status: 'PAID',
            paystackReference: reference,
          },
          include: {
            subscription: {
              include: {
                primaryMember: {
                  select: {
                    id: true,
                    email: true,
                    firstName: true,
                    lastName: true,
                  },
                },
              },
            },
          },
        });

        const member = updatedPayment.subscription.primaryMember;
        const memberName = `${member.firstName} ${member.lastName}`;
        this.eventEmitter.emit('activity.payment', {
          type: 'payment',
          description: `${memberName} made a payment of ${updatedPayment.amount} ${updatedPayment.currency}`,
          timestamp: new Date().toISOString(),
          metadata: {
            paymentId,
            amount: updatedPayment.amount,
            status: 'PAID',
          },
        });
      }

      if (subscriptionId) {
        const subscription = await this.prisma.memberSubscription.findUnique({
          where: { id: subscriptionId },
          include: { plan: true },
        });

        if (subscription) {
          // If subscription is still active with remaining time, extend from
          // current endDate so early renewals don't lose leftover days.
          const now = new Date();
          const baseDate =
            subscription.status === 'ACTIVE' && subscription.endDate > now
              ? subscription.endDate
              : now;
          const nextBillingDate = getNextBillingDate(
            baseDate,
            subscription.plan.billingInterval,
          );

          const updateData: Prisma.MemberSubscriptionUpdateInput = {
            status: 'ACTIVE',
            endDate: nextBillingDate,
            nextBillingDate,
            frozenDaysUsed: 0,
            freezeCount: 0,
            // Clear discount fields after first payment so renewals charge full price
            discountAmount: null,
            originalPlanPrice: null,
          };

          // Update subscription to the online payment method so billing
          // cron picks it up for auto-charges / reminders going forward.
          const channelToMethod: Record<string, PaymentMethod> = {
            card: PaymentMethod.CARD,
            mobile_money: PaymentMethod.MOBILE_MONEY,
            bank_transfer: PaymentMethod.BANK_TRANSFER,
          };
          if (channel && channelToMethod[channel]) {
            updateData.paymentMethod = channelToMethod[channel];
          }

          // Save card authorization and enable auto-renewal for future recurring charges
          if (channel === 'card' && authorization?.authorization_code) {
            updateData.paystackAuthorizationCode = this.encryptionKey
              ? encrypt(authorization.authorization_code, this.encryptionKey)
              : authorization.authorization_code;
            updateData.autoRenew = true;
          } else {
            // Non-card channels can't be auto-charged — disable if previously enabled
            updateData.autoRenew = false;
          }

          await this.prisma.memberSubscription.update({
            where: { id: subscriptionId },
            data: updateData,
          });

          // Process referral reward if applicable
          this.processReferralReward(subscription.primaryMemberId).catch(
            (err) =>
              this.logger.error(`Failed to process referral reward: ${err}`),
          );
        }
      }

      this.logger.log(
        `Webhook charge.success processed for reference ${reference}`,
      );
    }

    if (body.event === 'charge.failed') {
      const { metadata, gateway_response } = body.data;
      const paymentId: string | undefined = metadata?.paymentId;

      if (paymentId) {
        const updatedPayment = await this.prisma.payment.update({
          where: { id: paymentId },
          data: {
            status: 'FAILED',
            failureReason: gateway_response || 'Payment failed',
          },
          include: {
            subscription: {
              include: {
                primaryMember: {
                  select: {
                    id: true,
                    email: true,
                    firstName: true,
                    lastName: true,
                  },
                },
              },
            },
          },
        });

        const member = updatedPayment.subscription.primaryMember;
        const memberName = `${member.firstName} ${member.lastName}`;
        this.eventEmitter.emit('activity.payment', {
          type: 'payment',
          description: `Payment of ${updatedPayment.amount} ${updatedPayment.currency} by ${memberName} failed`,
          timestamp: new Date().toISOString(),
          metadata: {
            paymentId,
            amount: updatedPayment.amount,
            status: 'FAILED',
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

    const chargeAmount = addPaystackCommission(amount, 'CARD');

    try {
      await axios.post(
        `${this.paystackBaseUrl}/transaction/charge_authorization`,
        {
          authorization_code: authorizationCode,
          email,
          amount: chargeAmount * 100,
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

  @Cron(CronExpression.EVERY_DAY_AT_3AM, { timeZone: 'Africa/Nairobi' })
  async expireStalePendingPayments() {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const { count } = await this.prisma.payment.updateMany({
      where: {
        status: 'PENDING',
        createdAt: { lt: twentyFourHoursAgo },
      },
      data: { status: 'EXPIRED' },
    });

    if (count > 0) {
      this.logger.log(`Expired ${count} stale pending payment(s)`);
    }
  }

  async getPaymentHistory(memberId: string, page = 1, limit = 20) {
    const where = { subscription: { primaryMemberId: memberId } };

    const [data, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        include: { subscription: { include: { plan: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.payment.count({ where }),
    ]);

    const sanitized = data.map((payment) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { paystackAuthorizationCode, ...sub } = payment.subscription;
      return { ...payment, subscription: sub };
    });

    return { data: sanitized, total, page, limit };
  }

  private async processReferralReward(payingUserId: string) {
    // Atomically claim the referral to prevent double-rewarding on duplicate webhooks
    const claimed = await this.prisma.referral.updateMany({
      where: { referredId: payingUserId, status: 'PENDING' },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });

    if (claimed.count === 0) return;

    const referral = await this.prisma.referral.findUnique({
      where: { referredId: payingUserId },
      include: {
        referrer: {
          select: {
            id: true,
            status: true,
            deletedAt: true,
            email: true,
            firstName: true,
          },
        },
        referred: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    });

    if (!referral) return;

    // Skip reward if referrer is inactive or deleted
    if (
      referral.referrer.status !== 'ACTIVE' ||
      referral.referrer.deletedAt !== null
    ) {
      return;
    }

    const referrerSubscription = await this.prisma.memberSubscription.findFirst(
      {
        where: {
          primaryMemberId: referral.referrerId,
          status: { in: ['ACTIVE', 'FROZEN'] },
        },
        include: { plan: true },
      },
    );

    const settings = await this.gymSettingsService.getCachedSettings();
    const rewardDays = settings?.referralRewardDays ?? 7;
    const maxPerCycle = settings?.maxReferralsPerCycle ?? 3;

    let earnedDays = 0;
    if (referrerSubscription) {
      // Derive current billing cycle start from nextBillingDate - interval
      const cycleStart = getCycleStartDate(
        referrerSubscription.nextBillingDate,
        referrerSubscription.startDate,
        referrerSubscription.plan.billingInterval,
      );

      const completedInCycle = await this.prisma.referral.count({
        where: {
          referrerId: referral.referrerId,
          status: 'COMPLETED',
          rewardDays: { gt: 0 },
          completedAt: { gte: cycleStart },
          id: { not: referral.id },
        },
      });

      if (completedInCycle < maxPerCycle) {
        earnedDays = rewardDays;

        const newEndDate = new Date(referrerSubscription.endDate);
        newEndDate.setDate(newEndDate.getDate() + rewardDays);
        const newBillingDate = referrerSubscription.nextBillingDate
          ? new Date(referrerSubscription.nextBillingDate)
          : null;
        if (newBillingDate) {
          newBillingDate.setDate(newBillingDate.getDate() + rewardDays);
        }

        await this.prisma.memberSubscription.update({
          where: { id: referrerSubscription.id },
          data: {
            endDate: newEndDate,
            ...(newBillingDate && { nextBillingDate: newBillingDate }),
          },
        });
      }
    }

    // Update reward days on the already-claimed referral
    await this.prisma.referral.update({
      where: { id: referral.id },
      data: { rewardDays: earnedDays },
    });

    if (earnedDays > 0) {
      const referredName = `${referral.referred.firstName} ${referral.referred.lastName}`;

      this.notificationsService
        .create({
          userId: referral.referrerId,
          title: 'Referral reward earned!',
          body: `${referredName} joined — you earned ${earnedDays} free days!`,
          type: NotificationType.REFERRAL_REWARD,
          metadata: {
            referredId: referral.referredId,
            referredName,
            rewardDays: earnedDays,
          },
        })
        .catch((err) =>
          this.logger.error(`Failed to send referral notification: ${err}`),
        );

      this.emailService
        .sendReferralRewardEmail(
          referral.referrer.email,
          referral.referrer.firstName,
          referredName,
          earnedDays,
        )
        .catch((err) =>
          this.logger.error(`Failed to send referral email: ${err}`),
        );
    }
  }
}
