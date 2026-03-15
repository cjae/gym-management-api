import { Module } from '@nestjs/common';
import { GymSettingsService } from './gym-settings.service';
import { GymSettingsController } from './gym-settings.controller';

@Module({
  controllers: [GymSettingsController],
  providers: [GymSettingsService],
  exports: [GymSettingsService],
})
export class GymSettingsModule {}
