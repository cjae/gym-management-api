import { ApiProperty } from '@nestjs/swagger';
import { LeaderboardEntryResponseDto } from './leaderboard-entry-response.dto';

export class PaginatedLeaderboardResponseDto {
  @ApiProperty({ type: [LeaderboardEntryResponseDto] })
  data: LeaderboardEntryResponseDto[];

  @ApiProperty({ example: 100 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;
}
