import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';
import { GoalStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class ListGoalsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: GoalStatus, isArray: true })
  @IsOptional()
  @IsEnum(GoalStatus, { each: true })
  @Transform(({ value }) => (Array.isArray(value) ? value : [value]))
  status?: GoalStatus[];
}
