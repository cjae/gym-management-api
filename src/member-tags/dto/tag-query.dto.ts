import { IsEnum, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { TagSource } from '@prisma/client';

export class TagQueryDto {
  @ApiPropertyOptional({
    enum: TagSource,
    description: 'Filter by tag source',
  })
  @IsOptional()
  @IsEnum(TagSource)
  source?: TagSource;
}
