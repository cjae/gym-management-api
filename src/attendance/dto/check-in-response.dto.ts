import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CheckInResponseDto {
  @ApiProperty({ example: false })
  alreadyCheckedIn: boolean;

  @ApiProperty({ example: 'Check-in successful!' })
  message: string;

  @ApiPropertyOptional({
    example: 5,
    description: 'Consecutive weeks with 4+ check-ins',
  })
  weeklyStreak?: number;

  @ApiPropertyOptional({ example: 10, description: 'Best weekly streak ever' })
  longestStreak?: number;

  @ApiPropertyOptional({
    example: 3,
    description: 'Check-ins so far this week (Mon-Sat)',
  })
  daysThisWeek?: number;

  @ApiPropertyOptional({
    example: 4,
    description: 'Check-ins required per week',
  })
  daysRequired?: number;

  @ApiPropertyOptional({
    example: true,
    description: "True when this is the member's very first check-in",
  })
  isFirstCheckIn?: boolean;

  @ApiPropertyOptional({
    example: true,
    description:
      'True when this check-in resulted in a new longest streak record',
  })
  isNewStreakRecord?: boolean;
}
