import {
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AnalyticsService } from './analytics.service';
import { AnalyticsQueryDto } from './dto/analytics-query.dto';

@ApiTags('Analytics')
@ApiBearerAuth()
@Controller('analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('dashboard')
  @Roles('ADMIN', 'SUPER_ADMIN')
  getDashboard(@CurrentUser('role') role: string) {
    return this.analyticsService.getDashboard(role);
  }

  @Get('revenue')
  @Roles('SUPER_ADMIN')
  getRevenue(
    @Query() query: AnalyticsQueryDto,
    @Query('paymentMethod') paymentMethod?: string,
  ) {
    return this.analyticsService.getRevenueTrends(query, paymentMethod);
  }

  @Get('attendance')
  @Roles('ADMIN', 'SUPER_ADMIN')
  getAttendance(@Query() query: AnalyticsQueryDto) {
    return this.analyticsService.getAttendanceTrends(query);
  }

  @Get('subscriptions')
  @Roles('ADMIN', 'SUPER_ADMIN')
  getSubscriptions(@Query() query: AnalyticsQueryDto) {
    return this.analyticsService.getSubscriptionTrends(query);
  }

  @Get('members')
  @Roles('ADMIN', 'SUPER_ADMIN')
  getMembers(@Query() query: AnalyticsQueryDto) {
    return this.analyticsService.getMemberTrends(query);
  }
}
