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
  getSubscriptionEndDate,
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
  type?: 'subscription' | 'shop';
  subscriptionId?: string;
  paymentId?: string;
  orderId?: string;
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

    // Atomically expire any existing PENDING payment for this subscription.
    // updateMany eliminates the findFirst → update race where two concurrent
    // initialize calls could both read no PENDING row and then both create one.
    await this.prisma.payment.updateMany({
      where: { subscriptionId, status: 'PENDING' },
      data: { status: 'EXPIRED' },
    });

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

    // Timing-safe signature comparison. `timingSafeEqual` throws on length
    // mismatch, so short-circuit that case with the same BadRequest response.
    const hashBuffer = Buffer.from(hash, 'hex');
    let signatureBuffer: Buffer;
    try {
      signatureBuffer = Buffer.from(signature ?? '', 'hex');
    } catch {
      throw new BadRequestException('Invalid signature');
    }
    if (
      hashBuffer.length !== signatureBuffer.length ||
      !crypto.timingSafeEqual(hashBuffer, signatureBuffer)
    ) {
      throw new BadRequestException('Invalid signature');
    }

    const body: PaystackWebhookBody = JSON.parse(
      rawBody.toString(),
    ) as PaystackWebhookBody;

    if (body.event === 'charge.success') {
      const { reference, metadata, authorization, channel } = body.data;

      // Route shop payments to ShopService via EventEmitter
      if (metadata?.type === 'shop') {
        const orderId = metadata.orderId;
        if (!orderId) {
          this.logger.warn(
            `shop charge.success missing orderId (reference=${reference})`,
          );
          return { received: true };
        }
        await this.eventEmitter.emitAsync('shop.payment.success', {
          orderId,
          reference,
        });
        return { received: true };
      }

      const subscriptionId = metadata?.subscriptionId;
      const paymentId = metadata?.paymentId;

      if (!paymentId) {
        this.logger.warn(
          `charge.success webhook missing paymentId metadata (reference=${reference})`,
        );
        return { received: true };
      }

      // Claim the payment and activate the subscription inside a single
      // transaction. With the claim outside the tx, a process crash between
      // claim-commit and activation-commit would leave the payment PAID but
      // the subscription unactivated — Paystack retries would then see
      // claim.count === 0 and silently skip activation. Keeping both in one
      // tx means any crash rolls back the claim so retries can re-run the
      // full flow cleanly.
      try {
        const afterCommit: Array<() => void> = [];

        await this.prisma.$transaction(async (tx) => {
          // Atomic claim — two concurrent webhooks for the same reference
          // race here; only one sees count === 1, the other exits as no-op.
          const claim = await tx.payment.updateMany({
            where: { id: paymentId, status: 'PENDING' },
            data: { status: 'PAID', paystackReference: reference },
          });

          if (claim.count === 0) {
            this.logger.warn(
              `Duplicate or already-processed webhook for reference ${reference}, skipping`,
            );
            return;
          }

          const updatedPayment = await tx.payment.findUnique({
            where: { id: paymentId },
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

          if (updatedPayment?.subscription?.primaryMember) {
            const member = updatedPayment.subscription.primaryMember;
            const memberName = `${member.firstName} ${member.lastName}`;
            const amount = updatedPayment.amount;
            const currency = updatedPayment.currency;
            afterCommit.push(() => {
              this.eventEmitter.emit('activity.payment', {
                type: 'payment',
                description: `${memberName} made a payment of ${amount} ${currency}`,
                timestamp: new Date().toISOString(),
                metadata: {
                  paymentId,
                  amount,
                  status: 'PAID',
                },
              });
            });
          }

          if (!subscriptionId) return;

          // Activation + referral reward in the same tx: either both commit
          // or neither does.
          const subscription = await tx.memberSubscription.findUnique({
            where: { id: subscriptionId },
            include: { plan: true },
          });

          if (!subscription) {
            // Subscription was cleaned up (H11 race — cleanup cron deleted
            // the PENDING sub before this activation could run). Log loudly
            // and return so Paystack doesn't retry. Ops must reconcile the
            // paid-but-no-subscription case manually.
            this.logger.error(
              `Paid payment ${paymentId} references subscription ${subscriptionId} that no longer exists — manual reconciliation required`,
            );
            return;
          }

          // If subscription is still active with remaining time, extend
          // from current endDate so early renewals don't lose leftover days.
          const now = new Date();
          const baseDate =
            subscription.status === 'ACTIVE' && subscription.endDate > now
              ? subscription.endDate
              : now;
          const nextBillingDate = getNextBillingDate(
            baseDate,
            subscription.plan.billingInterval,
          );

          // L7 — only reset freeze counters on a genuine cycle advance.
          // A cycle advance is defined as `nextBillingDate` strictly moving
          // forward past the stored `nextBillingDate`. Comparing against
          // `endDate` (which is now nextBillingDate - 1 day) would always be
          // true for a replayed webhook, incorrectly re-zeroing counters.
          const isCycleAdvance =
            nextBillingDate.getTime() >
            (subscription.nextBillingDate?.getTime() ?? 0);

          const updateData: Prisma.MemberSubscriptionUpdateManyMutationInput = {
            status: 'ACTIVE',
            endDate: getSubscriptionEndDate(nextBillingDate),
            nextBillingDate,
            // Clear discount fields after first payment so renewals
            // charge full price.
            discountAmount: null,
            originalPlanPrice: null,
          };

          if (isCycleAdvance) {
            updateData.frozenDaysUsed = 0;
            updateData.freezeCount = 0;
            updateData.freezeCycleAnchor =
              getSubscriptionEndDate(nextBillingDate);
          }

          // Update subscription to the online payment method so the billing
          // cron picks it up for auto-charges / reminders going forward.
          const channelToMethod: Record<string, PaymentMethod> = {
            card: PaymentMethod.CARD,
            mobile_money: PaymentMethod.MOBILE_MONEY,
            bank_transfer: PaymentMethod.BANK_TRANSFER,
          };
          if (channel && channelToMethod[channel]) {
            updateData.paymentMethod = channelToMethod[channel];
          }

          // Enable auto-renewal for all successful payments so the billing
          // cron can auto-charge card users and send reminders to non-card
          // users.
          updateData.autoRenew = true;

          // Save card authorization for future auto-charges. We refuse to
          // persist the raw code without encryption — if no key is configured
          // (dev/test), skip the field rather than storing plaintext.
          if (channel === 'card' && authorization?.authorization_code) {
            if (this.encryptionKey) {
              updateData.paystackAuthorizationCode = encrypt(
                authorization.authorization_code,
                this.encryptionKey,
              );
            } else {
              this.logger.warn(
                `Skipping paystackAuthorizationCode persistence for subscription ${subscriptionId} — no ENCRYPTION_KEY configured`,
              );
            }
          }

          // Status-guarded updateMany so a concurrent cleanup cron that
          // deleted this sub between the findUnique above and here produces
          // count=0 rather than a P2025 crash.
          const activation = await tx.memberSubscription.updateMany({
            where: { id: subscriptionId },
            data: updateData,
          });

          if (activation.count === 0) {
            this.logger.error(
              `Subscription ${subscriptionId} disappeared between read and activation — paid payment ${paymentId} requires manual reconciliation`,
            );
            return;
          }

          // Process referral reward inside the same tx. An atomic
          // referral.updateMany claim prevents double-rewarding; if the tx
          // rolls back the referral claim rolls back with it.
          await this.processReferralReward(
            tx,
            subscription.primaryMemberId,
            afterCommit,
          );
        });

        // Tx committed — flush deferred side effects (activity events, push,
        // email). These must not run inside the tx because network IO inside a
        // tx holds DB connections. Individual failures are swallowed — the
        // payment is already activated.
        for (const fn of afterCommit) {
          try {
            fn();
          } catch (err) {
            this.logger.error(
              `afterCommit side effect failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }

        this.logger.log(
          `Webhook charge.success processed for reference ${reference}`,
        );
      } catch (err) {
        // Rethrow so Nest returns 500 and Paystack retries. Because the
        // claim is inside the transaction, a failure rolls back the PAID
        // status so the retry re-enters the full flow rather than hitting
        // a stale PAID gate.
        this.logger.error(
          `Webhook charge.success failed for reference ${reference}: ${err instanceof Error ? err.message : String(err)}`,
          err instanceof Error ? err.stack : undefined,
        );
        throw err;
      }
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
      const { paystackAuthorizationCode, ...sub } = payment.subscription;
      return { ...payment, subscription: sub };
    });

    return { data: sanitized, total, page, limit };
  }

  /**
   * Process referral reward for a paying member. Runs INSIDE the caller's
   * transaction (typically the webhook claim tx) so a roll-back rolls the
   * reward back with it. Out-of-tx side effects (push notification, email)
   * are appended to `afterCommit` and must be fired by the caller only
   * after the tx commits.
   *
   * Uses two atomic claim gates:
   *   1. `referral.updateMany({ referredId, status: 'PENDING' })` — a
   *      duplicate webhook sees count=0 and returns without extending the
   *      referrer's subscription (H13 double-reward fix).
   *   2. `memberSubscription.updateMany({ id })` for the referrer's
   *      subscription extension — tolerates the referrer's sub being
   *      cancelled mid-flight without crashing.
   *
   * Per-cycle cap (configurable via GymSettings.maxReferralsPerCycle,
   * default 3) is re-evaluated inside the tx so it's still enforced.
   */
  private async processReferralReward(
    tx: Prisma.TransactionClient,
    payingUserId: string,
    afterCommit: Array<() => void>,
  ) {
    // Atomically claim the referral to prevent double-rewarding on
    // duplicate webhooks. `status: 'PENDING'` in the filter is the claim
    // gate: only one concurrent caller sees count=1.
    const claimed = await tx.referral.updateMany({
      where: { referredId: payingUserId, status: 'PENDING' },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });

    if (claimed.count === 0) return;

    const referral = await tx.referral.findUnique({
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

    const referrerSubscription = await tx.memberSubscription.findFirst({
      where: {
        primaryMemberId: referral.referrerId,
        status: { in: ['ACTIVE', 'FROZEN'] },
      },
      include: { plan: true },
    });

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

      // KNOWN RACE: under READ COMMITTED isolation, two concurrent first
      // payments by different referred members of the same referrer can both
      // read completedInCycle before either commits, both pass the cap check,
      // and the referrer earns one extra reward cycle. Proper fix: embed the
      // count inside an atomic SQL UPDATE ... WHERE (SELECT COUNT(...)) < cap.
      // Deferred — the race requires two referred members of the same referrer
      // paying within milliseconds; consequence is one extra free week for the
      // referrer, not a financial loss.
      const completedInCycle = await tx.referral.count({
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

        // updateMany (not update) so a concurrent cancellation/deletion
        // of the referrer's subscription doesn't crash this tx.
        await tx.memberSubscription.updateMany({
          where: { id: referrerSubscription.id },
          data: {
            endDate: newEndDate,
            ...(newBillingDate && { nextBillingDate: newBillingDate }),
          },
        });
      }
    }

    // Update reward days on the already-claimed referral
    await tx.referral.update({
      where: { id: referral.id },
      data: { rewardDays: earnedDays },
    });

    if (earnedDays > 0) {
      const referredName = `${referral.referred.firstName} ${referral.referred.lastName}`;
      const referrerId = referral.referrerId;
      const referredId = referral.referredId;
      const referrerEmail = referral.referrer.email;
      const referrerFirstName = referral.referrer.firstName;
      const days = earnedDays;

      // Defer notification + email until after the enclosing tx commits.
      // These hit the network; running them inside the tx would hold DB
      // connections open for the duration of each request.
      afterCommit.push(() => {
        this.notificationsService
          .create({
            userId: referrerId,
            title: 'Referral reward earned!',
            body: `${referredName} joined — you earned ${days} free days!`,
            type: NotificationType.REFERRAL_REWARD,
            metadata: {
              referredId,
              referredName,
              rewardDays: days,
            },
          })
          .catch((err) =>
            this.logger.error(`Failed to send referral notification: ${err}`),
          );

        this.emailService
          .sendReferralRewardEmail(
            referrerEmail,
            referrerFirstName,
            referredName,
            days,
          )
          .catch((err) =>
            this.logger.error(`Failed to send referral email: ${err}`),
          );
      });
    }
  }
}
