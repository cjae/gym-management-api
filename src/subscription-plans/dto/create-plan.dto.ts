import {
  IsString,
  IsNumber,
  IsOptional,
  IsInt,
  Min,
  IsEnum,
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
}
