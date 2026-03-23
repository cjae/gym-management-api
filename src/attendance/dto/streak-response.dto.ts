import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class StreakResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  memberId: string;

  @ApiProperty({
    example: 5,
    description: 'Consecutive weeks with 4+ check-ins',
  })
  weeklyStreak: number;

  @ApiProperty({ example: 10, description: 'Best weekly streak ever' })
  longestStreak: number;

  @ApiProperty({
    example: 3,
    description: 'Check-ins so far this week (Mon-Sat)',
  })
  daysThisWeek: number;

  @ApiProperty({ example: 5, description: 'Most check-ins in a single week' })
  bestWeek: number;

  @ApiProperty({ description: 'Monday of the current tracking week' })
  weekStart: Date;

  @ApiPropertyOptional()
  lastCheckInDate?: Date;
}
