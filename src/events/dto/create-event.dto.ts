import {
  IsString,
  IsOptional,
  IsInt,
  IsDateString,
  Min,
  MaxLength,
  Matches,
  Validate,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEndTimeAfterStartTime } from '../../gym-classes/dto/validators/end-time-after-start-time.validator';

export class CreateEventDto {
  @ApiProperty({ example: 'Outdoor Bootcamp' })
  @IsString()
  @MaxLength(255)
  title: string;

  @ApiPropertyOptional({ example: 'A community outdoor fitness event at Uhuru Park' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiProperty({ example: '2026-04-15', description: 'Event date (YYYY-MM-DD)' })
  @IsDateString()
  date: string;

  @ApiProperty({ example: '09:00', description: '24-hour format HH:MM' })
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'startTime must be in HH:MM 24-hour format',
  })
  startTime: string;

  @ApiProperty({ example: '11:00', description: '24-hour format HH:MM' })
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'endTime must be in HH:MM 24-hour format',
  })
  @Validate(IsEndTimeAfterStartTime)
  endTime: string;

  @ApiPropertyOptional({ example: 'Uhuru Park, Nairobi' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  location?: string;

  @ApiPropertyOptional({ example: 50 })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxCapacity?: number;
}
