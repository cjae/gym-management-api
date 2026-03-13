import { ApiProperty } from '@nestjs/swagger';

class RevenueByMethodDto {
  @ApiProperty({ example: 250000 })
  card: number;

  @ApiProperty({ example: 180000 })
  mpesa: number;
}

class RevenuePeriodDto {
  @ApiProperty({ example: '2026-03' })
  period: string;

  @ApiProperty({ example: 500000 })
  total: number;

  @ApiProperty({ example: 450000 })
  paid: number;

  @ApiProperty({ example: 30000 })
  failed: number;

  @ApiProperty({ example: 20000 })
  pending: number;

  @ApiProperty({ type: RevenueByMethodDto })
  byMethod: RevenueByMethodDto;
}

export class RevenueTrendsResponseDto {
  @ApiProperty({ type: [RevenuePeriodDto] })
  series: RevenuePeriodDto[];
}
