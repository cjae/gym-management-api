import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOkResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
} from '@nestjs/swagger';
import { ReferralsService } from './referrals.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
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
@ApiForbiddenResponse({ description: 'Only members can access referrals' })
@Controller('referrals')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('MEMBER')
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
