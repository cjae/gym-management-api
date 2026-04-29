import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ShopItemVariantResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() shopItemId: string;
  @ApiProperty() name: string;
  @ApiPropertyOptional() priceOverride?: number | null;
  @ApiProperty() stock: number;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}

export class ShopItemResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiPropertyOptional() description?: string | null;
  @ApiProperty() price: number;
  @ApiPropertyOptional() imageUrl?: string | null;
  @ApiProperty() stock: number;
  @ApiProperty() isActive: boolean;
  @ApiProperty({ type: [ShopItemVariantResponseDto] })
  variants: ShopItemVariantResponseDto[];
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}

export class PaginatedShopItemsResponseDto {
  @ApiProperty({ type: [ShopItemResponseDto] }) data: ShopItemResponseDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
}
