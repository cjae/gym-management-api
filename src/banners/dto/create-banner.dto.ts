import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BannerCtaType } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateBannerDto {
  @ApiProperty({ example: 'Summer Promo', maxLength: 200 })
  @IsString()
  @MaxLength(200)
  title: string;

  @ApiPropertyOptional({ example: 'Get 20% off all plans!', maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  body?: string;

  @ApiProperty({ example: 'https://res.cloudinary.com/example/image.jpg' })
  @IsUrl()
  imageUrl: string;

  @ApiProperty({ enum: BannerCtaType, example: 'NONE', default: 'NONE' })
  @IsEnum(BannerCtaType)
  ctaType: BannerCtaType;

  @ApiPropertyOptional({ example: '/subscription-plans' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  ctaTarget?: string;

  @ApiPropertyOptional({ example: 'View Plans' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  ctaLabel?: string;

  @ApiPropertyOptional({ example: 'SUMMER20' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  discountCode?: string;

  @ApiProperty({ example: 0, default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  displayOrder?: number;

  @ApiProperty({ example: '2026-03-15T00:00:00.000Z' })
  @IsDateString()
  startDate: string;

  @ApiProperty({ example: '2026-04-15T00:00:00.000Z' })
  @IsDateString()
  endDate: string;
}
