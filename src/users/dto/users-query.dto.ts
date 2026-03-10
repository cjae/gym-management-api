import { IsEnum, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class UsersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: Role,
    description: 'Filter users by role',
    example: 'MEMBER',
  })
  @IsOptional()
  @IsEnum(Role)
  role?: Role;
}
