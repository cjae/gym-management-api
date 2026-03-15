import { Module } from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { AttendanceController } from './attendance.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { GymSettingsModule } from '../gym-settings/gym-settings.module';

@Module({
  imports: [NotificationsModule, GymSettingsModule],
  controllers: [AttendanceController],
  providers: [AttendanceService],
  exports: [AttendanceService],
})
export class AttendanceModule {}
