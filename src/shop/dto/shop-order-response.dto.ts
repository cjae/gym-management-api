import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ShopOrderStatus, PaymentMethod } from '@prisma/client';

export class ShopOrderItemResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() shopItemId: string;
  @ApiPropertyOptional() variantId?: string | null;
  @ApiProperty() quantity: number;
  @ApiProperty() unitPrice: number;
}

export class ShopOrderResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() memberId: string;
  @ApiProperty({ enum: ShopOrderStatus }) status: ShopOrderStatus;
  @ApiProperty() totalAmount: number;
  @ApiProperty() currency: string;
  @ApiProperty({ enum: PaymentMethod }) paymentMethod: PaymentMethod;
  @ApiPropertyOptional() paystackReference?: string | null;
  @ApiProperty({ type: [ShopOrderItemResponseDto] })
  orderItems: ShopOrderItemResponseDto[];
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}

export class CreateShopOrderResponseDto {
  @ApiProperty({ type: ShopOrderResponseDto }) order: ShopOrderResponseDto;
  @ApiPropertyOptional({
    description: 'Paystack checkout URL — present for online orders',
  })
  checkout?: {
    authorization_url: string;
    access_code: string;
    reference: string;
  };
}

export class PaginatedShopOrdersResponseDto {
  @ApiProperty({ type: [ShopOrderResponseDto] }) data: ShopOrderResponseDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
}
