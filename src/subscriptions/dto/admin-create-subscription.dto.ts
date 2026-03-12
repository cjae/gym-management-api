import {
  IsString,
  IsEnum,
  IsOptional,
  MaxLength,
  IsUUID,
  ValidateIf,
  IsNotEmpty,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum AdminPaymentMethod {
  MPESA_OFFLINE = 'MPESA_OFFLINE',
  BANK_TRANSFER = 'BANK_TRANSFER',
  COMPLIMENTARY = 'COMPLIMENTARY',
}

export class AdminCreateSubscriptionDto {
  @ApiProperty({ format: 'uuid', description: 'Target member ID' })
  @IsUUID()
  memberId: string;

  @ApiProperty({ format: 'uuid', description: 'Subscription plan ID' })
  @IsUUID()
  planId: string;

  @ApiProperty({
    enum: AdminPaymentMethod,
    example: 'MPESA_OFFLINE',
    description: 'Only offline payment methods allowed',
  })
  @IsEnum(AdminPaymentMethod)
  paymentMethod: AdminPaymentMethod;

  @ApiProperty({
    example: 'QWERTY123',
    maxLength: 200,
    description:
      'Payment reference (e.g., M-Pesa transaction code, bank transfer ref). Required for MPESA_OFFLINE and BANK_TRANSFER.',
  })
  @ValidateIf((o) => o.paymentMethod !== AdminPaymentMethod.COMPLIMENTARY)
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
}
