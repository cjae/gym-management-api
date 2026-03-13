import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TrainerAssignmentResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  trainerId: string;

  @ApiProperty({ format: 'uuid' })
  memberId: string;

  @ApiProperty()
  startDate: Date;

  @ApiPropertyOptional()
  endDate?: Date;

  @ApiPropertyOptional({ example: 'Focus on cardio and flexibility' })
  notes?: string;
}
