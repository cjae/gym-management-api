import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SubscriptionStatus, PaymentMethod } from '@prisma/client';
import { SubscriptionPlanResponseDto } from '../../subscription-plans/dto/subscription-plan-response.dto';
import { SubscriptionMemberResponseDto } from './subscription-member-response.dto';
import { UserSummaryResponseDto } from '../../common/dto/user-summary-response.dto';

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

  @ApiProperty({
    example: 0,
    description: 'Number of freezes used this billing cycle',
  })
  freezeCount: number;

  @ApiPropertyOptional({ example: 'Moving to a different city' })
  cancellationReason?: string;

  @ApiPropertyOptional({ example: 'M-Pesa confirmation code ABC123' })
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

  @ApiPropertyOptional({ type: UserSummaryResponseDto })
  primaryMember?: UserSummaryResponseDto;

  @ApiPropertyOptional({ type: SubscriptionPlanResponseDto })
  plan?: SubscriptionPlanResponseDto;

  @ApiPropertyOptional({ type: [SubscriptionMemberResponseDto] })
  members?: SubscriptionMemberResponseDto[];
}
