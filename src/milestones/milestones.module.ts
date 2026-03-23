import { Module } from '@nestjs/common';
import { MilestonesService } from './milestones.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  providers: [MilestonesService],
})
export class MilestonesModule {}
