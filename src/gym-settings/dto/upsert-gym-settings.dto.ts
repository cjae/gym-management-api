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
}
