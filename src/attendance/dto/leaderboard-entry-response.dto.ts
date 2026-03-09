import { ApiProperty } from '@nestjs/swagger';
import { UserResponseDto } from '../../users/dto/user-response.dto';

export class LeaderboardEntryResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  memberId: string;

  @ApiProperty({ example: 15 })
  currentStreak: number;

  @ApiProperty({ example: 20 })
  longestStreak: number;

  @ApiProperty({ type: UserResponseDto })
  member: UserResponseDto;
}
