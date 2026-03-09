import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class MemberStatsDto {
  @ApiProperty({ example: 150 })
  total: number;

  @ApiProperty({ example: 120 })
  active: number;

  @ApiProperty({ example: 25 })
  inactive: number;

  @ApiProperty({ example: 5 })
  suspended: number;

  @ApiProperty({ example: 12 })
  newThisMonth: number;
}

class SubscriptionByPlanDto {
  @ApiProperty({ example: 'Premium Monthly' })
  name: string;

  @ApiProperty({ example: 45 })
  count: number;
}

class SubscriptionStatsDto {
  @ApiProperty({ example: 100 })
  active: number;

  @ApiProperty({ example: 8 })
  expiringSoon: number;

  @ApiProperty({ example: 5 })
  expiredThisMonth: number;

  @ApiProperty({ type: [SubscriptionByPlanDto] })
  byPlan: SubscriptionByPlanDto[];
}

class AttendanceStatsDto {
  @ApiProperty({ example: 45 })
  today: number;

  @ApiProperty({ example: 280 })
  thisWeek: number;

  @ApiProperty({ example: 42.5 })
  avgDailyLast30Days: number;
}

class PaymentStatsDto {
  @ApiProperty({ example: 3 })
  pendingLast30Days: number;

  @ApiProperty({ example: 1 })
  failedLast30Days: number;
}

class FinancialStatsDto {
  @ApiProperty({ example: 500000 })
  revenueThisMonth: number;

  @ApiProperty({ example: 480000 })
  revenueLastMonth: number;

  @ApiProperty({ example: 200000 })
  salariesPaidThisMonth: number;

  @ApiProperty({ example: 50000 })
  pendingSalaries: number;

  @ApiProperty({ example: 300000 })
  netPositionThisMonth: number;
}

class ActivityItemDto {
  @ApiProperty({ example: 'subscription_created' })
  type: string;

  @ApiProperty({ example: 'New subscription by John Doe' })
  description: string;

  @ApiProperty()
  timestamp: Date;
}

export class DashboardResponseDto {
  @ApiProperty({ type: MemberStatsDto })
  members: MemberStatsDto;

  @ApiProperty({ type: SubscriptionStatsDto })
  subscriptions: SubscriptionStatsDto;

  @ApiProperty({ type: AttendanceStatsDto })
  attendance: AttendanceStatsDto;

  @ApiProperty({ type: PaymentStatsDto })
  payments: PaymentStatsDto;

  @ApiPropertyOptional({
    type: FinancialStatsDto,
    description: 'SUPER_ADMIN only',
  })
  financials?: FinancialStatsDto;

  @ApiProperty({ type: [ActivityItemDto] })
  recentActivity: ActivityItemDto[];
}
