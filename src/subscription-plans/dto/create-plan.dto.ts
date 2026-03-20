import {
  IsString,
  IsNumber,
  IsOptional,
  IsInt,
  Min,
  Max,
  IsEnum,
  IsBoolean,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BillingInterval } from '@prisma/client';

export class CreatePlanDto {
  @ApiProperty({ example: 'Monthly Plan' })
  @IsString()
  name: string;

  @ApiProperty({ example: 2500 })
  @IsNumber()
  @Min(0)
  price: number;

  @ApiProperty({ enum: BillingInterval, example: 'MONTHLY' })
  @IsEnum(BillingInterval)
  billingInterval: BillingInterval;

  @ApiPropertyOptional({ example: 'Full access monthly subscription' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxMembers?: number;

  @ApiPropertyOptional({
    example: 20,
    description: 'Max freeze days per billing cycle. 0 = freeze not available.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  maxFreezeDays?: number;

  @ApiPropertyOptional({
    example: 3,
    description: 'Max number of freezes per billing cycle. Defaults to 1.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(52)
  maxFreezeCount?: number;

  @ApiPropertyOptional({
    example: false,
    description: 'Whether this plan is restricted to off-peak hours',
  })
  @IsOptional()
  @IsBoolean()
  isOffPeak?: boolean;
}
