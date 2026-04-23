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
import { CreateShopItemVariantDto } from './dto/create-shop-item-variant.dto';
import { UpdateShopItemVariantDto } from './dto/update-shop-item-variant.dto';
import {
  ShopItemResponseDto,
  ShopItemVariantResponseDto,
  PaginatedShopItemsResponseDto,
} from './dto/shop-item-response.dto';
import { CreateShopOrderDto } from './dto/create-shop-order.dto';
import { AdminCreateShopOrderDto } from './dto/admin-create-shop-order.dto';
import { FilterShopOrdersDto } from './dto/filter-shop-orders.dto';
import {
  ShopOrderResponseDto,
  CreateShopOrderResponseDto,
  PaginatedShopOrdersResponseDto,
} from './dto/shop-order-response.dto';

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

  // ── Item Variants ──

  @Post('items/:id/variants')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiCreatedResponse({ type: ShopItemVariantResponseDto })
  addVariant(
    @Param('id', ParseUUIDPipe) itemId: string,
    @Body() dto: CreateShopItemVariantDto,
  ) {
    return this.shopService.addVariant(itemId, dto);
  }

  @Patch('items/:id/variants/:vid')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOkResponse({ type: ShopItemVariantResponseDto })
  updateVariant(
    @Param('id', ParseUUIDPipe) itemId: string,
    @Param('vid', ParseUUIDPipe) variantId: string,
    @Body() dto: UpdateShopItemVariantDto,
  ) {
    return this.shopService.updateVariant(itemId, variantId, dto);
  }

  @Delete('items/:id/variants/:vid')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN')
  @ApiOkResponse({ description: 'Variant deleted' })
  removeVariant(
    @Param('id', ParseUUIDPipe) itemId: string,
    @Param('vid', ParseUUIDPipe) variantId: string,
  ) {
    return this.shopService.removeVariant(itemId, variantId);
  }

  // ── Orders ──

  @Post('orders')
  @UseGuards(RolesGuard)
  @Roles('MEMBER')
  @ApiCreatedResponse({ type: CreateShopOrderResponseDto })
  createOrder(
    @Body() dto: CreateShopOrderDto,
    @CurrentUser('id') memberId: string,
    @CurrentUser('email') email: string,
  ) {
    return this.shopService.createOrder(memberId, email, dto);
  }

  // ── Admin Orders ──

  @Post('orders/admin')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiCreatedResponse({ type: ShopOrderResponseDto })
  createAdminOrder(@Body() dto: AdminCreateShopOrderDto) {
    return this.shopService.createAdminOrder(dto);
  }

  @Get('orders')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOkResponse({ type: PaginatedShopOrdersResponseDto })
  findAllOrders(@Query() dto: FilterShopOrdersDto) {
    return this.shopService.findAllOrders(dto);
  }

  @Patch('orders/:id/collect')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOkResponse({ type: ShopOrderResponseDto })
  @ApiNotFoundResponse({ description: 'Order not found' })
  collectOrder(@Param('id', ParseUUIDPipe) id: string) {
    return this.shopService.collectOrder(id);
  }
}
