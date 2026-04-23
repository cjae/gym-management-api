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
import { GymSettingsService } from '../gym-settings/gym-settings.service';

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
    private readonly gymSettingsService: GymSettingsService,
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
   *
   * KNOWN LIMITATION: `pg_try_advisory_lock` is session-scoped, but Prisma's
   * connection pool does not guarantee that the acquire call and the unlock
   * call land on the same backend session. In practice, sequential awaited
   * `$queryRaw` calls reuse the same pooled connection, so this works
   * correctly in the common case. If they do land on different sessions, the
   * unlock is a no-op and the lock persists until the acquiring connection's
   * idle timeout elapses (typically ~10 min) — the next cron run is skipped
   * for that window but no data is corrupted. A proper fix would wrap the
   * acquire + work + unlock in a single Prisma interactive transaction (which
   * pins to one connection), but that requires all billing work to accept a
   * transaction client — a non-trivial refactor deferred for now.
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

      // L7 — keep freeze counter anchor aligned with the extended endDate
      // on auto-unfreeze. Same reasoning as unfreeze() in subscriptions
      // service: the cycle identity is tracked via `freezeCycleAnchor`,
      // and any operation that advances `endDate` within a cycle must
      // re-anchor so the counters stay authoritative for this cycle.
      const { count } = await this.prisma.memberSubscription.updateMany({
        where: { id: sub.id, status: 'FROZEN' },
        data: {
          status: 'ACTIVE',
          endDate: newEndDate,
          nextBillingDate: newNextBillingDate,
          freezeStartDate: null,
          freezeEndDate: null,
          frozenDaysUsed: { increment: frozenDays },
          freezeCount: { increment: 1 },
          freezeCycleAnchor: newEndDate,
        },
      });

      if (count === 0) {
        this.logger.log(
          `Skipped auto-unfreeze for ${sub.id}: no longer FROZEN (raced user-initiated unfreeze)`,
        );
        continue;
      }

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

      if (!this.encryptionKey) {
        // Encryption is intentionally disabled — skip without touching the
        // stored code. The webhook path also refuses to persist codes without
        // an encryption key, so this branch is only reachable if the key was
        // present when the code was stored and has since been removed (e.g.
        // misconfiguration or key rotation). Clearing the code here would
        // destroy a valid credential; just skip until the key is restored.
        this.logger.warn(
          `Skipping card renewal for subscription ${sub.id}: ENCRYPTION_KEY not configured`,
        );
        continue;
      }

      let authCode: string;
      try {
        authCode = decrypt(sub.paystackAuthorizationCode!, this.encryptionKey);
      } catch (err) {
        // Decryption failed with a configured key — code is corrupt or was
        // written with a different key. Self-heal by clearing the code so
        // the member can re-authorize; flag for ops via Sentry + DB timestamp.
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
    const settings = await this.gymSettingsService.getSettings();
    const now = this.getLocalMidnight(settings?.timezone ?? 'Africa/Nairobi');

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

  // Returns midnight of today in the given IANA timezone as a UTC Date.
  private getLocalMidnight(tz: string): Date {
    const dateStr = new Date().toLocaleDateString('en-CA', { timeZone: tz });
    const offsetStr =
      new Intl.DateTimeFormat('en', {
        timeZone: tz,
        timeZoneName: 'shortOffset',
      })
        .formatToParts(new Date())
        .find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+0';
    const m = /GMT([+-])(\d+)(?::(\d+))?/.exec(offsetStr);
    const sign = m?.[1] ?? '+';
    const hh = (m?.[2] ?? '0').padStart(2, '0');
    const mm = (m?.[3] ?? '00').padStart(2, '0');
    return new Date(`${dateStr}T00:00:00${sign}${hh}:${mm}`);
  }
}
