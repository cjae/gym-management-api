import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
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
    this.logger.log('Starting card renewals');
    await this.processCardRenewals();
    this.logger.log('Card renewals complete');
  }

  @Cron(CronExpression.EVERY_DAY_AT_2AM, { timeZone: 'Africa/Nairobi' })
  async handleOverdueExpiry() {
    this.logger.log('Starting overdue subscription expiry');
    await this.expireOverdueSubscriptions();
    this.logger.log('Overdue subscription expiry complete');
  }

  @Cron(CronExpression.EVERY_DAY_AT_6AM, { timeZone: 'Africa/Nairobi' })
  async handleMobileMoneyReminders() {
    this.logger.log('Starting Mobile money reminders');
    await this.processMobileMoneyReminders();
    this.logger.log('Mobile money reminders complete');
  }

  @Cron(CronExpression.EVERY_DAY_AT_9AM, { timeZone: 'Africa/Nairobi' })
  async handleBirthdayWishes() {
    this.logger.log('Starting birthday wishes');
    await this.sendBirthdayWishes();
    this.logger.log('Birthday wishes complete');
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, { timeZone: 'Africa/Nairobi' })
  async handleAutoUnfreeze() {
    this.logger.log('Starting auto-unfreeze check');
    await this.autoUnfreezeSubscriptions();
    this.logger.log('Auto-unfreeze check complete');
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
          `${this.memberAppUrl}`,
        );
        this.logger.warn(
          `Expired subscription ${sub.id} after 2 card failures`,
        );
        continue;
      }

      const authCode = this.encryptionKey
        ? decrypt(sub.paystackAuthorizationCode!, this.encryptionKey)
        : sub.paystackAuthorizationCode!;

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
