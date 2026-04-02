import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserSummaryResponseDto } from '../../common/dto/user-summary-response.dto';

export class SubscriptionMemberResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  subscriptionId: string;

  @ApiProperty({ format: 'uuid' })
  memberId: string;

  @ApiPropertyOptional({ type: UserSummaryResponseDto })
  member?: UserSummaryResponseDto;
}
