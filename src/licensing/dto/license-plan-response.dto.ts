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

  @ApiProperty({
    type: [String],
    description:
      'Licensed feature keys. Empty when isDevMode is true — check isDevMode first, as all features are unlocked in dev mode regardless of this array.',
  })
  features: string[];

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'ISO 8601 date of last license server check',
  })
  lastCheckedAt: string | null;
}
