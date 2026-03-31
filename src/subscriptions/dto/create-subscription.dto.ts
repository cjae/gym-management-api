import { IsString, IsEnum, IsOptional, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum MemberPaymentMethod {
  CARD = 'CARD',
  MOBILE_MONEY = 'MOBILE_MONEY',
  BANK_TRANSFER = 'BANK_TRANSFER',
}

export class CreateSubscriptionDto {
  @ApiProperty({ example: 'uuid-of-plan' })
  @IsString()
  planId: string;

  @ApiProperty({ enum: MemberPaymentMethod, example: 'MOBILE_MONEY' })
  @IsEnum(MemberPaymentMethod)
  paymentMethod: MemberPaymentMethod;

  @ApiPropertyOptional({ example: 'NEWYEAR25' })
  @IsOptional()
  @IsString()
  @MaxLength(12)
  discountCode?: string;
}
