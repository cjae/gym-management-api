import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOkResponse,
  ApiQuery,
  ApiOperation,
  ApiForbiddenResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequiresFeature } from '../licensing/decorators/requires-feature.decorator';
import { AnalyticsService } from './analytics.service';
import { AnalyticsQueryDto } from './dto/analytics-query.dto';
import { DashboardResponseDto } from './dto/dashboard-response.dto';
import { RevenueTrendsResponseDto } from './dto/revenue-trends-response.dto';
import { AttendanceTrendsResponseDto } from './dto/attendance-trends-response.dto';
import { SubscriptionTrendsResponseDto } from './dto/subscription-trends-response.dto';
import { MemberTrendsResponseDto } from './dto/member-trends-response.dto';
import { ExpiringMembershipsResponseDto } from './dto/expiring-memberships-response.dto';

@ApiTags('Analytics')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token' })
@ApiForbiddenResponse({ description: 'Insufficient role permissions' })
@Controller('analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('dashboard')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({
    summary: 'Get dashboard summary',
    description:
      'Returns member, subscription, attendance, and payment stats. SUPER_ADMIN also receives financial metrics (revenue, expenses, net position). Real-time activity feed is available via WebSocket at /activity namespace.',
  })
  @ApiOkResponse({ type: DashboardResponseDto })
  getDashboard(@CurrentUser('role') role: string) {
    return this.analyticsService.getDashboard(role);
  }

  @Get('expiring-memberships')
  @RequiresFeature('analytics')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({
    summary: 'Get expiring memberships',
    description:
      'Returns memberships expiring within 7 days, sorted by urgency.',
  })
  @ApiOkResponse({ type: ExpiringMembershipsResponseDto })
  getExpiringMemberships() {
    return this.analyticsService.getExpiringMemberships();
  }

  @Get('revenue')
  @RequiresFeature('analytics')
  @Roles('SUPER_ADMIN')
  @ApiOperation({
    summary: 'Get revenue trends',
    description:
      'Time-series revenue data grouped by granularity. Each period includes total, paid, failed, pending amounts and breakdown by payment method.',
  })
  @ApiQuery({ name: 'paymentMethod', required: false, enum: ['CARD', 'MOBILE_MONEY'] })
  @ApiOkResponse({ type: RevenueTrendsResponseDto })
  getRevenue(
    @Query() query: AnalyticsQueryDto,
    @Query('paymentMethod') paymentMethod?: string,
  ) {
    return this.analyticsService.getRevenueTrends(query, paymentMethod);
  }

  @Get('attendance')
  @RequiresFeature('analytics')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({
    summary: 'Get attendance trends',
    description:
      'Time-series attendance data with check-in counts and unique members per period. Includes peak day of week and peak hour.',
  })
  @ApiOkResponse({ type: AttendanceTrendsResponseDto })
  getAttendance(@Query() query: AnalyticsQueryDto) {
    return this.analyticsService.getAttendanceTrends(query);
  }

  @Get('subscriptions')
  @RequiresFeature('analytics')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({
    summary: 'Get subscription trends',
    description:
      'Time-series of new subscriptions, cancellations, and expirations. Includes current breakdown by plan and payment method, plus churn rate.',
  })
  @ApiOkResponse({ type: SubscriptionTrendsResponseDto })
  getSubscriptions(@Query() query: AnalyticsQueryDto) {
    return this.analyticsService.getSubscriptionTrends(query);
  }

  @Get('members')
  @RequiresFeature('analytics')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({
    summary: 'Get member growth trends',
    description:
      'Time-series of new member registrations with running totals. Includes current breakdown by role and status.',
  })
  @ApiOkResponse({ type: MemberTrendsResponseDto })
  getMembers(@Query() query: AnalyticsQueryDto) {
    return this.analyticsService.getMemberTrends(query);
  }
}
