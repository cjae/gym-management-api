import { ApiProperty } from '@nestjs/swagger';
import { LeaderboardMemberDto } from './leaderboard-member.dto';

export class LeaderboardEntryResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  memberId: string;

  @ApiProperty({
    example: 15,
    description: 'Consecutive weeks with 4+ check-ins',
  })
  weeklyStreak: number;

  @ApiProperty({ example: 20, description: 'Best weekly streak ever' })
  longestStreak: number;

  @ApiProperty({ type: LeaderboardMemberDto })
  member: LeaderboardMemberDto;
}
