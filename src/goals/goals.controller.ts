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
  ApiCreatedResponse,
  ApiOkResponse,
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
  GoalResponseDto,
  PaginatedGoalsResponseDto,
} from './dto/goal-response.dto';

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
  @ApiCreatedResponse({ type: GoalResponseDto })
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
  @ApiOkResponse({ type: GoalResponseDto })
  update(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() dto: UpdateGoalDto,
  ) {
    return this.goals.update(user.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.goals.remove(user.id, id);
  }
}
