import { ApiProperty } from '@nestjs/swagger';

export class LicensePlanResponseDto {
  @ApiProperty({ enum: ['ACTIVE', 'SUSPENDED', 'EXPIRED'] })
  status: 'ACTIVE' | 'SUSPENDED' | 'EXPIRED';

  @ApiProperty({
    description:
      'True when LICENSE_KEY is unset — all features unlocked, no expiry',
  })
  isDevMode: boolean;

  @ApiProperty({ nullable: true, type: String })
  gymName: string | null;

  @ApiProperty({ nullable: true, type: String })
  tierName: string | null;

  @ApiProperty({ nullable: true, type: Number })
  maxMembers: number | null;

  @ApiProperty({ nullable: true, type: Number })
  maxAdmins: number | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'ISO 8601 expiry date',
  })
  expiresAt: string | null;

  @ApiProperty({ type: [String] })
  features: string[];

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'ISO 8601 date of last license server check',
  })
  lastCheckedAt: string | null;
}
