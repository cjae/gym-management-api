import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class OffPeakWindowResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiPropertyOptional({
    enum: [
      'MONDAY',
      'TUESDAY',
      'WEDNESDAY',
      'THURSDAY',
      'FRIDAY',
      'SATURDAY',
      'SUNDAY',
    ],
  })
  dayOfWeek?: string;

  @ApiProperty({ example: '06:00' })
  startTime: string;

  @ApiProperty({ example: '10:00' })
  endTime: string;
}

export class GymSettingsResponseDto {
  @ApiProperty({ example: 'singleton' })
  id: string;

  @ApiProperty({ example: 'Africa/Nairobi' })
  timezone: string;

  @ApiProperty({ example: 7, description: 'Free days per referral' })
  referralRewardDays: number;

  @ApiProperty({
    example: 3,
    description: 'Max referrals rewarded per billing cycle',
  })
  maxReferralsPerCycle: number;

  @ApiProperty({ type: [OffPeakWindowResponseDto] })
  offPeakWindows: OffPeakWindowResponseDto[];

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
