import { ApiProperty } from '@nestjs/swagger';
import { UserSummaryResponseDto } from '../../common/dto/user-summary-response.dto';

export class PaginatedMembersResponseDto {
  @ApiProperty({ type: [UserSummaryResponseDto] })
  data: UserSummaryResponseDto[];

  @ApiProperty({ example: 100 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;
}
