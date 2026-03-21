import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export enum DiscountCodeFilter {
  ACTIVE = 'active',
  EXPIRED = 'expired',
  INACTIVE = 'inactive',
}

export class DiscountCodeQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(DiscountCodeFilter)
  filter?: DiscountCodeFilter;
}
