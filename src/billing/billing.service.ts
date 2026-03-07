import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsService } from '../payments/payments.service';
import { EmailService } from '../email/email.service';
import { AppConfig, getAppConfigName } from '../common/config/app.config';

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private readonly adminUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentsService: PaymentsService,
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
  ) {
    this.adminUrl =
      this.configService.get<AppConfig>(getAppConfigName())!.adminUrl;
  }

  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async handleCardRenewals() {
    this.logger.log('Starting card renewals');
    await this.processCardRenewals();
    this.logger.log('Card renewals complete');
  }

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async handleOverdueExpiry() {
    this.logger.log('Starting overdue subscription expiry');
    await this.expireOverdueSubscriptions();
    this.logger.log('Overdue subscription expiry complete');
  }

  @Cron(CronExpression.EVERY_DAY_AT_6AM)
  async handleMpesaReminders() {
    this.logger.log('Starting M-Pesa reminders');
    await this.processMpesaReminders();
    this.logger.log('M-Pesa reminders complete');
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
        primaryMember: true,
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
          `${this.adminUrl}/subscriptions`,
        );
        this.logger.warn(
          `Expired subscription ${sub.id} after 2 card failures`,
        );
        continue;
      }

      await this.paymentsService.chargeAuthorization(
        sub.id,
        sub.paystackAuthorizationCode!,
        sub.primaryMember.email,
        sub.plan.price,
      );
      this.logger.log(`Charged card for subscription ${sub.id}`);
    }
  }

  async processMpesaReminders() {
    const now = new Date();
    const threeDaysFromNow = new Date();
    threeDaysFromNow.setDate(now.getDate() + 3);
    threeDaysFromNow.setHours(23, 59, 59, 999);

    const upcomingSubscriptions = await this.prisma.memberSubscription.findMany(
      {
        where: {
          status: 'ACTIVE',
          paymentMethod: 'MPESA',
          autoRenew: true,
          nextBillingDate: { lte: threeDaysFromNow, gte: now },
        },
        include: {
          primaryMember: true,
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
          `${this.adminUrl}/subscriptions`,
        );
        this.logger.log(
          `Sent M-Pesa reminder to ${sub.primaryMember.email} — ${daysUntil} days until billing`,
        );
      }
    }
  }

  async expireOverdueSubscriptions() {
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    const overdueSubscriptions = await this.prisma.memberSubscription.findMany({
      where: {
        status: 'ACTIVE',
        paymentMethod: 'MPESA',
        nextBillingDate: { lt: now },
      },
      include: {
        primaryMember: true,
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
        `${this.adminUrl}/subscriptions`,
      );

      this.logger.log(`Expired overdue M-Pesa subscription ${sub.id}`);
    }
  }
}
