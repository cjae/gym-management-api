import { ApiProperty } from '@nestjs/swagger';

class SubscriptionPeriodDto {
  @ApiProperty({ example: '2026-03' })
  period: string;

  @ApiProperty({ example: 15 })
  newSubscriptions: number;

  @ApiProperty({ example: 3 })
  cancellations: number;

  @ApiProperty({ example: 2 })
  expirations: number;
}

export class SubscriptionTrendsResponseDto {
  @ApiProperty({ type: [SubscriptionPeriodDto] })
  series: SubscriptionPeriodDto[];

  @ApiProperty({
    example: { 'Premium Monthly': 45, 'Basic Weekly': 20 },
    description: 'Active subscription count by plan name',
  })
  byPlan: Record<string, number>;

  @ApiProperty({
    example: { MPESA: 60, CARD: 30 },
    description: 'Active subscription count by payment method',
  })
  byPaymentMethod: Record<string, number>;

  @ApiProperty({
    example: 5.2,
    description: 'Churn rate as percentage',
  })
  churnRate: number;
}
