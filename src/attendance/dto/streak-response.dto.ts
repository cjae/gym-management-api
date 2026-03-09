import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class StreakResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  memberId: string;

  @ApiProperty({ example: 5 })
  currentStreak: number;

  @ApiProperty({ example: 10 })
  longestStreak: number;

  @ApiPropertyOptional()
  lastCheckInDate?: Date;
}
