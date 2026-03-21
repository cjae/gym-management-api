import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SubscriptionPlanResponseDto } from '../../subscription-plans/dto/subscription-plan-response.dto';

class DiscountCodePlanResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  discountCodeId: string;

  @ApiProperty({ format: 'uuid' })
  planId: string;

  @ApiProperty({ type: SubscriptionPlanResponseDto })
  plan: SubscriptionPlanResponseDto;
}

export class DiscountCodeResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'NEWYEAR25' })
  code: string;

  @ApiPropertyOptional({ example: 'New Year 2026 promotion' })
  description?: string;

  @ApiProperty({ enum: ['PERCENTAGE', 'FIXED'], example: 'PERCENTAGE' })
  discountType: string;

  @ApiProperty({ example: 20 })
  discountValue: number;

  @ApiPropertyOptional({ example: 100 })
  maxUses?: number;

  @ApiProperty({ example: 1 })
  maxUsesPerMember: number;

  @ApiProperty({ example: 0 })
  currentUses: number;

  @ApiProperty()
  startDate: Date;

  @ApiProperty()
  endDate: Date;

  @ApiProperty({ example: true })
  isActive: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  @ApiProperty({ type: [DiscountCodePlanResponseDto] })
  plans: DiscountCodePlanResponseDto[];
}

class RedemptionCountDto {
  @ApiProperty({ example: 5 })
  redemptions: number;
}

export class DiscountCodeDetailResponseDto extends DiscountCodeResponseDto {
  @ApiProperty({ type: RedemptionCountDto })
  _count: RedemptionCountDto;
}

export class PaginatedDiscountCodesResponseDto {
  @ApiProperty({ type: [DiscountCodeResponseDto] })
  data: DiscountCodeResponseDto[];

  @ApiProperty({ example: 100 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;
}

class RedemptionMemberDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'John' })
  firstName: string;

  @ApiProperty({ example: 'Doe' })
  lastName: string;

  @ApiProperty({ example: 'john@example.com' })
  email: string;
}

class RedemptionResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  discountCodeId: string;

  @ApiProperty({ format: 'uuid' })
  memberId: string;

  @ApiProperty({ format: 'uuid' })
  subscriptionId: string;

  @ApiProperty({ example: 5000 })
  originalAmount: number;

  @ApiProperty({ example: 4000 })
  discountedAmount: number;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({ type: RedemptionMemberDto })
  member: RedemptionMemberDto;
}

export class PaginatedRedemptionsResponseDto {
  @ApiProperty({ type: [RedemptionResponseDto] })
  data: RedemptionResponseDto[];

  @ApiProperty({ example: 100 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;
}

class ValidateDiscountCodeInfoDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: ['PERCENTAGE', 'FIXED'] })
  discountType: string;

  @ApiProperty({ example: 20 })
  discountValue: number;

  @ApiPropertyOptional({ example: 100 })
  maxUses?: number;

  @ApiProperty({ example: 1 })
  maxUsesPerMember: number;
}

export class ValidateDiscountCodeResponseDto {
  @ApiProperty({ type: ValidateDiscountCodeInfoDto })
  discountCode: ValidateDiscountCodeInfoDto;

  @ApiProperty({ example: 4000 })
  finalPrice: number;

  @ApiProperty({ example: 5000 })
  originalPrice: number;
}
