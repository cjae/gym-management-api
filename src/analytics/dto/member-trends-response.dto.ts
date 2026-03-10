import { ApiProperty } from '@nestjs/swagger';

class MemberPeriodDto {
  @ApiProperty({ example: '2026-03' })
  period: string;

  @ApiProperty({ example: 12 })
  newMembers: number;

  @ApiProperty({ example: 150 })
  totalMembers: number;
}

export class MemberTrendsResponseDto {
  @ApiProperty({ type: [MemberPeriodDto] })
  series: MemberPeriodDto[];

  @ApiProperty({
    example: { MEMBER: 120, TRAINER: 5, ADMIN: 2, SUPER_ADMIN: 1 },
    description: 'User count by role',
  })
  byRole: Record<string, number>;

  @ApiProperty({
    example: { ACTIVE: 130, INACTIVE: 5, SUSPENDED: 2 },
    description: 'User count by status',
  })
  byStatus: Record<string, number>;
}
