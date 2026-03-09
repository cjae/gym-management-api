import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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

  @ApiProperty({ enum: ['ACTIVE', 'EXPIRED', 'CANCELLED'] })
  status: string;

  @ApiProperty({ enum: ['CARD', 'MPESA'] })
  paymentMethod: string;

  @ApiProperty({ example: true })
  autoRenew: boolean;

  @ApiPropertyOptional()
  nextBillingDate?: Date;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  @ApiPropertyOptional({ type: SubscriptionPlanResponseDto })
  plan?: SubscriptionPlanResponseDto;

  @ApiPropertyOptional({ type: [SubscriptionMemberResponseDto] })
  members?: SubscriptionMemberResponseDto[];
}
