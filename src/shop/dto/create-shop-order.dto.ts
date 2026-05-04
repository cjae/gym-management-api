import {
  IsArray,
  ValidateNested,
  IsUUID,
  IsInt,
  Min,
  Max,
  IsOptional,
  IsEnum,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentMethod } from '@prisma/client';

export class ShopOrderItemDto {
  @ApiProperty() @IsUUID() shopItemId: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() variantId?: string;
  @ApiProperty({ minimum: 1, maximum: 9999 })
  @IsInt()
  @Min(1)
  @Max(9999)
  quantity: number;
}

export class CreateShopOrderDto {
  @ApiProperty({ type: [ShopOrderItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ShopOrderItemDto)
  items: ShopOrderItemDto[];

  @ApiProperty({
    enum: [
      PaymentMethod.CARD,
      PaymentMethod.MOBILE_MONEY,
      PaymentMethod.BANK_TRANSFER,
    ],
  })
  @IsEnum([
    PaymentMethod.CARD,
    PaymentMethod.MOBILE_MONEY,
    PaymentMethod.BANK_TRANSFER,
  ])
  paymentMethod: PaymentMethod;
}
