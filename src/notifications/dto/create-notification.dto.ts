import {
  IsString,
  IsOptional,
  IsUUID,
  MaxLength,
  IsObject,
  IsEnum,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NotificationType } from '@prisma/client';

export class CreateNotificationDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Target user ID. Omit for broadcast notification.',
  })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiProperty({ example: 'Gym Closed Tomorrow', maxLength: 100 })
  @IsString()
  @MaxLength(100)
  title: string;

  @ApiProperty({
    example: 'The gym will be closed for maintenance on Saturday.',
    maxLength: 200,
  })
  @IsString()
  @MaxLength(200)
  body: string;

  @ApiProperty({ enum: NotificationType, example: 'GENERAL' })
  @IsEnum(NotificationType)
  type: NotificationType;

  @ApiPropertyOptional({
    description: 'Arbitrary key-value data attached to the notification',
    example: { link: '/announcements/123' },
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
