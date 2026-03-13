import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { PushTokensController } from './push-tokens.controller';
import { NotificationsService } from './notifications.service';

@Module({
  controllers: [NotificationsController, PushTokensController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
