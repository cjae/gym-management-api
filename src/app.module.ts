import { Module } from '@nestjs/common';
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

@Module({
  imports: [PrismaModule, AuthModule, UsersModule, SubscriptionPlansModule, SubscriptionsModule, PaymentsModule, AttendanceModule, QrModule, TrainersModule, LegalModule, SalaryModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
