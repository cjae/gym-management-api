import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { GoalCategory, GoalMetric } from '@prisma/client';

export class CreateGoalDto {
  @ApiProperty({ maxLength: 120 })
  @IsString()
  @MaxLength(120)
  title: string;

  @ApiProperty({ enum: GoalCategory })
  @IsEnum(GoalCategory)
  category: GoalCategory;

  @ApiProperty({ enum: GoalMetric })
  @IsEnum(GoalMetric)
  metric: GoalMetric;

  @ApiProperty({ minimum: 0, maximum: 9999 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(9999)
  currentValue: number;

  @ApiProperty({ minimum: 0, maximum: 9999 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(9999)
  targetValue: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 7 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(7)
  requestedFrequency?: number;

  @ApiPropertyOptional({ description: 'ISO 8601 date string (must be future)' })
  @IsOptional()
  @IsDateString()
  userDeadline?: string;
}
