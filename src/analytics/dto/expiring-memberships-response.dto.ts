import { ApiProperty } from '@nestjs/swagger';

class ExpiringMembershipDto {
  @ApiProperty({ example: 'uuid' })
  memberId: string;

  @ApiProperty({ example: 'Jane Muthoni' })
  memberName: string;

  @ApiProperty({ example: 'Premium Monthly' })
  planName: string;

  @ApiProperty()
  expiresAt: Date;

  @ApiProperty({ example: 6 })
  daysUntilExpiry: number;
}

export class ExpiringMembershipsResponseDto {
  @ApiProperty({ type: [ExpiringMembershipDto] })
  memberships: ExpiringMembershipDto[];
}
