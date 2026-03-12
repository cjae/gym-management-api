import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SubscriptionStatus, PaymentMethod } from '@prisma/client';
import { SubscriptionPlanResponseDto } from '../../subscription-plans/dto/subscription-plan-response.dto';
import { SubscriptionMemberResponseDto } from './subscription-member-response.dto';

export class SubscriptionResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  primaryMemberId: string;

  @ApiProperty({ format: 'uuid' })
  planId: string;

  @ApiProperty()
  startDate: Date;

  @ApiProperty()
  endDate: Date;

  @ApiProperty({ enum: SubscriptionStatus })
  status: SubscriptionStatus;

  @ApiProperty({ enum: PaymentMethod })
  paymentMethod: PaymentMethod;

  @ApiProperty({ example: true })
  autoRenew: boolean;

  @ApiPropertyOptional()
  nextBillingDate?: Date;

  @ApiPropertyOptional()
  freezeStartDate?: Date;

  @ApiPropertyOptional()
  freezeEndDate?: Date;

  @ApiProperty({ example: 0 })
  frozenDaysUsed: number;

  @ApiPropertyOptional({ example: 'Cash receipt #123' })
  paymentNote?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Admin who created this subscription',
  })
  createdBy?: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  @ApiPropertyOptional({ type: SubscriptionPlanResponseDto })
  plan?: SubscriptionPlanResponseDto;

  @ApiPropertyOptional({ type: [SubscriptionMemberResponseDto] })
  members?: SubscriptionMemberResponseDto[];
}
