import { ApiProperty } from '@nestjs/swagger';
import { BannerInteractionType } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class CreateBannerInteractionDto {
  @ApiProperty({ enum: BannerInteractionType, example: 'IMPRESSION' })
  @IsEnum(BannerInteractionType)
  type: BannerInteractionType;
}
