import {
  IsString,
  IsIn,
  IsOptional,
  MaxLength,
  IsUUID,
  ValidateIf,
  IsNotEmpty,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentMethod } from '@prisma/client';
import { ADMIN_PAYMENT_METHODS } from '../../common/constants/payment-methods';

export class AdminCreateSubscriptionDto {
  @ApiProperty({ format: 'uuid', description: 'Target member ID' })
  @IsUUID()
  memberId: string;

  @ApiProperty({ format: 'uuid', description: 'Subscription plan ID' })
  @IsUUID()
  planId: string;

  @ApiProperty({
    enum: ADMIN_PAYMENT_METHODS,
    example: 'MOBILE_MONEY_IN_PERSON',
    description: 'Only in-person/offline payment methods allowed',
  })
  @IsIn(ADMIN_PAYMENT_METHODS)
  paymentMethod: PaymentMethod;

  @ApiProperty({
    example: 'QWERTY123',
    maxLength: 200,
    description:
      'Payment reference (e.g., M-Pesa transaction code, bank transfer ref). Required for all methods except COMPLIMENTARY.',
  })
  @ValidateIf(
    (o: AdminCreateSubscriptionDto) =>
      o.paymentMethod !== PaymentMethod.COMPLIMENTARY,
  )
  @IsNotEmpty()
  @IsString()
  @MaxLength(200)
  paymentReference?: string;

  @ApiPropertyOptional({
    example: 'M-Pesa confirmation code ABC123',
    maxLength: 500,
    description: 'Optional note about payment',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  paymentNote?: string;

  @ApiPropertyOptional({ example: 'RETENTION50' })
  @IsOptional()
  @IsString()
  @MaxLength(12)
  discountCode?: string;
}
