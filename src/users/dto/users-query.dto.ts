import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
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

  @ApiPropertyOptional({
    description: 'Search by first name, last name, or email',
    example: 'john',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
