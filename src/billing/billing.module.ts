import { Module } from '@nestjs/common';
import { BillingService } from './billing.service';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [PaymentsModule],
  providers: [BillingService],
})
export class BillingModule {}
