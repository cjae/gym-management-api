import {
  IsString,
  IsOptional,
  MaxLength,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpsertGymSettingsDto {
  @ApiPropertyOptional({
    example: 'Africa/Nairobi',
    description: 'IANA timezone identifier',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  timezone?: string;

  @ApiPropertyOptional({
    example: 7,
    description: 'Free days earned per successful referral',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(90)
  referralRewardDays?: number;

  @ApiPropertyOptional({
    example: 3,
    description: 'Max referral rewards per billing cycle',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  maxReferralsPerCycle?: number;

  @ApiPropertyOptional({
    example: 14,
    description: 'Days since registration to consider a member "new"',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(90)
  newMemberDays?: number;

  @ApiPropertyOptional({
    example: 7,
    description: 'Days since last check-in to consider a member "active"',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(90)
  activeDays?: number;

  @ApiPropertyOptional({
    example: 14,
    description: 'Days without check-in to consider a member "inactive"',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(180)
  inactiveDays?: number;

  @ApiPropertyOptional({
    example: 30,
    description: 'Days without check-in to consider a member "dormant"',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  dormantDays?: number;

  @ApiPropertyOptional({
    example: 14,
    description:
      'Days without check-in (with active sub) to consider "at-risk"',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(180)
  atRiskDays?: number;

  @ApiPropertyOptional({
    example: 4,
    description: 'Weekly streak threshold to tag a member as "loyal"',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(52)
  loyalStreakWeeks?: number;
}
