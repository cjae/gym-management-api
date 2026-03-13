import { ApiProperty } from '@nestjs/swagger';

export class InteractionCountDto {
  @ApiProperty({ example: 1250 })
  total: number;

  @ApiProperty({ example: 340 })
  unique: number;
}

export class BannerAnalyticsResponseDto {
  @ApiProperty({ format: 'uuid' })
  bannerId: string;

  @ApiProperty()
  title: string;

  @ApiProperty()
  period: { startDate: Date; endDate: Date };

  @ApiProperty({ type: InteractionCountDto })
  impressions: InteractionCountDto;

  @ApiProperty({ type: InteractionCountDto })
  taps: InteractionCountDto;

  @ApiProperty({ example: 18.24 })
  tapThroughRate: number;
}
