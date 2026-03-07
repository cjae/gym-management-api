import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
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
import { ConfigLoaderModule } from './common/loaders/config.loader.module';

@Module({
  imports: [
    ConfigLoaderModule,
    SentryModule.forRoot(),
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
  ],
  controllers: [AppController],
  providers: [
    {
      provide: APP_FILTER,
      useClass: SentryGlobalFilter,
    },
    AppService,
  ],
})
export class AppModule {}
