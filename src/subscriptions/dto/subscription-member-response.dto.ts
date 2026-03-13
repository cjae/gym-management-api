import { ApiProperty } from '@nestjs/swagger';

export class SubscriptionMemberResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  subscriptionId: string;

  @ApiProperty({ format: 'uuid' })
  memberId: string;
}
