import { Module } from '@nestjs/common';
import { ShopService } from './shop.service';
import { ShopController } from './shop.controller';
import { ShopPaymentListener } from './listeners/shop-payment.listener';
import { EmailModule } from '../email/email.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { GymSettingsModule } from '../gym-settings/gym-settings.module';

@Module({
  imports: [EmailModule, NotificationsModule, GymSettingsModule],
  controllers: [ShopController],
  providers: [ShopService, ShopPaymentListener],
  exports: [ShopService],
})
export class ShopModule {}
