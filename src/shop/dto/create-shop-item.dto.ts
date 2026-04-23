import {
  IsString,
  IsNotEmpty,
  IsNumber,
  Min,
  IsOptional,
  IsUrl,
  MaxLength,
  IsInt,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateShopItemDto {
  @ApiProperty({ example: 'Protein Shake - Chocolate' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional({ example: 'Premium whey protein, 1kg' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiProperty({ example: 2500 })
  @IsNumber()
  @Min(0)
  price: number;

  @ApiPropertyOptional({ example: 'https://res.cloudinary.com/...' })
  @IsOptional()
  @IsUrl()
  imageUrl?: string;

  @ApiPropertyOptional({
    example: 10,
    description: 'Stock when no variants exist',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  stock?: number;
}
