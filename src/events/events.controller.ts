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
  ApiBadRequestResponse,
} from '@nestjs/swagger';
import { EventsService } from './events.service';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import {
  EventResponseDto,
  PaginatedEventsResponseDto,
} from './dto/event-response.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';

@ApiTags('Events')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid JWT' })
@Controller('events')
@UseGuards(JwtAuthGuard)
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiCreatedResponse({ type: EventResponseDto })
  create(@Body() dto: CreateEventDto) {
    return this.eventsService.create(dto);
  }

  @Get()
  @ApiOkResponse({ type: PaginatedEventsResponseDto })
  findAll(@Query() query: PaginationQueryDto) {
    return this.eventsService.findAll(query.page, query.limit);
  }

  @Get('my')
  @ApiOkResponse({
    description: 'Events the authenticated member is enrolled in',
  })
  getMyEvents(
    @CurrentUser('id') memberId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.eventsService.getMyEvents(memberId, query.page, query.limit);
  }

  @Get(':id')
  @ApiOkResponse({ type: EventResponseDto })
  @ApiNotFoundResponse({ description: 'Event not found' })
  findOne(
    @Param('id') id: string,
    @CurrentUser('role') role: string,
  ) {
    const includeEnrollments = role === 'ADMIN' || role === 'SUPER_ADMIN';
    return this.eventsService.findOne(id, includeEnrollments);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOkResponse({ type: EventResponseDto })
  @ApiNotFoundResponse({ description: 'Event not found' })
  update(@Param('id') id: string, @Body() dto: UpdateEventDto) {
    return this.eventsService.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOkResponse({ description: 'Event deactivated' })
  @ApiNotFoundResponse({ description: 'Event not found' })
  remove(@Param('id') id: string) {
    return this.eventsService.remove(id);
  }

  @Post(':id/enroll')
  @UseGuards(RolesGuard)
  @Roles('MEMBER')
  @ApiCreatedResponse({ description: 'Enrolled in event' })
  @ApiNotFoundResponse({ description: 'Event not found or inactive' })
  @ApiConflictResponse({ description: 'Event is full' })
  @ApiBadRequestResponse({ description: 'Cannot enroll in past event' })
  enroll(@Param('id') eventId: string, @CurrentUser('id') memberId: string) {
    return this.eventsService.enroll(eventId, memberId);
  }

  @Post(':id/unenroll')
  @UseGuards(RolesGuard)
  @Roles('MEMBER')
  @ApiOkResponse({ description: 'Unenrolled from event' })
  @ApiBadRequestResponse({ description: 'Cannot unenroll from past event' })
  unenroll(
    @Param('id') eventId: string,
    @CurrentUser('id') memberId: string,
  ) {
    return this.eventsService.unenroll(eventId, memberId);
  }

  @Get(':id/enrollments')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOkResponse({ description: 'List of enrolled members' })
  getEnrollments(@Param('id') eventId: string) {
    return this.eventsService.getEnrollments(eventId);
  }
}
