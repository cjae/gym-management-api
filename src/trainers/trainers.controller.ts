import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiUnauthorizedResponse,
  ApiNotFoundResponse,
} from '@nestjs/swagger';
import { TrainersService } from './trainers.service';
import { CreateTrainerProfileDto } from './dto/create-trainer-profile.dto';
import { UpdateTrainerProfileDto } from './dto/update-trainer-profile.dto';
import { CreateScheduleDto } from './dto/create-schedule.dto';
import { AssignMemberDto } from './dto/assign-member.dto';
import { TrainerProfileResponseDto } from './dto/trainer-profile-response.dto';
import { TrainerScheduleResponseDto } from './dto/trainer-schedule-response.dto';
import { TrainerAssignmentResponseDto } from './dto/trainer-assignment-response.dto';
import { PaginatedTrainersResponseDto } from './dto/paginated-trainers-response.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';

@ApiTags('Trainers')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid JWT' })
@Controller('trainers')
@UseGuards(JwtAuthGuard)
export class TrainersController {
  constructor(private readonly trainersService: TrainersService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiCreatedResponse({ type: TrainerProfileResponseDto })
  createProfile(@Body() dto: CreateTrainerProfileDto) {
    return this.trainersService.createProfile(dto);
  }

  @Get()
  @ApiOkResponse({ type: PaginatedTrainersResponseDto })
  findAll(@Query() query: PaginationQueryDto) {
    return this.trainersService.findAll(query.page, query.limit);
  }

  @Get('my/trainer')
  @ApiOkResponse({ type: TrainerAssignmentResponseDto })
  getMyTrainer(@CurrentUser('id') memberId: string) {
    return this.trainersService.getMemberTrainer(memberId);
  }

  @Get('schedules')
  @ApiOkResponse({ type: [TrainerScheduleResponseDto] })
  getAllSchedules() {
    return this.trainersService.getAllSchedules();
  }

  @Get('user/:userId')
  @ApiOkResponse({ type: TrainerProfileResponseDto })
  @ApiNotFoundResponse({
    description: 'Trainer profile not found for this user',
  })
  findByUserId(@Param('userId') userId: string) {
    return this.trainersService.findByUserId(userId);
  }

  @Get(':id')
  @ApiOkResponse({ type: TrainerProfileResponseDto })
  @ApiNotFoundResponse({ description: 'Trainer not found' })
  findOne(@Param('id') id: string) {
    return this.trainersService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOkResponse({ type: TrainerProfileResponseDto })
  @ApiNotFoundResponse({ description: 'Trainer not found' })
  updateProfile(@Param('id') id: string, @Body() dto: UpdateTrainerProfileDto) {
    return this.trainersService.updateProfile(id, dto);
  }

  @Post(':id/schedules')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiCreatedResponse({ type: TrainerScheduleResponseDto })
  addSchedule(@Param('id') trainerId: string, @Body() dto: CreateScheduleDto) {
    return this.trainersService.addSchedule(trainerId, dto);
  }

  @Get(':id/schedules')
  @ApiOkResponse({ type: [TrainerScheduleResponseDto] })
  getSchedules(@Param('id') trainerId: string) {
    return this.trainersService.getSchedules(trainerId);
  }

  @Post('assign')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiCreatedResponse({ type: TrainerAssignmentResponseDto })
  assignMember(@Body() dto: AssignMemberDto) {
    return this.trainersService.assignMember(dto);
  }
}
