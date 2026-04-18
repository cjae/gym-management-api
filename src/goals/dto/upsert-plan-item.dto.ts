import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreatePlanItemDto {
  @ApiProperty({ minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  weekNumber: number;

  @ApiProperty({ maxLength: 20 })
  @IsString()
  @MaxLength(20)
  dayLabel: string;

  @ApiProperty({ minimum: 1, maximum: 20 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  exerciseOrder: number;

  @ApiProperty({ maxLength: 300 })
  @IsString()
  @MaxLength(300)
  description: string;

  @ApiPropertyOptional({
    maxLength: 50,
    description: 'strength | cardio | HIIT | flexibility | warmup | cooldown',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  workoutType?: string;

  @ApiPropertyOptional({
    maxLength: 50,
    description: 'e.g. chest, legs, full body, core',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  muscleGroup?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(99)
  sets?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(999)
  reps?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(2000)
  weight?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(600)
  duration?: number;

  @ApiPropertyOptional({ description: 'Rest between sets in seconds' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(600)
  restSeconds?: number;

  @ApiPropertyOptional({
    description: 'Distance in km (running/cycling/rowing)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(200)
  distanceKm?: number;

  @ApiPropertyOptional({
    description: 'Pace in minutes per km (running/cycling)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(60)
  paceMinPerKm?: number;

  @ApiPropertyOptional({
    maxLength: 200,
    description:
      'Form cue, safety tip, or technique reminder. HTML-escape before rendering.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  notes?: string;
}

export class UpdatePlanItemDto extends PartialType(CreatePlanItemDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  completed?: boolean;
}
