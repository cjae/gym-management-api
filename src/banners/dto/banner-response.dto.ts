import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BannerCtaType } from '@prisma/client';

export class BannerListItemDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  title: string;

  @ApiPropertyOptional()
  body?: string;

  @ApiProperty()
  imageUrl: string;

  @ApiProperty({ enum: BannerCtaType })
  ctaType: BannerCtaType;

  @ApiPropertyOptional()
  ctaTarget?: string;

  @ApiPropertyOptional()
  ctaLabel?: string;

  @ApiPropertyOptional()
  discountCode?: string;

  @ApiProperty()
  displayOrder: number;

  @ApiProperty()
  isPublished: boolean;

  @ApiProperty()
  startDate: Date;

  @ApiProperty()
  endDate: Date;

  @ApiProperty()
  createdBy: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  @ApiProperty({ example: 1250 })
  totalImpressions: number;

  @ApiProperty({ example: 87 })
  totalTaps: number;
}

export class PaginatedBannersResponseDto {
  @ApiProperty({ type: [BannerListItemDto] })
  data: BannerListItemDto[];

  @ApiProperty({ example: 100 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;
}

export class ActiveBannerResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  title: string;

  @ApiPropertyOptional()
  body?: string;

  @ApiProperty()
  imageUrl: string;

  @ApiProperty({ enum: BannerCtaType })
  ctaType: BannerCtaType;

  @ApiPropertyOptional()
  ctaTarget?: string;

  @ApiPropertyOptional()
  ctaLabel?: string;

  @ApiPropertyOptional()
  discountCode?: string;

  @ApiProperty()
  displayOrder: number;
}
