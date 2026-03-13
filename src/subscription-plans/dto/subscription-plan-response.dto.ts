import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SubscriptionPlanResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Premium Monthly' })
  name: string;

  @ApiProperty({ example: 5000 })
  price: number;

  @ApiProperty({ example: 'KES' })
  currency: string;

  @ApiProperty({
    enum: [
      'DAILY',
      'WEEKLY',
      'MONTHLY',
      'QUARTERLY',
      'BI_ANNUALLY',
      'ANNUALLY',
    ],
  })
  billingInterval: string;

  @ApiPropertyOptional({ example: 'Full access to all gym facilities' })
  description?: string;

  @ApiProperty({ example: 1 })
  maxMembers: number;

  @ApiProperty({ example: true })
  isActive: boolean;

  @ApiProperty({ example: 20 })
  maxFreezeDays: number;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
