import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequiresFeature } from '../licensing/decorators/requires-feature.decorator';
import { MemberTagsService } from './member-tags.service';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { UserSummaryResponseDto } from '../common/dto/user-summary-response.dto';
import { CreateTagDto } from './dto/create-tag.dto';
import { UpdateTagDto } from './dto/update-tag.dto';
import { AssignTagDto } from './dto/assign-tag.dto';
import { TagQueryDto } from './dto/tag-query.dto';
import {
  TagResponseDto,
  TagWithCountResponseDto,
} from './dto/tag-response.dto';

@ApiTags('Member Tags')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid JWT' })
@ApiForbiddenResponse({ description: 'Requires ADMIN or SUPER_ADMIN role' })
@RequiresFeature('member-tags')
@Controller('tags')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'SUPER_ADMIN')
export class MemberTagsController {
  constructor(private readonly memberTagsService: MemberTagsService) {}

  @Get()
  @ApiOkResponse({ type: [TagResponseDto] })
  findAll(@Query() query: TagQueryDto) {
    return this.memberTagsService.findAll(query.source);
  }

  @Get('summary')
  @ApiOkResponse({ type: [TagWithCountResponseDto] })
  getSummary() {
    return this.memberTagsService.getSummary();
  }

  @Post()
  @ApiCreatedResponse({ type: TagResponseDto })
  @ApiConflictResponse({ description: 'Tag name already exists' })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  create(@Body() dto: CreateTagDto) {
    return this.memberTagsService.create(dto);
  }

  @Patch(':id')
  @ApiOkResponse({ type: TagResponseDto })
  @ApiNotFoundResponse({ description: 'Tag not found' })
  @ApiBadRequestResponse({ description: 'Cannot update SYSTEM tags' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTagDto) {
    return this.memberTagsService.update(id, dto);
  }

  @Delete(':id')
  @Roles('SUPER_ADMIN')
  @ApiOkResponse({ type: TagResponseDto })
  @ApiNotFoundResponse({ description: 'Tag not found' })
  @ApiBadRequestResponse({ description: 'Cannot delete SYSTEM tags' })
  delete(@Param('id', ParseUUIDPipe) id: string) {
    return this.memberTagsService.delete(id);
  }

  @Get(':tagId/members')
  @ApiOkResponse({ type: [UserSummaryResponseDto] })
  @ApiNotFoundResponse({ description: 'Tag not found' })
  findMembersByTag(
    @Param('tagId', ParseUUIDPipe) tagId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.memberTagsService.findMembersByTag(
      tagId,
      query.page,
      query.limit,
    );
  }

  @Post(':tagId/members')
  @ApiCreatedResponse({ description: 'Tag assigned to members' })
  @ApiNotFoundResponse({ description: 'Tag not found' })
  @ApiBadRequestResponse({
    description: 'Cannot assign SYSTEM tags or no valid member IDs',
  })
  assignTag(
    @Param('tagId', ParseUUIDPipe) tagId: string,
    @Body() dto: AssignTagDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.memberTagsService.assignTag(tagId, dto.memberIds, userId);
  }

  @Delete(':tagId/members/:memberId')
  @ApiOkResponse({ description: 'Tag removed from member' })
  @ApiNotFoundResponse({ description: 'Tag not found' })
  removeTag(
    @Param('tagId', ParseUUIDPipe) tagId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
  ) {
    return this.memberTagsService.removeTag(tagId, memberId);
  }
}
