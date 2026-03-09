import { ApiProperty } from '@nestjs/swagger';

export class TrainerScheduleResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  trainerId: string;

  @ApiProperty({ example: 'Morning HIIT Class' })
  title: string;

  @ApiProperty({
    example: 1,
    description: '0=Sunday, 1=Monday, ..., 6=Saturday',
  })
  dayOfWeek: number;

  @ApiProperty({ example: '06:00' })
  startTime: string;

  @ApiProperty({ example: '07:00' })
  endTime: string;

  @ApiProperty({ example: 10 })
  maxCapacity: number;
}
