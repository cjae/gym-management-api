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
} from '@nestjs/swagger';
import { SubscriptionPlansService } from './subscription-plans.service';
import { CreatePlanDto } from './dto/create-plan.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';
import { SubscriptionPlanResponseDto } from './dto/subscription-plan-response.dto';
import { PaginatedPlansResponseDto } from './dto/paginated-plans-response.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';

@ApiTags('Subscription Plans')
@ApiBearerAuth()
@Controller('subscription-plans')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SubscriptionPlansController {
  constructor(private readonly plansService: SubscriptionPlansService) {}

  @Post()
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiCreatedResponse({ type: SubscriptionPlanResponseDto })
  create(@Body() dto: CreatePlanDto) {
    return this.plansService.create(dto);
  }

  @Get()
  @ApiOkResponse({
    type: [SubscriptionPlanResponseDto],
    description: 'Active plans only',
  })
  findActive() {
    return this.plansService.findActive();
  }

  @Get('all')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOkResponse({ type: PaginatedPlansResponseDto })
  findAll(@Query() query: PaginationQueryDto) {
    return this.plansService.findAll(query.page, query.limit);
  }

  @Get(':id')
  @ApiOkResponse({ type: SubscriptionPlanResponseDto })
  @ApiNotFoundResponse({ description: 'Plan not found' })
  findOne(@Param('id') id: string) {
    return this.plansService.findOne(id);
  }

  @Patch(':id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOkResponse({ type: SubscriptionPlanResponseDto })
  @ApiNotFoundResponse({ description: 'Plan not found' })
  update(@Param('id') id: string, @Body() dto: UpdatePlanDto) {
    return this.plansService.update(id, dto);
  }

  @Delete(':id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOkResponse({ type: SubscriptionPlanResponseDto })
  @ApiNotFoundResponse({ description: 'Plan not found' })
  remove(@Param('id') id: string) {
    return this.plansService.remove(id);
  }
}
