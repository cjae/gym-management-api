import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { Role } from '@prisma/client';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class UsersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: Role,
    isArray: true,
    description:
      'Filter users by role(s). Pass multiple: ?role=ADMIN&role=TRAINER',
    example: ['ADMIN', 'TRAINER'],
  })
  @IsOptional()
  @Transform(({ value }) => (Array.isArray(value) ? value : [value]))
  @IsEnum(Role, { each: true })
  role?: Role[];

  @ApiPropertyOptional({
    description: 'Search by first name, last name, or email',
    example: 'john',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
