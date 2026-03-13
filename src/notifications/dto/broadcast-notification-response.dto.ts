import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NotificationType } from '@prisma/client';

export class BroadcastNotificationResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  title: string;

  @ApiProperty()
  body: string;

  @ApiProperty({ enum: NotificationType, example: 'GENERAL' })
  type: NotificationType;

  @ApiPropertyOptional()
  metadata?: Record<string, unknown>;

  @ApiProperty({ description: 'Number of push notifications sent successfully' })
  pushSentCount: number;

  @ApiProperty({ description: 'Number of push notifications that failed' })
  pushFailedCount: number;

  @ApiProperty({ description: 'Number of users who have read this notification' })
  readCount: number;

  @ApiProperty()
  createdAt: Date;
}
