import { ApiProperty } from '@nestjs/swagger';

class MemberPeriodDto {
  @ApiProperty({ example: '2026-03' })
  period: string;

  @ApiProperty({ example: 12 })
  newMembers: number;

  @ApiProperty({ example: 150 })
  totalMembers: number;
}

class RoleBreakdownDto {
  @ApiProperty({ example: 'MEMBER' })
  role: string;

  @ApiProperty({ example: 120 })
  count: number;
}

class StatusBreakdownDto {
  @ApiProperty({ example: 'ACTIVE' })
  status: string;

  @ApiProperty({ example: 130 })
  count: number;
}

export class MemberTrendsResponseDto {
  @ApiProperty({ type: [MemberPeriodDto] })
  series: MemberPeriodDto[];

  @ApiProperty({ type: [RoleBreakdownDto] })
  byRole: RoleBreakdownDto[];

  @ApiProperty({ type: [StatusBreakdownDto] })
  byStatus: StatusBreakdownDto[];
}
