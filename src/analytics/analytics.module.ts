import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { ActivityGateway } from './activity.gateway';

@Module({
  imports: [JwtModule.register({})],
  controllers: [AnalyticsController],
  providers: [AnalyticsService, ActivityGateway],
})
export class AnalyticsModule {}
