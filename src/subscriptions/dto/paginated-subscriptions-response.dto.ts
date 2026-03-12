import { ApiProperty } from '@nestjs/swagger';
import { SubscriptionResponseDto } from './subscription-response.dto';

export class PaginatedSubscriptionsResponseDto {
  @ApiProperty({ type: [SubscriptionResponseDto] })
  data: SubscriptionResponseDto[];

  @ApiProperty({ example: 100 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;
}
