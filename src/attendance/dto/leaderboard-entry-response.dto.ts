import { ApiProperty } from '@nestjs/swagger';
import { LeaderboardMemberDto } from './leaderboard-member.dto';

export class LeaderboardEntryResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  memberId: string;

  @ApiProperty({ example: 15 })
  currentStreak: number;

  @ApiProperty({ example: 20 })
  longestStreak: number;

  @ApiProperty({ type: LeaderboardMemberDto })
  member: LeaderboardMemberDto;
}
