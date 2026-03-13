import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
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
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { MessageResponseDto } from '../common/dto/message-response.dto';
import { BannersService } from './banners.service';
import { CreateBannerDto } from './dto/create-banner.dto';
import { UpdateBannerDto } from './dto/update-banner.dto';
import { CreateBannerInteractionDto } from './dto/create-banner-interaction.dto';
import {
  ActiveBannerResponseDto,
  BannerListItemDto,
  PaginatedBannersResponseDto,
} from './dto/banner-response.dto';
import { BannerAnalyticsResponseDto } from './dto/banner-analytics-response.dto';

@ApiTags('Banners')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid JWT' })
@Controller('banners')
@UseGuards(JwtAuthGuard)
export class BannersController {
  constructor(private readonly bannersService: BannersService) {}

  // --- Admin endpoints ---

  @Post()
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiCreatedResponse({
    description: 'Banner created',
    type: BannerListItemDto,
  })
  @ApiForbiddenResponse({ description: 'Requires ADMIN or SUPER_ADMIN role' })
  create(@Body() dto: CreateBannerDto, @CurrentUser('id') userId: string) {
    return this.bannersService.create(dto, userId);
  }

  @Get()
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOkResponse({ type: PaginatedBannersResponseDto })
  @ApiForbiddenResponse({ description: 'Requires ADMIN or SUPER_ADMIN role' })
  findAll(@Query() query: PaginationQueryDto) {
    return this.bannersService.findAll(query.page, query.limit);
  }

  // NOTE: /active must come before /:id to avoid route conflicts
  @Get('active')
  @ApiOkResponse({
    description: 'Active banners for carousel display',
    type: [ActiveBannerResponseDto],
  })
  findActive() {
    return this.bannersService.findActive();
  }

  @Get(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOkResponse({ type: BannerListItemDto })
  @ApiNotFoundResponse({ description: 'Banner not found' })
  @ApiForbiddenResponse({ description: 'Requires ADMIN or SUPER_ADMIN role' })
  findOne(@Param('id') id: string) {
    return this.bannersService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOkResponse({ type: BannerListItemDto })
  @ApiNotFoundResponse({ description: 'Banner not found' })
  @ApiForbiddenResponse({ description: 'Requires ADMIN or SUPER_ADMIN role' })
  update(@Param('id') id: string, @Body() dto: UpdateBannerDto) {
    return this.bannersService.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOkResponse({
    description: 'Banner soft-deleted',
    type: MessageResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Banner not found' })
  @ApiForbiddenResponse({ description: 'Requires ADMIN or SUPER_ADMIN role' })
  async remove(@Param('id') id: string) {
    await this.bannersService.softDelete(id);
    return { message: 'Banner deleted successfully' };
  }

  @Get(':id/analytics')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOkResponse({ type: BannerAnalyticsResponseDto })
  @ApiNotFoundResponse({ description: 'Banner not found' })
  @ApiForbiddenResponse({ description: 'Requires ADMIN or SUPER_ADMIN role' })
  getAnalytics(@Param('id') id: string) {
    return this.bannersService.getAnalytics(id);
  }

  // --- Mobile endpoints ---

  @Post(':id/interactions')
  @ApiCreatedResponse({ description: 'Interaction logged' })
  @ApiNotFoundResponse({ description: 'Banner not found' })
  logInteraction(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateBannerInteractionDto,
  ) {
    return this.bannersService.logInteraction(id, userId, dto.type);
  }
}
