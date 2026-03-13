import { ApiProperty } from '@nestjs/swagger';

class AttendancePeriodDto {
  @ApiProperty({ example: '2026-03' })
  period: string;

  @ApiProperty({ example: 1200 })
  checkIns: number;

  @ApiProperty({ example: 95 })
  uniqueMembers: number;
}

export class AttendanceTrendsResponseDto {
  @ApiProperty({ type: [AttendancePeriodDto] })
  series: AttendancePeriodDto[];

  @ApiProperty({ example: 'Monday', description: 'Day with most check-ins' })
  peakDayOfWeek: string;

  @ApiProperty({ example: 7, description: 'Hour (0-23) with most check-ins' })
  peakHour: number;
}
