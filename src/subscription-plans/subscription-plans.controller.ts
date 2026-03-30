import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
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
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
} from '@nestjs/swagger';
import { SubscriptionPlansService } from './subscription-plans.service';
import { CreatePlanDto } from './dto/create-plan.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';
import { SubscriptionPlanResponseDto } from './dto/subscription-plan-response.dto';
import { PaginatedPlansResponseDto } from './dto/paginated-plans-response.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  PlansSortQueryDto,
  PaginatedPlansSortQueryDto,
} from './dto/plans-query.dto';

@ApiTags('Subscription Plans')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid JWT' })
@ApiForbiddenResponse({
  description: 'Insufficient role for restricted endpoints',
})
@Controller('subscription-plans')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SubscriptionPlansController {
  constructor(private readonly plansService: SubscriptionPlansService) {}

  @Post()
  @Roles('SUPER_ADMIN')
  @ApiCreatedResponse({ type: SubscriptionPlanResponseDto })
  create(@Body() dto: CreatePlanDto) {
    return this.plansService.create(dto);
  }

  @Get()
  @ApiOkResponse({
    type: [SubscriptionPlanResponseDto],
    description: 'Active plans only',
  })
  findActive(@Query() query: PlansSortQueryDto) {
    return this.plansService.findActive(query.sortBy, query.sortOrder);
  }

  @Get('all')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOkResponse({ type: PaginatedPlansResponseDto })
  findAll(@Query() query: PaginatedPlansSortQueryDto) {
    return this.plansService.findAll(
      query.page,
      query.limit,
      query.sortBy,
      query.sortOrder,
    );
  }

  @Get(':id')
  @ApiOkResponse({ type: SubscriptionPlanResponseDto })
  @ApiNotFoundResponse({ description: 'Plan not found' })
  findOne(@Param('id') id: string) {
    return this.plansService.findOne(id);
  }

  @Patch(':id')
  @Roles('SUPER_ADMIN')
  @ApiOkResponse({ type: SubscriptionPlanResponseDto })
  @ApiNotFoundResponse({ description: 'Plan not found' })
  update(@Param('id') id: string, @Body() dto: UpdatePlanDto) {
    return this.plansService.update(id, dto);
  }

  @Delete(':id')
  @Roles('SUPER_ADMIN')
  @ApiOkResponse({ type: SubscriptionPlanResponseDto })
  @ApiNotFoundResponse({ description: 'Plan not found' })
  remove(@Param('id') id: string) {
    return this.plansService.remove(id);
  }
}
