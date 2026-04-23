import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { sanitizeText } from '../../common/utils/sanitize-text';

export class CreateProgressLogDto {
  @ApiProperty({ minimum: 0 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  value: number;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? sanitizeText(value) : value,
  )
  @IsString()
  @MaxLength(500)
  note?: string;
}
