import { ApiProperty } from '@nestjs/swagger';

export class ShopAnalyticsOrdersDto {
  @ApiProperty() total: number;
  @ApiProperty() pending: number;
  @ApiProperty() paid: number;
  @ApiProperty() collected: number;
  @ApiProperty() cancelled: number;
}

export class ShopAnalyticsRevenueDto {
  @ApiProperty() allTime: number;
  @ApiProperty() thisMonth: number;
  @ApiProperty() lastMonth: number;
}

export class ShopTopItemDto {
  @ApiProperty() itemId: string;
  @ApiProperty() name: string;
  @ApiProperty() revenue: number;
  @ApiProperty() unitsSold: number;
}

export class ShopAnalyticsResponseDto {
  @ApiProperty({ type: ShopAnalyticsOrdersDto }) orders: ShopAnalyticsOrdersDto;
  @ApiProperty({ type: ShopAnalyticsRevenueDto })
  revenue: ShopAnalyticsRevenueDto;
  @ApiProperty() avgOrderValue: number;
  @ApiProperty() unitsSold: number;
  @ApiProperty({ type: [ShopTopItemDto] }) topItems: ShopTopItemDto[];
  @ApiProperty() lowStockCount: number;
}

export class ShopRevenueByMethodDto {
  @ApiProperty() card: number;
  @ApiProperty() mobileMoney: number;
  @ApiProperty() bankTransfer: number;
  @ApiProperty() complimentary: number;
}

export class ShopRevenuePeriodDto {
  @ApiProperty() period: string;
  @ApiProperty() revenue: number;
  @ApiProperty() orders: number;
  @ApiProperty({ type: ShopRevenueByMethodDto })
  byMethod: ShopRevenueByMethodDto;
}

export class ShopRevenueTrendsResponseDto {
  @ApiProperty({ type: [ShopRevenuePeriodDto] }) series: ShopRevenuePeriodDto[];
}
