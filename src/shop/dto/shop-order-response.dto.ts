import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ShopOrderStatus, PaymentMethod } from '@prisma/client';

export class ShopOrderItemResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() shopOrderId: string;
  @ApiProperty() shopItemId: string;
  @ApiPropertyOptional() variantId?: string | null;
  @ApiProperty() quantity: number;
  @ApiProperty() unitPrice: number;
  @ApiProperty() createdAt: Date;
}

export class ShopOrderMemberDto {
  @ApiProperty() id: string;
  @ApiProperty() firstName: string;
  @ApiPropertyOptional() lastName?: string;
  @ApiPropertyOptional() email?: string;
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
  @ApiPropertyOptional({ type: ShopOrderMemberDto })
  member?: ShopOrderMemberDto;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}

export class PaystackCheckoutDto {
  @ApiProperty() authorization_url: string;
  @ApiProperty() access_code: string;
  @ApiProperty() reference: string;
}

export class CreateShopOrderResponseDto {
  @ApiProperty({ type: ShopOrderResponseDto }) order: ShopOrderResponseDto;
  @ApiPropertyOptional({
    type: PaystackCheckoutDto,
    description:
      'Paystack checkout data — present for online (card/mobile-money) orders',
  })
  checkout?: PaystackCheckoutDto;
}

export class PaginatedShopOrdersResponseDto {
  @ApiProperty({ type: [ShopOrderResponseDto] }) data: ShopOrderResponseDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
}
