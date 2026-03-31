import { IsEnum, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { SortOrder, SortQueryDto } from '../../common/dto/sort-query.dto';

export enum PlanSortBy {
  NAME = 'name',
  PRICE = 'price',
  BILLING_INTERVAL = 'billingInterval',
  CREATED_AT = 'createdAt',
}

export class PlansSortQueryDto extends SortQueryDto {
  @ApiPropertyOptional({
    enum: PlanSortBy,
    default: PlanSortBy.NAME,
    description: 'Field to sort by',
  })
  @IsOptional()
  @IsEnum(PlanSortBy)
  sortBy?: PlanSortBy = PlanSortBy.NAME;
}

export class PaginatedPlansSortQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: PlanSortBy,
    default: PlanSortBy.NAME,
    description: 'Field to sort by',
  })
  @IsOptional()
  @IsEnum(PlanSortBy)
  sortBy?: PlanSortBy = PlanSortBy.NAME;

  @ApiPropertyOptional({
    enum: SortOrder,
    default: SortOrder.ASC,
    description: 'Sort direction',
  })
  @IsOptional()
  @IsEnum(SortOrder)
  sortOrder?: SortOrder = SortOrder.ASC;
}
