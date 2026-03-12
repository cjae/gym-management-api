import { ApiProperty } from '@nestjs/swagger';
import { TodayAttendanceResponseDto } from './today-attendance-response.dto';

export class PaginatedAttendanceResponseDto {
  @ApiProperty({ type: [TodayAttendanceResponseDto] })
  data: TodayAttendanceResponseDto[];

  @ApiProperty({ example: 100 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;
}
