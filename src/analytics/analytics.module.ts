import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { ActivityGateway } from './activity.gateway';
import { GymSettingsModule } from '../gym-settings/gym-settings.module';

@Module({
  imports: [JwtModule.register({}), GymSettingsModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService, ActivityGateway],
})
export class AnalyticsModule {}
