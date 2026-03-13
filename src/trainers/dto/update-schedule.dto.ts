import {
  IsString,
  IsInt,
  Min,
  Max,
  IsOptional,
  Matches,
  Validate,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEndTimeAfterStartTime } from './create-schedule.dto';

export class UpdateScheduleDto {
  @ApiPropertyOptional({ example: 'Morning HIIT' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({
    example: 1,
    description: 'Day of week (0 = Sunday, 6 = Saturday)',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek?: number;

  @ApiPropertyOptional({
    example: '06:00',
    description: '24-hour format HH:MM',
  })
  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'startTime must be in HH:MM 24-hour format',
  })
  startTime?: string;

  @ApiPropertyOptional({
    example: '07:00',
    description: '24-hour format HH:MM',
  })
  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'endTime must be in HH:MM 24-hour format',
  })
  @Validate(IsEndTimeAfterStartTime)
  endTime?: string;

  @ApiPropertyOptional({ example: 15 })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxCapacity?: number;
}
