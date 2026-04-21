import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ExperienceLevel, Gender, PrimaryMotivation } from '@prisma/client';

const WEEKDAY_CODES = [
  'MON',
  'TUE',
  'WED',
  'THU',
  'FRI',
  'SAT',
  'SUN',
] as const;

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'John', description: 'First name' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  firstName?: string;

  @ApiPropertyOptional({ example: 'Doe', description: 'Last name' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;

  @ApiPropertyOptional({
    example: '+254712345678',
    description: 'Phone number',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @ApiPropertyOptional({
    example: 'MALE',
    description: 'Gender',
    enum: Gender,
  })
  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @ApiPropertyOptional({
    example: 'https://res.cloudinary.com/example/image/upload/v1/avatar.jpg',
    description: 'Display picture URL',
  })
  @IsOptional()
  @IsUrl()
  displayPicture?: string;

  @ApiPropertyOptional({
    example: '2000-03-10',
    description: 'Date of birth (YYYY-MM-DD)',
  })
  @IsOptional()
  @IsDateString()
  birthday?: string;

  @ApiPropertyOptional({ enum: ExperienceLevel, example: 'INTERMEDIATE' })
  @IsOptional()
  @IsEnum(ExperienceLevel)
  experienceLevel?: ExperienceLevel;

  @ApiPropertyOptional({
    example: 72.5,
    description: 'Bodyweight in kilograms (20-400).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(20)
  @Max(400)
  bodyweightKg?: number;

  @ApiPropertyOptional({
    example: 175,
    description: 'Height in centimetres (100-250).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 0 })
  @Min(100)
  @Max(250)
  heightCm?: number;

  @ApiPropertyOptional({
    example: 60,
    description: 'Typical session length in minutes (15-240).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 0 })
  @Min(15)
  @Max(240)
  sessionMinutes?: number;

  @ApiPropertyOptional({
    example: ['MON', 'WED', 'FRI'],
    description: 'Preferred training days, uppercase weekday codes.',
    isArray: true,
    enum: WEEKDAY_CODES,
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsString({ each: true })
  @IsIn(WEEKDAY_CODES as unknown as string[], { each: true })
  preferredTrainingDays?: string[];

  @ApiPropertyOptional({
    example: 7.5,
    description: 'Average nightly sleep in hours (0-24).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(24)
  sleepHoursAvg?: number;

  @ApiPropertyOptional({ enum: PrimaryMotivation, example: 'STRENGTH' })
  @IsOptional()
  @IsEnum(PrimaryMotivation)
  primaryMotivation?: PrimaryMotivation;

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
