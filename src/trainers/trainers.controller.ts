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
import { RequiresFeature } from '../licensing/decorators/requires-feature.decorator';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
} from '@nestjs/swagger';
import { TrainersService } from './trainers.service';
import { CreateTrainerProfileDto } from './dto/create-trainer-profile.dto';
import { UpdateTrainerProfileDto } from './dto/update-trainer-profile.dto';
import { AssignMemberDto } from './dto/assign-member.dto';
import { TrainerProfileResponseDto } from './dto/trainer-profile-response.dto';
import { TrainerAssignmentResponseDto } from './dto/trainer-assignment-response.dto';
import { MemberTrainerAssignmentResponseDto } from './dto/member-trainer-assignment-response.dto';
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
@RequiresFeature('trainer-management')
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
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN', 'TRAINER')
  @ApiOkResponse({ type: PaginatedTrainersResponseDto })
  @ApiForbiddenResponse({
    description: 'Members cannot list the trainer roster',
  })
  findAll(@Query() query: PaginationQueryDto) {
    return this.trainersService.findAll(query.page, query.limit);
  }

  @Get('my/trainer')
  @UseGuards(RolesGuard)
  @Roles('MEMBER')
  @ApiForbiddenResponse({
    description: 'Only members can look up their trainer',
  })
  @ApiOkResponse({ type: MemberTrainerAssignmentResponseDto })
  getMyTrainer(@CurrentUser('id') memberId: string) {
    return this.trainersService.getMemberTrainer(memberId);
  }

  @Get('user/:userId')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN', 'TRAINER')
  @ApiOkResponse({ type: TrainerProfileResponseDto })
  @ApiForbiddenResponse({
    description: 'Members cannot look up arbitrary trainers',
  })
  @ApiNotFoundResponse({
    description: 'Trainer profile not found for this user',
  })
  findByUserId(@Param('userId') userId: string) {
    return this.trainersService.findByUserId(userId);
  }

  @Get(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN', 'TRAINER')
  @ApiOkResponse({ type: TrainerProfileResponseDto })
  @ApiForbiddenResponse({
    description: 'Members cannot view arbitrary trainer profiles',
  })
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

  @Post('assign')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiCreatedResponse({ type: TrainerAssignmentResponseDto })
  assignMember(@Body() dto: AssignMemberDto) {
    return this.trainersService.assignMember(dto);
  }
}
