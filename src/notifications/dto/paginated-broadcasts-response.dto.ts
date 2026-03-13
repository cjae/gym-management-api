import { ApiProperty } from '@nestjs/swagger';
import { BroadcastNotificationResponseDto } from './broadcast-notification-response.dto';

export class PaginatedBroadcastsResponseDto {
  @ApiProperty({ type: [BroadcastNotificationResponseDto] })
  data: BroadcastNotificationResponseDto[];

  @ApiProperty({ example: 100 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;
}
