import {
  IsString,
  IsEnum,
  IsOptional,
  MaxLength,
  IsUUID,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum AdminPaymentMethod {
  CASH = 'CASH',
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
    example: 'CASH',
    description: 'Only offline payment methods allowed',
  })
  @IsEnum(AdminPaymentMethod)
  paymentMethod: AdminPaymentMethod;

  @ApiPropertyOptional({
    example: 'Cash receipt #123',
    maxLength: 500,
    description: 'Optional note about payment',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  paymentNote?: string;
}
