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
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiBadRequestResponse,
} from '@nestjs/swagger';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersQueryDto } from './dto/users-query.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { UserProfileResponseDto } from './dto/user-profile-response.dto';
import { PaginatedUsersResponseDto } from './dto/paginated-users-response.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CreateUserDto } from './dto/create-user.dto';
import { DeletionRequestsQueryDto } from './dto/deletion-requests-query.dto';
import { RejectDeletionRequestDto } from './dto/reject-deletion-request.dto';
import { PaginatedDeletionRequestsResponseDto } from '../auth/dto/deletion-request-response.dto';
import { MessageResponseDto } from '../common/dto/message-response.dto';

@ApiTags('Users')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid JWT' })
@ApiForbiddenResponse({ description: 'Requires ADMIN or SUPER_ADMIN role' })
@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'SUPER_ADMIN')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @ApiCreatedResponse({
    type: UserResponseDto,
    description: 'User created with temp password',
  })
  @ApiConflictResponse({ description: 'Email already registered' })
  create(@Body() dto: CreateUserDto, @CurrentUser('role') callerRole: string) {
    return this.usersService.create(dto, callerRole);
  }

  @Get()
  @ApiOkResponse({ type: PaginatedUsersResponseDto })
  findAll(@Query() query: UsersQueryDto) {
    return this.usersService.findAll(
      query.page,
      query.limit,
      query.role,
      query.search,
      query.tags,
    );
  }

  @Get('birthdays/today')
  @ApiOkResponse({
    type: [UserResponseDto],
    description: 'Users whose birthday is today',
  })
  findBirthdays() {
    return this.usersService.findBirthdays();
  }

  @Get('deletion-requests')
  @ApiOkResponse({ type: PaginatedDeletionRequestsResponseDto })
  findAllDeletionRequests(@Query() query: DeletionRequestsQueryDto) {
    return this.usersService.findAllDeletionRequests(
      query.page,
      query.limit,
      query.status,
    );
  }

  @Patch('deletion-requests/:id/approve')
  @ApiOkResponse({
    type: MessageResponseDto,
    description: 'Request approved, user soft-deleted',
  })
  @ApiNotFoundResponse({ description: 'Request not found' })
  @ApiBadRequestResponse({ description: 'Request is not pending' })
  approveDeletionRequest(
    @Param('id') id: string,
    @CurrentUser('id') reviewerId: string,
  ) {
    return this.usersService.approveDeletionRequest(id, reviewerId);
  }

  @Patch('deletion-requests/:id/reject')
  @ApiOkResponse({
    type: MessageResponseDto,
    description: 'Request rejected',
  })
  @ApiNotFoundResponse({ description: 'Request not found' })
  @ApiBadRequestResponse({ description: 'Request is not pending' })
  rejectDeletionRequest(
    @Param('id') id: string,
    @CurrentUser('id') reviewerId: string,
    @Body() dto: RejectDeletionRequestDto,
  ) {
    return this.usersService.rejectDeletionRequest(id, reviewerId, dto.reason);
  }

  @Get(':id/profile')
  @Roles('SUPER_ADMIN', 'ADMIN', 'TRAINER', 'MEMBER')
  @ApiOkResponse({ type: UserProfileResponseDto })
  @ApiNotFoundResponse({ description: 'User not found' })
  findProfile(@Param('id') id: string) {
    return this.usersService.findProfile(id);
  }

  @Get(':id')
  @ApiOkResponse({ type: UserResponseDto })
  @ApiNotFoundResponse({ description: 'User not found' })
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @Patch(':id')
  @ApiOkResponse({ type: UserResponseDto })
  @ApiNotFoundResponse({ description: 'User not found' })
  update(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.usersService.update(id, dto);
  }

  @Delete(':id')
  @Roles('SUPER_ADMIN')
  @ApiForbiddenResponse({ description: 'Requires SUPER_ADMIN role' })
  @ApiOkResponse({ type: UserResponseDto })
  @ApiNotFoundResponse({ description: 'User not found' })
  remove(@Param('id') id: string) {
    return this.usersService.remove(id);
  }
}
