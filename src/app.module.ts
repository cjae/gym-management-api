import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { SentryModule } from '@sentry/nestjs/setup';
import { SentryGlobalFilter } from '@sentry/nestjs/setup';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { SubscriptionPlansModule } from './subscription-plans/subscription-plans.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { PaymentsModule } from './payments/payments.module';
import { AttendanceModule } from './attendance/attendance.module';
import { QrModule } from './qr/qr.module';
import { TrainersModule } from './trainers/trainers.module';
import { LegalModule } from './legal/legal.module';
import { SalaryModule } from './salary/salary.module';
import { SentryUserModule } from './sentry/sentry.module';
import { EmailModule } from './email/email.module';
import { ScheduleModule } from '@nestjs/schedule';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { BillingModule } from './billing/billing.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { UploadsModule } from './uploads/uploads.module';
import { ConfigLoaderModule } from './common/loaders/config.loader.module';
import { LicensingModule } from './licensing/licensing.module';
import { LicenseGuard } from './licensing/licensing.guard';

@Module({
  imports: [
    ConfigLoaderModule,
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60000, limit: 30 }],
    }),
    ScheduleModule.forRoot(),
    EventEmitterModule.forRoot(),
    SentryModule.forRoot(),
    LicensingModule,
    SentryUserModule,
    EmailModule,
    PrismaModule,
    AuthModule,
    UsersModule,
    SubscriptionPlansModule,
    SubscriptionsModule,
    PaymentsModule,
    AttendanceModule,
    QrModule,
    TrainersModule,
    LegalModule,
    SalaryModule,
    BillingModule,
    AnalyticsModule,
    UploadsModule,
  ],
  controllers: [AppController],
  providers: [
    {
      provide: APP_FILTER,
      useClass: SentryGlobalFilter,
    },
    {
      provide: APP_GUARD,
      useClass: LicenseGuard,
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    AppService,
  ],
})
export class AppModule {}
