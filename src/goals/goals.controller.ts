import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ActiveSubscriptionGuard } from '../common/guards/active-subscription.guard';
import { AllowInactiveSubscription } from '../common/decorators/allow-inactive-subscription.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequiresFeature } from '../licensing/decorators/requires-feature.decorator';
import { GoalsService } from './goals.service';
import { CreateGoalDto } from './dto/create-goal.dto';
import { UpdateGoalDto } from './dto/update-goal.dto';
import { ListGoalsQueryDto } from './dto/list-goals-query.dto';
import {
  GoalMilestoneResponseDto,
  GoalPlanItemResponseDto,
  GoalProgressLogResponseDto,
  GoalResponseDto,
  GoalSummaryResponseDto,
  PaginatedGoalsResponseDto,
} from './dto/goal-response.dto';
import { CreateProgressLogDto } from './dto/create-progress-log.dto';
import {
  CreatePlanItemDto,
  UpdatePlanItemDto,
} from './dto/upsert-plan-item.dto';
import {
  CreateMilestoneDto,
  UpdateMilestoneDto,
} from './dto/upsert-milestone.dto';

@ApiTags('goals')
@ApiBearerAuth()
@RequiresFeature('goals')
@UseGuards(JwtAuthGuard, ActiveSubscriptionGuard, RolesGuard)
@Controller('goals')
export class GoalsController {
  constructor(private readonly goals: GoalsService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 5, ttl: 60 * 60 * 1000 } })
  @ApiResponse({ status: HttpStatus.ACCEPTED, type: GoalSummaryResponseDto })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description:
      'Onboarding not completed. Call POST /auth/me/onboarding first.',
  })
  create(@CurrentUser() user: { id: string }, @Body() dto: CreateGoalDto) {
    return this.goals.create(user.id, dto);
  }

  @Get()
  @AllowInactiveSubscription()
  @ApiOkResponse({ type: PaginatedGoalsResponseDto })
  list(@CurrentUser() user: { id: string }, @Query() query: ListGoalsQueryDto) {
    return this.goals.list(user.id, query);
  }

  @Get(':id')
  @AllowInactiveSubscription()
  @ApiOkResponse({ type: GoalResponseDto })
  findOne(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.goals.findOne(user.id, id);
  }

  @Patch(':id')
  @ApiOkResponse({ type: GoalSummaryResponseDto })
  update(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() dto: UpdateGoalDto,
  ) {
    return this.goals.update(user.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiResponse({ status: HttpStatus.NO_CONTENT })
  remove(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.goals.remove(user.id, id);
  }

  @Post(':id/retry-generation')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 5, ttl: 60 * 60 * 1000 } })
  @ApiResponse({ status: HttpStatus.ACCEPTED, type: GoalSummaryResponseDto })
  retry(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.goals.retryGeneration(user.id, id);
  }

  // ——— Progress logs ———
  @Post(':id/progress')
  @HttpCode(HttpStatus.CREATED)
  @ApiResponse({ status: HttpStatus.CREATED, type: GoalProgressLogResponseDto })
  addProgress(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() dto: CreateProgressLogDto,
  ) {
    return this.goals.addProgressLog(user.id, id, dto);
  }

  @Delete(':id/progress/:logId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiResponse({ status: HttpStatus.NO_CONTENT })
  removeProgress(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Param('logId') logId: string,
  ) {
    return this.goals.removeProgressLog(user.id, id, logId);
  }

  // ——— Plan items ———
  @Post(':id/plan-items')
  @HttpCode(HttpStatus.CREATED)
  @ApiResponse({ status: HttpStatus.CREATED, type: GoalPlanItemResponseDto })
  addPlanItem(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() dto: CreatePlanItemDto,
  ) {
    return this.goals.addPlanItem(user.id, id, dto);
  }

  @Patch(':id/plan-items/:itemId')
  @ApiOkResponse({ type: GoalPlanItemResponseDto })
  updatePlanItem(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdatePlanItemDto,
  ) {
    return this.goals.updatePlanItem(user.id, id, itemId, dto);
  }

  @Delete(':id/plan-items/:itemId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiResponse({ status: HttpStatus.NO_CONTENT })
  removePlanItem(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Param('itemId') itemId: string,
  ) {
    return this.goals.removePlanItem(user.id, id, itemId);
  }

  // ——— Milestones ———
  @Post(':id/milestones')
  @HttpCode(HttpStatus.CREATED)
  @ApiResponse({ status: HttpStatus.CREATED, type: GoalMilestoneResponseDto })
  addMilestone(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() dto: CreateMilestoneDto,
  ) {
    return this.goals.addMilestone(user.id, id, dto);
  }

  @Patch(':id/milestones/:milestoneId')
  @ApiOkResponse({ type: GoalMilestoneResponseDto })
  updateMilestone(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Param('milestoneId') milestoneId: string,
    @Body() dto: UpdateMilestoneDto,
  ) {
    return this.goals.updateMilestone(user.id, id, milestoneId, dto);
  }

  @Delete(':id/milestones/:milestoneId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiResponse({ status: HttpStatus.NO_CONTENT })
  removeMilestone(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Param('milestoneId') milestoneId: string,
  ) {
    return this.goals.removeMilestone(user.id, id, milestoneId);
  }
}
