import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsService } from '../payments/payments.service';
import { EmailService } from '../email/email.service';
import { AppConfig, getAppConfigName } from '../common/config/app.config';
import {
  PaymentConfig,
  getPaymentConfigName,
} from '../common/config/payment.config';
import { decrypt } from '../common/utils/encryption.util';
import { NotificationType } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { UsersService } from '../users/users.service';

// M16 — PostgreSQL advisory-lock IDs used to serialize billing crons across
// API replicas. Each cron claims its own 64-bit lock via pg_try_advisory_lock;
// a second replica whose lock attempt returns false skips that run. The IDs
// are arbitrary but stable — changing them after deploy defeats the lock, so
// treat these constants as part of the release artifact.
//
// Convention: 0xB111_xxxx (B=billing) with a 16-bit tag per cron handler.
const ADVISORY_LOCK_CARD_RENEWALS = 0xb1110001n;
const ADVISORY_LOCK_OVERDUE_EXPIRY = 0xb1110002n;
const ADVISORY_LOCK_MOBILE_REMINDERS = 0xb1110003n;
const ADVISORY_LOCK_BIRTHDAY_WISHES = 0xb1110004n;
const ADVISORY_LOCK_AUTO_UNFREEZE = 0xb1110005n;

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private readonly memberAppUrl: string;
  private readonly encryptionKey: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentsService: PaymentsService,
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
    private readonly notificationsService: NotificationsService,
    private readonly usersService: UsersService,
  ) {
    this.memberAppUrl =
      this.configService.get<AppConfig>(getAppConfigName())!.memberAppUrl;
    this.encryptionKey = this.configService.get<PaymentConfig>(
      getPaymentConfigName(),
    )!.encryptionKey;
  }

  @Cron(CronExpression.EVERY_DAY_AT_1AM, { timeZone: 'Africa/Nairobi' })
  async handleCardRenewals() {
    await this.runWithAdvisoryLock(
      ADVISORY_LOCK_CARD_RENEWALS,
      'card renewals',
      () => this.processCardRenewals(),
    );
  }

  @Cron(CronExpression.EVERY_DAY_AT_2AM, { timeZone: 'Africa/Nairobi' })
  async handleOverdueExpiry() {
    await this.runWithAdvisoryLock(
      ADVISORY_LOCK_OVERDUE_EXPIRY,
      'overdue subscription expiry',
      () => this.expireOverdueSubscriptions(),
    );
  }

  @Cron(CronExpression.EVERY_DAY_AT_6AM, { timeZone: 'Africa/Nairobi' })
  async handleMobileMoneyReminders() {
    await this.runWithAdvisoryLock(
      ADVISORY_LOCK_MOBILE_REMINDERS,
      'mobile money reminders',
      () => this.processMobileMoneyReminders(),
    );
  }

  @Cron(CronExpression.EVERY_DAY_AT_9AM, { timeZone: 'Africa/Nairobi' })
  async handleBirthdayWishes() {
    await this.runWithAdvisoryLock(
      ADVISORY_LOCK_BIRTHDAY_WISHES,
      'birthday wishes',
      () => this.sendBirthdayWishes(),
    );
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, { timeZone: 'Africa/Nairobi' })
  async handleAutoUnfreeze() {
    await this.runWithAdvisoryLock(
      ADVISORY_LOCK_AUTO_UNFREEZE,
      'auto-unfreeze check',
      () => this.autoUnfreezeSubscriptions(),
    );
  }

  /**
   * M16 — replica-safe cron wrapper.
   *
   * Uses PostgreSQL session-scoped advisory locks (`pg_try_advisory_lock`) to
   * ensure that when multiple API replicas run the same cron schedule, only
   * one instance actually performs the work. The loser returns immediately
   * without side effects, so we never double-charge, double-email, or
   * double-flip-expired.
   *
   * `pg_try_advisory_lock` is non-blocking: if another backend holds the
   * lock, it returns `false` rather than waiting. Session-scoped locks are
   * automatically released when the connection closes, so a crashed replica
   * can't deadlock the lock indefinitely — we also explicitly unlock in a
   * `finally` to release immediately under happy-path and thrown-error
   * conditions.
   *
   * The lock ID is a BIGINT. We use BigInt literals and `Prisma.sql` tagged
   * template interpolation so the driver sends them as parameters (no
   * string concatenation into SQL).
   */
  private async runWithAdvisoryLock(
    lockId: bigint,
    label: string,
    work: () => Promise<void>,
  ): Promise<void> {
    const acquired = await this.prisma.$queryRaw<
      Array<{ acquired: boolean }>
    >`SELECT pg_try_advisory_lock(${lockId}) AS acquired`;

    if (!acquired[0]?.acquired) {
      this.logger.log(
        `Another instance holds the ${label} billing lock; skipping this run`,
      );
      return;
    }

    this.logger.log(`Starting ${label}`);
    try {
      await work();
      this.logger.log(`${label} complete`);
    } finally {
      try {
        await this.prisma.$queryRaw`SELECT pg_advisory_unlock(${lockId})`;
      } catch (err) {
        // Releasing the lock should never fail under normal operation, but
        // if it does we surface it — the session-scoped lock will be
        // released anyway when the connection closes.
        this.logger.warn(
          `Failed to release ${label} advisory lock: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  async autoUnfreezeSubscriptions() {
    const now = new Date();

    const expiredFreezes = await this.prisma.memberSubscription.findMany({
      where: {
        status: 'FROZEN',
        freezeEndDate: { lte: now },
      },
    });

    for (const sub of expiredFreezes) {
      const frozenDays = Math.ceil(
        (sub.freezeEndDate!.getTime() - sub.freezeStartDate!.getTime()) /
          (1000 * 60 * 60 * 24),
      );

      const newEndDate = new Date(sub.endDate);
      newEndDate.setDate(newEndDate.getDate() + frozenDays);

      const newNextBillingDate = sub.nextBillingDate
        ? new Date(sub.nextBillingDate)
        : null;
      if (newNextBillingDate) {
        newNextBillingDate.setDate(newNextBillingDate.getDate() + frozenDays);
      }

      await this.prisma.memberSubscription.update({
        where: { id: sub.id },
        data: {
          status: 'ACTIVE',
          endDate: newEndDate,
          nextBillingDate: newNextBillingDate,
          freezeStartDate: null,
          freezeEndDate: null,
          frozenDaysUsed: { increment: frozenDays },
          freezeCount: { increment: 1 },
        },
      });

      this.logger.log(
        `Auto-unfroze subscription ${sub.id} after ${frozenDays} frozen days`,
      );
    }
  }

  async processCardRenewals() {
    const today = new Date();
    today.setHours(23, 59, 59, 999);

    const dueSubscriptions = await this.prisma.memberSubscription.findMany({
      where: {
        status: 'ACTIVE',
        paymentMethod: 'CARD',
        autoRenew: true,
        paystackAuthorizationCode: { not: null },
        nextBillingDate: { lte: today },
      },
      include: {
        primaryMember: {
          select: { id: true, email: true, firstName: true },
        },
        plan: true,
      },
    });

    for (const sub of dueSubscriptions) {
      const recentFailures = await this.prisma.payment.count({
        where: {
          subscriptionId: sub.id,
          status: 'FAILED',
          createdAt: { gte: new Date(Date.now() - 48 * 60 * 60 * 1000) },
        },
      });

      if (recentFailures >= 2) {
        await this.prisma.memberSubscription.update({
          where: { id: sub.id },
          data: { status: 'EXPIRED', autoRenew: false },
        });
        await this.emailService.sendCardPaymentFailedEmail(
          sub.primaryMember.email,
          sub.primaryMember.firstName,
          sub.plan.name,
          sub.plan.price,
          this.memberAppUrl,
        );
        this.logger.warn(
          `Expired subscription ${sub.id} after 2 card failures`,
        );
        continue;
      }

      let authCode: string;
      try {
        // When no encryption key is configured (dev/test), the webhook path
        // refuses to persist plaintext codes, so any stored value must be
        // ciphertext. Decryption failures here indicate either a legacy
        // plaintext row (from before the encryption-required fix) or
        // tampered/corrupt data — in both cases we null the code so the
        // member re-authorizes on next renewal rather than looping forever.
        if (!this.encryptionKey) {
          throw new Error('ENCRYPTION_KEY not configured');
        }
        authCode = decrypt(sub.paystackAuthorizationCode!, this.encryptionKey);
      } catch (err) {
        // H8 — self-heal is correct, but ops needs to know this happened.
        // Emit a Sentry captureMessage at warning severity so on-call sees
        // the count, and stamp `billingFlaggedAt` so the admin UI can
        // surface these subscriptions for manual follow-up.
        const errorMessage = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `Failed to decrypt paystackAuthorizationCode for subscription ${sub.id}; clearing stored code and flagging for manual review. Member will need to re-authorize. Error: ${errorMessage}`,
        );
        Sentry.captureMessage(
          'Billing cron: paystackAuthorizationCode decrypt failed',
          {
            level: 'warning',
            extra: {
              subscriptionId: sub.id,
              memberId: sub.primaryMember.id,
              error: errorMessage,
            },
          },
        );
        await this.prisma.memberSubscription.update({
          where: { id: sub.id },
          data: {
            paystackAuthorizationCode: null,
            billingFlaggedAt: new Date(),
          },
        });
        continue;
      }

      await this.paymentsService.chargeAuthorization(
        sub.id,
        authCode,
        sub.primaryMember.email,
        sub.plan.price,
      );
      this.logger.log(`Charged card for subscription ${sub.id}`);
    }
  }

  async processMobileMoneyReminders() {
    const now = new Date();
    const threeDaysFromNow = new Date();
    threeDaysFromNow.setDate(now.getDate() + 3);
    threeDaysFromNow.setHours(23, 59, 59, 999);

    const upcomingSubscriptions = await this.prisma.memberSubscription.findMany(
      {
        where: {
          status: 'ACTIVE',
          paymentMethod: { in: ['MOBILE_MONEY', 'BANK_TRANSFER'] },
          autoRenew: true,
          nextBillingDate: { lte: threeDaysFromNow, gte: now },
        },
        include: {
          primaryMember: {
            select: { id: true, email: true, firstName: true },
          },
          plan: true,
        },
      },
    );

    for (const sub of upcomingSubscriptions) {
      const daysUntil = Math.ceil(
        (sub.nextBillingDate!.getTime() - now.getTime()) /
          (1000 * 60 * 60 * 24),
      );

      if (daysUntil === 3 || daysUntil === 1 || daysUntil === 0) {
        await this.emailService.sendSubscriptionReminderEmail(
          sub.primaryMember.email,
          sub.primaryMember.firstName,
          sub.plan.name,
          sub.plan.price,
          daysUntil,
          `${this.memberAppUrl}`,
        );

        this.notificationsService
          .create({
            userId: sub.primaryMemberId,
            title: 'Payment Reminder',
            body: `Payment due for your ${sub.plan.name} plan`,
            type: NotificationType.PAYMENT_REMINDER,
            metadata: { subscriptionId: sub.id },
          })
          .catch(() => {});

        this.logger.log(
          `Sent M-Pesa reminder to ${sub.primaryMember.email} — ${daysUntil} days until billing`,
        );
      }
    }
  }

  async sendBirthdayWishes() {
    const birthdayUsers = await this.usersService.findBirthdays();

    for (const user of birthdayUsers) {
      this.emailService
        .sendBirthdayEmail(user.email, user.firstName)
        .catch(() => {});

      this.notificationsService
        .create({
          userId: user.id,
          title: 'Happy Birthday! 🎂',
          body: `Happy Birthday, ${user.firstName}! Wishing you a fantastic day!`,
          type: NotificationType.BIRTHDAY,
        })
        .catch(() => {});

      this.logger.log(`Sent birthday wish to ${user.email}`);
    }
  }

  async expireOverdueSubscriptions() {
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    const overdueSubscriptions = await this.prisma.memberSubscription.findMany({
      where: {
        status: 'ACTIVE',
        endDate: { lt: now },
      },
      include: {
        primaryMember: {
          select: { id: true, email: true, firstName: true },
        },
        plan: true,
      },
    });

    for (const sub of overdueSubscriptions) {
      await this.prisma.memberSubscription.update({
        where: { id: sub.id },
        data: { status: 'EXPIRED', autoRenew: false },
      });

      await this.emailService.sendSubscriptionExpiredEmail(
        sub.primaryMember.email,
        sub.primaryMember.firstName,
        sub.plan.name,
        `${this.memberAppUrl}`,
      );

      this.notificationsService
        .create({
          userId: sub.primaryMemberId,
          title: 'Subscription Expired',
          body: `Your ${sub.plan.name} subscription has expired`,
          type: NotificationType.SUBSCRIPTION_EXPIRING,
          metadata: { subscriptionId: sub.id, daysLeft: 0 },
        })
        .catch(() => {});

      this.logger.log(`Expired overdue subscription ${sub.id}`);
    }
  }
}
