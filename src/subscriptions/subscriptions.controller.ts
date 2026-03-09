import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
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
} from '@nestjs/swagger';
import { SubscriptionsService } from './subscriptions.service';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { AddDuoMemberDto } from './dto/add-duo-member.dto';
import { SubscriptionResponseDto } from './dto/subscription-response.dto';
import { SubscriptionMemberResponseDto } from './dto/subscription-member-response.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Subscriptions')
@ApiBearerAuth()
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
  @ApiOkResponse({ type: [SubscriptionResponseDto] })
  findAll() {
    return this.subscriptionsService.findAll();
  }

  @Patch(':id/cancel')
  @ApiOkResponse({ type: SubscriptionResponseDto })
  @ApiNotFoundResponse({ description: 'Subscription not found' })
  @ApiForbiddenResponse({ description: 'Not subscription owner' })
  cancel(@Param('id') id: string, @CurrentUser('id') requesterId: string) {
    return this.subscriptionsService.cancel(id, requesterId);
  }
}
