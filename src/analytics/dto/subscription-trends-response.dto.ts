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

class SubscriptionBreakdownDto {
  @ApiProperty({ example: 'Premium Monthly' })
  name: string;

  @ApiProperty({ example: 45 })
  count: number;
}

class PaymentMethodBreakdownDto {
  @ApiProperty({ example: 'MPESA' })
  method: string;

  @ApiProperty({ example: 60 })
  count: number;
}

export class SubscriptionTrendsResponseDto {
  @ApiProperty({ type: [SubscriptionPeriodDto] })
  series: SubscriptionPeriodDto[];

  @ApiProperty({ type: [SubscriptionBreakdownDto] })
  byPlan: SubscriptionBreakdownDto[];

  @ApiProperty({ type: [PaymentMethodBreakdownDto] })
  byPaymentMethod: PaymentMethodBreakdownDto[];

  @ApiProperty({ example: 0.05, description: 'Monthly churn rate as decimal' })
  churnRate: number;
}
