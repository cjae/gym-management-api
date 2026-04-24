import { Module } from '@nestjs/common';
import { BillingService } from './billing.service';
import { PaymentsModule } from '../payments/payments.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { GymSettingsModule } from '../gym-settings/gym-settings.module';

@Module({
  imports: [
    PaymentsModule,
    NotificationsModule,
    UsersModule,
    GymSettingsModule,
  ],
  providers: [BillingService],
})
export class BillingModule {}
