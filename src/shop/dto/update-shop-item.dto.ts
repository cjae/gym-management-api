import { PartialType } from '@nestjs/swagger';
import { CreateShopItemDto } from './create-shop-item.dto';
import { IsOptional, IsBoolean } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateShopItemDto extends PartialType(CreateShopItemDto) {
  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
