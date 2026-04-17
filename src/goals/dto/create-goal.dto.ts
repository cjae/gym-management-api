import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
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

  @ApiProperty({ minimum: 0 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  currentValue: number;

  @ApiProperty({ minimum: 0 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  targetValue: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 7 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(7)
  requestedFrequency?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  userDeadline?: Date;
}
