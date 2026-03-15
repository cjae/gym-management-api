import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOkResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ReferralsService } from './referrals.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import {
  ReferralCodeResponseDto,
  PaginatedReferralsResponseDto,
} from './dto/referral-response.dto';
import { ReferralStatsResponseDto } from './dto/referral-stats-response.dto';

@ApiTags('Referrals')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid JWT' })
@Controller('referrals')
@UseGuards(JwtAuthGuard)
export class ReferralsController {
  constructor(private readonly referralsService: ReferralsService) {}

  @Get('my-code')
  @ApiOkResponse({ type: ReferralCodeResponseDto })
  getMyCode(@CurrentUser() user: { id: string }) {
    return this.referralsService.getMyCode(user.id);
  }

  @Get('my-referrals')
  @ApiOkResponse({ type: PaginatedReferralsResponseDto })
  getMyReferrals(
    @CurrentUser() user: { id: string },
    @Query() query: PaginationQueryDto,
  ) {
    return this.referralsService.getMyReferrals(
      user.id,
      query.page,
      query.limit,
    );
  }

  @Get('stats')
  @ApiOkResponse({ type: ReferralStatsResponseDto })
  getStats(@CurrentUser() user: { id: string }) {
    return this.referralsService.getStats(user.id);
  }
}
