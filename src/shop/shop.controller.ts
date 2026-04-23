import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiUnauthorizedResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiNotFoundResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequiresFeature } from '../licensing/decorators/requires-feature.decorator';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { ShopService } from './shop.service';
import { CreateShopItemDto } from './dto/create-shop-item.dto';
import { UpdateShopItemDto } from './dto/update-shop-item.dto';
import {
  ShopItemResponseDto,
  PaginatedShopItemsResponseDto,
} from './dto/shop-item-response.dto';

@ApiTags('Shop')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid JWT' })
@RequiresFeature('shop')
@Controller('shop')
@UseGuards(JwtAuthGuard)
export class ShopController {
  constructor(private readonly shopService: ShopService) {}

  // ── Items ──

  @Post('items')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiCreatedResponse({ type: ShopItemResponseDto })
  createItem(@Body() dto: CreateShopItemDto) {
    return this.shopService.createItem(dto);
  }

  @Get('items')
  @ApiOkResponse({ type: PaginatedShopItemsResponseDto })
  findAllItems(
    @Query() query: PaginationQueryDto,
    @CurrentUser('role') role: string,
  ) {
    const memberOnly = role === 'MEMBER';
    return this.shopService.findAllItems(query.page, query.limit, memberOnly);
  }

  @Get('items/:id')
  @ApiOkResponse({ type: ShopItemResponseDto })
  @ApiNotFoundResponse({ description: 'Shop item not found' })
  findOneItem(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('role') role: string,
  ) {
    const memberOnly = role === 'MEMBER';
    return this.shopService.findOneItem(id, memberOnly);
  }

  @Patch('items/:id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOkResponse({ type: ShopItemResponseDto })
  @ApiNotFoundResponse({ description: 'Shop item not found' })
  updateItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateShopItemDto,
  ) {
    return this.shopService.updateItem(id, dto);
  }

  @Delete('items/:id')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN')
  @ApiOkResponse({ description: 'Item deleted' })
  @ApiNotFoundResponse({ description: 'Shop item not found' })
  removeItem(@Param('id', ParseUUIDPipe) id: string) {
    return this.shopService.removeItem(id);
  }
}
