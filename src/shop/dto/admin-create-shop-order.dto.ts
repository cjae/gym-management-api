import {
  IsUUID,
  IsEnum,
  IsArray,
  ValidateNested,
  ArrayMinSize,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { ADMIN_PAYMENT_METHODS } from '../../common/constants/payment-methods';
import type { AdminPaymentMethod } from '../../common/constants/payment-methods';
import { ShopOrderItemDto } from './create-shop-order.dto';

export class AdminCreateShopOrderDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  @MaxLength(36)
  memberId: string;

  @ApiProperty({ type: [ShopOrderItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ShopOrderItemDto)
  items: ShopOrderItemDto[];

  @ApiProperty({ enum: ADMIN_PAYMENT_METHODS })
  @IsEnum(ADMIN_PAYMENT_METHODS)
  paymentMethod: AdminPaymentMethod;
}
