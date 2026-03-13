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

class SubscriptionStatsDto {
  @ApiProperty({ example: 100 })
  active: number;

  @ApiProperty({ example: 8 })
  expiringSoon: number;

  @ApiProperty({ example: 5 })
  expiredThisMonth: number;

  @ApiProperty({
    example: { 'Premium Monthly': 45, 'Basic Weekly': 20 },
    description: 'Active subscription count by plan name',
  })
  byPlan: Record<string, number>;
}

class AttendanceStatsDto {
  @ApiProperty({ example: 45 })
  todayCheckIns: number;

  @ApiProperty({ example: 280 })
  thisWeekCheckIns: number;

  @ApiProperty({ example: 42.5 })
  avgDaily30Days: number;
}

class PaymentStatsDto {
  @ApiProperty({ example: 3 })
  pendingCount30Days: number;

  @ApiProperty({ example: 1 })
  failedCount30Days: number;
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
}
