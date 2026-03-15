import { IsString, IsOptional, IsEnum, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DayOfWeek } from '@prisma/client';

export class CreateOffPeakWindowDto {
  @ApiPropertyOptional({
    enum: DayOfWeek,
    example: 'MONDAY',
    description: 'Null = applies every day',
  })
  @IsOptional()
  @IsEnum(DayOfWeek)
  dayOfWeek?: DayOfWeek;

  @ApiProperty({ example: '06:00', description: 'Start time in HH:mm 24h format' })
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'startTime must be in HH:mm format (00:00-23:59)',
  })
  startTime: string;

  @ApiProperty({ example: '10:00', description: 'End time in HH:mm 24h format' })
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'endTime must be in HH:mm format (00:00-23:59)',
  })
  endTime: string;
}
