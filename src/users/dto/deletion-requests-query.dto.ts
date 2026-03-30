import { IsEnum, IsOptional } from 'class-validator';
import { DeletionRequestStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class DeletionRequestsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(DeletionRequestStatus)
  status?: DeletionRequestStatus;
}
