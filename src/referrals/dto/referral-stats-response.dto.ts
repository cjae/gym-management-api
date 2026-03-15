import { ApiProperty } from '@nestjs/swagger';

export class ReferralStatsResponseDto {
  @ApiProperty({ example: 12 })
  totalReferrals: number;

  @ApiProperty({ example: 8 })
  completedReferrals: number;

  @ApiProperty({ example: 49 })
  totalDaysEarned: number;

  @ApiProperty({ example: 2 })
  referralsThisCycle: number;

  @ApiProperty({ example: 3 })
  maxReferralsPerCycle: number;

  @ApiProperty({ example: 1 })
  remainingThisCycle: number;

  @ApiProperty({ example: 7 })
  rewardDaysPerReferral: number;
}
