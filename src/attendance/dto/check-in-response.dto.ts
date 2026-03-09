import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CheckInResponseDto {
  @ApiProperty({ example: false })
  alreadyCheckedIn: boolean;

  @ApiProperty({ example: 'Check-in successful!' })
  message: string;

  @ApiPropertyOptional({ example: 5 })
  streak?: number;

  @ApiPropertyOptional({ example: 10 })
  longestStreak?: number;
}
