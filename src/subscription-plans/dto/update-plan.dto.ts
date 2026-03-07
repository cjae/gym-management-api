import {
  IsString,
  IsNumber,
  IsOptional,
  IsInt,
  Min,
  IsBoolean,
  IsEnum,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { BillingInterval } from '@prisma/client';

export class UpdatePlanDto {
  @ApiPropertyOptional({ example: 'Monthly Plan' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: 2500 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;

  @ApiPropertyOptional({ enum: BillingInterval, example: 'MONTHLY' })
  @IsOptional()
  @IsEnum(BillingInterval)
  billingInterval?: BillingInterval;

  @ApiPropertyOptional({ example: 'Full access for 30 days' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxMembers?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
