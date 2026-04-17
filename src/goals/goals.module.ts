import { Module } from '@nestjs/common';
import { GoalsService } from './goals.service';
import { GoalsController } from './goals.controller';
import { AttendanceModule } from '../attendance/attendance.module';
import { GymSettingsModule } from '../gym-settings/gym-settings.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { LlmModule } from '../llm/llm.module';

@Module({
  imports: [
    AttendanceModule,
    GymSettingsModule,
    SubscriptionsModule,
    NotificationsModule,
    LlmModule,
  ],
  controllers: [GoalsController],
  providers: [GoalsService],
  exports: [GoalsService],
})
export class GoalsModule {}
