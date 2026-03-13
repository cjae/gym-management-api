import {
  IsString,
  IsInt,
  Min,
  Max,
  IsOptional,
  Matches,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
  Validate,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

@ValidatorConstraint({ name: 'isEndTimeAfterStartTime', async: false })
export class IsEndTimeAfterStartTime implements ValidatorConstraintInterface {
  validate(_value: string, args: ValidationArguments) {
    const obj = args.object as { startTime?: string; endTime?: string };
    if (!obj.startTime || !obj.endTime) return true;
    return obj.startTime < obj.endTime;
  }

  defaultMessage() {
    return 'endTime must be after startTime';
  }
}

export class CreateScheduleDto {
  @ApiProperty({ example: 'Morning HIIT' })
  @IsString()
  title: string;

  @ApiProperty({
    example: 1,
    description: 'Day of week (0 = Sunday, 6 = Saturday)',
  })
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

  @ApiPropertyOptional({ example: 15 })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxCapacity?: number;
}
