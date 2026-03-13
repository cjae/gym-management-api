import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NotificationType } from '@prisma/client';

export class NotificationResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiPropertyOptional({ format: 'uuid' })
  userId?: string;

  @ApiProperty()
  title: string;

  @ApiProperty()
  body: string;

  @ApiProperty({ enum: NotificationType, example: 'GENERAL' })
  type: NotificationType;

  @ApiProperty()
  isRead: boolean;

  @ApiPropertyOptional()
  metadata?: Record<string, unknown>;

  @ApiProperty({ description: 'Push notifications sent successfully' })
  pushSentCount: number;

  @ApiProperty({ description: 'Push notifications that failed' })
  pushFailedCount: number;

  @ApiProperty()
  createdAt: Date;
}
