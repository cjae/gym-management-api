import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
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
  ApiConflictResponse,
} from '@nestjs/swagger';
import { GymClassesService } from './gym-classes.service';
import { CreateGymClassDto } from './dto/create-gym-class.dto';
import { UpdateGymClassDto } from './dto/update-gym-class.dto';
import {
  GymClassResponseDto,
  PaginatedGymClassesResponseDto,
} from './dto/gym-class-response.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';

@ApiTags('Gym Classes')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid JWT' })
@Controller('gym-classes')
@UseGuards(JwtAuthGuard)
export class GymClassesController {
  constructor(private readonly gymClassesService: GymClassesService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiCreatedResponse({ type: GymClassResponseDto })
  @ApiConflictResponse({ description: 'Time overlaps with existing class' })
  create(@Body() dto: CreateGymClassDto) {
    return this.gymClassesService.create(dto);
  }

  @Get()
  @ApiOkResponse({ type: PaginatedGymClassesResponseDto })
  findAll(@Query() query: PaginationQueryDto) {
    return this.gymClassesService.findAll(query.page, query.limit);
  }

  @Get('my')
  @ApiOkResponse({
    description: 'Classes the authenticated member is enrolled in',
  })
  getMyClasses(@CurrentUser('id') memberId: string) {
    return this.gymClassesService.getMyClasses(memberId);
  }

  @Get(':id')
  @ApiOkResponse({ type: GymClassResponseDto })
  @ApiNotFoundResponse({ description: 'Class not found' })
  findOne(@Param('id') id: string) {
    return this.gymClassesService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOkResponse({ type: GymClassResponseDto })
  @ApiNotFoundResponse({ description: 'Class not found' })
  @ApiConflictResponse({ description: 'Time overlaps with existing class' })
  update(@Param('id') id: string, @Body() dto: UpdateGymClassDto) {
    return this.gymClassesService.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOkResponse({ description: 'Class deactivated' })
  @ApiNotFoundResponse({ description: 'Class not found' })
  remove(@Param('id') id: string) {
    return this.gymClassesService.remove(id);
  }

  @Post(':id/enroll')
  @UseGuards(RolesGuard)
  @Roles('MEMBER')
  @ApiCreatedResponse({ description: 'Enrolled in class' })
  @ApiNotFoundResponse({ description: 'Class not found or inactive' })
  enroll(@Param('id') classId: string, @CurrentUser('id') memberId: string) {
    return this.gymClassesService.enroll(classId, memberId);
  }

  @Post(':id/unenroll')
  @UseGuards(RolesGuard)
  @Roles('MEMBER')
  @ApiOkResponse({ description: 'Unenrolled from class' })
  unenroll(@Param('id') classId: string, @CurrentUser('id') memberId: string) {
    return this.gymClassesService.unenroll(classId, memberId);
  }

  @Get(':id/enrollments')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOkResponse({ description: 'List of enrolled members' })
  getEnrollments(@Param('id') classId: string) {
    return this.gymClassesService.getEnrollments(classId);
  }
}
