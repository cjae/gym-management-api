import { PartialType } from '@nestjs/swagger';
import { CreateShopItemVariantDto } from './create-shop-item-variant.dto';

export class UpdateShopItemVariantDto extends PartialType(
  CreateShopItemVariantDto,
) {}
