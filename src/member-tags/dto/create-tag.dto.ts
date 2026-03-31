import {
  IsString,
  IsNotEmpty,
  IsOptional,
  MaxLength,
  Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTagDto {
  @ApiProperty({ example: 'VIP', description: 'Unique tag name' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  @Matches(/^[a-z0-9][a-z0-9 -]*$/, {
    message:
      'Tag name may only contain lowercase letters, numbers, hyphens, and spaces',
  })
  name: string;

  @ApiPropertyOptional({ example: 'High-value members' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  @ApiPropertyOptional({
    example: '#FF5733',
    description: 'Hex color code',
  })
  @IsOptional()
  @IsString()
  @Matches(/^#[0-9A-Fa-f]{6}$/, {
    message: 'color must be a valid hex color (e.g. #FF5733)',
  })
  color?: string;
}
