import {
  IsString,
  IsInt,
  Min,
  Max,
  IsOptional,
  IsUUID,
  MaxLength,
  Matches,
  Validate,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEndTimeAfterStartTime } from './validators/end-time-after-start-time.validator';

export class CreateGymClassDto {
  @ApiProperty({ example: 'Morning HIIT' })
  @IsString()
  @MaxLength(255)
  title: string;

  @ApiPropertyOptional({ example: 'High-intensity interval training session' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({ example: 1, description: 'Day of week (0 = Sunday, 6 = Saturday)' })
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek: number;

  @ApiProperty({ example: '06:00', description: '24-hour format HH:MM' })
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'startTime must be in HH:MM 24-hour format',
  })
  startTime: string;

  @ApiProperty({ example: '07:00', description: '24-hour format HH:MM' })
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'endTime must be in HH:MM 24-hour format',
  })
  @Validate(IsEndTimeAfterStartTime)
  endTime: string;

  @ApiPropertyOptional({ example: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxCapacity?: number;

  @ApiPropertyOptional({ example: 'trainer-profile-uuid', description: 'Trainer profile ID to assign' })
  @IsOptional()
  @IsUUID()
  trainerId?: string;
}
