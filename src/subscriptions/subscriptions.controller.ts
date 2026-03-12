import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiForbiddenResponse,
  ApiBadRequestResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { SubscriptionsService } from './subscriptions.service';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { AdminCreateSubscriptionDto } from './dto/admin-create-subscription.dto';
import { AddDuoMemberDto } from './dto/add-duo-member.dto';
import { FreezeSubscriptionDto } from './dto/freeze-subscription.dto';
import { SubscriptionResponseDto } from './dto/subscription-response.dto';
import { SubscriptionMemberResponseDto } from './dto/subscription-member-response.dto';
import { PaginatedSubscriptionsResponseDto } from './dto/paginated-subscriptions-response.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';

@ApiTags('Subscriptions')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid JWT' })
@Controller('subscriptions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @Post()
  @ApiCreatedResponse({ type: SubscriptionResponseDto })
  create(
    @CurrentUser('id') memberId: string,
    @Body() dto: CreateSubscriptionDto,
  ) {
    return this.subscriptionsService.create(memberId, dto);
  }

  @Post('admin')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiCreatedResponse({ type: SubscriptionResponseDto })
  @ApiForbiddenResponse({ description: 'Requires ADMIN or SUPER_ADMIN role' })
  @ApiBadRequestResponse({
    description:
      'Invalid member, plan, or member already has active subscription',
  })
  @ApiNotFoundResponse({ description: 'Member or plan not found' })
  adminCreate(
    @CurrentUser('id') adminId: string,
    @Body() dto: AdminCreateSubscriptionDto,
  ) {
    return this.subscriptionsService.adminCreate(adminId, dto);
  }

  @Post(':id/duo')
  @ApiCreatedResponse({ type: SubscriptionMemberResponseDto })
  @ApiNotFoundResponse({ description: 'Subscription or user not found' })
  @ApiForbiddenResponse({ description: 'Not subscription owner' })
  @ApiBadRequestResponse({ description: 'Plan max members exceeded' })
  addDuoMember(
    @Param('id') id: string,
    @Body() dto: AddDuoMemberDto,
    @CurrentUser('id') requesterId: string,
  ) {
    return this.subscriptionsService.addDuoMember(
      id,
      dto.memberEmail,
      requesterId,
    );
  }

  @Get('my')
  @ApiOkResponse({ type: [SubscriptionResponseDto] })
  findMySubscriptions(@CurrentUser('id') memberId: string) {
    return this.subscriptionsService.findByMember(memberId);
  }

  @Get()
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiForbiddenResponse({ description: 'Requires ADMIN or SUPER_ADMIN role' })
  @ApiOkResponse({ type: PaginatedSubscriptionsResponseDto })
  findAll(@Query() query: PaginationQueryDto) {
    return this.subscriptionsService.findAll(query.page, query.limit);
  }

  @Get(':id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOkResponse({ type: SubscriptionResponseDto })
  @ApiNotFoundResponse({ description: 'Subscription not found' })
  @ApiForbiddenResponse({ description: 'Requires ADMIN or SUPER_ADMIN role' })
  findOne(@Param('id') id: string) {
    return this.subscriptionsService.findOne(id);
  }

  @Patch(':id/cancel')
  @ApiOkResponse({ type: SubscriptionResponseDto })
  @ApiNotFoundResponse({ description: 'Subscription not found' })
  @ApiForbiddenResponse({ description: 'Not subscription owner or admin' })
  cancel(
    @Param('id') id: string,
    @CurrentUser('id') requesterId: string,
    @CurrentUser('role') requesterRole: string,
  ) {
    return this.subscriptionsService.cancel(id, requesterId, requesterRole);
  }

  @Patch(':id/freeze')
  @ApiOkResponse({ type: SubscriptionResponseDto })
  @ApiNotFoundResponse({ description: 'Subscription not found' })
  @ApiForbiddenResponse({ description: 'Not subscription owner or admin' })
  @ApiBadRequestResponse({ description: 'Cannot freeze this subscription' })
  freeze(
    @Param('id') id: string,
    @Body() dto: FreezeSubscriptionDto,
    @CurrentUser('id') requesterId: string,
    @CurrentUser('role') requesterRole: string,
  ) {
    return this.subscriptionsService.freeze(
      id,
      requesterId,
      requesterRole,
      dto.days,
    );
  }

  @Patch(':id/unfreeze')
  @ApiOkResponse({ type: SubscriptionResponseDto })
  @ApiNotFoundResponse({ description: 'Subscription not found' })
  @ApiForbiddenResponse({ description: 'Not subscription owner or admin' })
  @ApiBadRequestResponse({ description: 'Subscription is not frozen' })
  unfreeze(
    @Param('id') id: string,
    @CurrentUser('id') requesterId: string,
    @CurrentUser('role') requesterRole: string,
  ) {
    return this.subscriptionsService.unfreeze(id, requesterId, requesterRole);
  }
}
