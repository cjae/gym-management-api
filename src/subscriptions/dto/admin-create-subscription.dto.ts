import {
  IsString,
  IsIn,
  IsOptional,
  MaxLength,
  IsUUID,
  IsISO8601,
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

  @ApiPropertyOptional({
    example: 'QWERTY123',
    maxLength: 200,
    description:
      'Payment reference (e.g., M-Pesa transaction code, bank transfer ref). Optional — can be added later via PATCH.',
  })
  @IsOptional()
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

  @ApiPropertyOptional({
    example: '2026-04-01',
    maxLength: 10,
    description:
      'Backdated start date for the subscription (ISO 8601 date string). Must be in the past and within 90 days. Defaults to today when omitted.',
  })
  @IsOptional()
  @IsISO8601()
  @MaxLength(10)
  startDate?: string;
}
