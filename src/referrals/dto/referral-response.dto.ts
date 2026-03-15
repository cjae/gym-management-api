import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ReferralStatus } from '@prisma/client';

export class ReferralResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Jane Doe' })
  referredName: string;

  @ApiProperty({ enum: ReferralStatus })
  status: ReferralStatus;

  @ApiProperty({ example: 7 })
  rewardDays: number;

  @ApiPropertyOptional()
  completedAt?: Date;

  @ApiProperty()
  createdAt: Date;
}

export class PaginatedReferralsResponseDto {
  @ApiProperty({ type: [ReferralResponseDto] })
  data: ReferralResponseDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;
}

export class ReferralCodeResponseDto {
  @ApiProperty({ example: 'A1B2C3D4' })
  referralCode: string;
}
