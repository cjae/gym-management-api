import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ExperienceLevel, PrimaryMotivation } from '@prisma/client';

const WEEKDAY_CODES = [
  'MON',
  'TUE',
  'WED',
  'THU',
  'FRI',
  'SAT',
  'SUN',
] as const;

export class OnboardingDto {
  @ApiProperty({ enum: ExperienceLevel, example: 'INTERMEDIATE' })
  @IsEnum(ExperienceLevel)
  experienceLevel: ExperienceLevel;

  @ApiProperty({
    example: 72.5,
    description: 'Bodyweight in kilograms (20-400).',
  })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(20)
  @Max(400)
  bodyweightKg: number;

  @ApiProperty({
    example: 175,
    description: 'Height in centimetres (100-250).',
  })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 0 })
  @Min(100)
  @Max(250)
  heightCm: number;

  @ApiProperty({
    example: 60,
    description: 'Typical training session length in minutes (15-240).',
  })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 0 })
  @Min(15)
  @Max(240)
  sessionMinutes: number;

  @ApiProperty({
    example: ['MON', 'WED', 'FRI'],
    description: 'Preferred training days, uppercase weekday codes.',
    isArray: true,
    enum: WEEKDAY_CODES,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsString({ each: true })
  @IsIn(WEEKDAY_CODES as unknown as string[], { each: true })
  preferredTrainingDays: string[];

  @ApiProperty({
    example: 7.5,
    description: 'Average nightly sleep in hours (0-24).',
  })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(24)
  sleepHoursAvg: number;

  @ApiProperty({ enum: PrimaryMotivation, example: 'STRENGTH' })
  @IsEnum(PrimaryMotivation)
  primaryMotivation: PrimaryMotivation;

  @ApiPropertyOptional({
    example: 'Mild right shoulder impingement, avoid overhead press',
    description: 'Free-form injury notes (max 500 chars).',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  injuryNotes?: string;
}
