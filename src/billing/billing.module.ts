import { Module } from '@nestjs/common';
import { BillingService } from './billing.service';
import { PaymentsModule } from '../payments/payments.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [PaymentsModule, NotificationsModule],
  providers: [BillingService],
})
export class BillingModule {}
