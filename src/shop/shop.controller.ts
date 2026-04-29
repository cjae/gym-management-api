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
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiOperation,
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
import { AnalyticsQueryDto } from '../analytics/dto/analytics-query.dto';
import {
  ShopAnalyticsResponseDto,
  ShopRevenueTrendsResponseDto,
} from './dto/shop-analytics-response.dto';

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
  @ApiBadRequestResponse({ description: 'Invalid input' })
  @ApiForbiddenResponse({ description: 'Requires ADMIN or SUPER_ADMIN role' })
  createItem(@Body() dto: CreateShopItemDto) {
    return this.shopService.createItem(dto);
  }

  @Get('items')
  @ApiOkResponse({ type: PaginatedShopItemsResponseDto })
  findAllItems(
    @Query() query: PaginationQueryDto,
    @CurrentUser('role') role: string,
  ) {
    const memberOnly = role !== 'ADMIN' && role !== 'SUPER_ADMIN';
    return this.shopService.findAllItems(query.page, query.limit, memberOnly);
  }

  @Get('items/:id')
  @ApiOkResponse({ type: ShopItemResponseDto })
  @ApiNotFoundResponse({ description: 'Shop item not found' })
  findOneItem(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('role') role: string,
  ) {
    const memberOnly = role !== 'ADMIN' && role !== 'SUPER_ADMIN';
    return this.shopService.findOneItem(id, memberOnly);
  }

  @Patch('items/:id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOkResponse({ type: ShopItemResponseDto })
  @ApiNotFoundResponse({ description: 'Shop item not found' })
  @ApiForbiddenResponse({ description: 'Requires ADMIN or SUPER_ADMIN role' })
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
  @ApiConflictResponse({
    description: 'Cannot delete item with existing orders',
  })
  @ApiForbiddenResponse({ description: 'Requires SUPER_ADMIN role' })
  removeItem(@Param('id', ParseUUIDPipe) id: string) {
    return this.shopService.removeItem(id);
  }

  // ── Item Variants ──

  @Post('items/:id/variants')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiCreatedResponse({ type: ShopItemVariantResponseDto })
  @ApiNotFoundResponse({ description: 'Shop item not found' })
  @ApiForbiddenResponse({ description: 'Requires ADMIN or SUPER_ADMIN role' })
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
  @ApiNotFoundResponse({ description: 'Variant not found' })
  @ApiForbiddenResponse({ description: 'Requires ADMIN or SUPER_ADMIN role' })
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
  @ApiNotFoundResponse({ description: 'Variant not found' })
  @ApiConflictResponse({
    description: 'Cannot delete variant with existing orders',
  })
  @ApiForbiddenResponse({ description: 'Requires SUPER_ADMIN role' })
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
  @ApiBadRequestResponse({
    description: 'Item not found or payment initialization failed',
  })
  @ApiConflictResponse({ description: 'Insufficient stock' })
  @ApiForbiddenResponse({ description: 'Requires MEMBER role' })
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
  @ApiBadRequestResponse({ description: 'Item not found or member not found' })
  @ApiConflictResponse({ description: 'Insufficient stock' })
  @ApiForbiddenResponse({ description: 'Requires ADMIN or SUPER_ADMIN role' })
  createAdminOrder(@Body() dto: AdminCreateShopOrderDto) {
    return this.shopService.createAdminOrder(dto);
  }

  @Get('orders')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOkResponse({ type: PaginatedShopOrdersResponseDto })
  @ApiForbiddenResponse({ description: 'Requires ADMIN or SUPER_ADMIN role' })
  findAllOrders(@Query() dto: FilterShopOrdersDto) {
    return this.shopService.findAllOrders(dto);
  }

  // ── Member Orders ──

  @Get('orders/mine')
  @UseGuards(RolesGuard)
  @Roles('MEMBER')
  @ApiOkResponse({ type: PaginatedShopOrdersResponseDto })
  @ApiForbiddenResponse({ description: 'Requires MEMBER role' })
  findMyOrders(
    @CurrentUser('id') memberId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.shopService.findMyOrders(memberId, query.page, query.limit);
  }

  @Get('orders/:id')
  @UseGuards(RolesGuard)
  @Roles('MEMBER')
  @ApiOkResponse({ type: ShopOrderResponseDto })
  @ApiNotFoundResponse({ description: 'Order not found' })
  @ApiForbiddenResponse({ description: 'Requires MEMBER role' })
  findMyOrder(
    @Param('id', ParseUUIDPipe) orderId: string,
    @CurrentUser('id') memberId: string,
  ) {
    return this.shopService.findMyOrder(orderId, memberId);
  }

  @Patch('orders/:id/collect')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOkResponse({ type: ShopOrderResponseDto })
  @ApiNotFoundResponse({ description: 'Order not found' })
  @ApiBadRequestResponse({ description: 'Order is not ready for collection' })
  @ApiForbiddenResponse({ description: 'Requires ADMIN or SUPER_ADMIN role' })
  collectOrder(@Param('id', ParseUUIDPipe) id: string) {
    return this.shopService.collectOrder(id);
  }

  // ── Analytics ──

  @Get('analytics')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({
    summary: 'Get shop analytics summary',
    description:
      'Returns all-time order counts by status, revenue totals (all-time, this month, last month), average order value, units sold, top 5 items by revenue, and count of out-of-stock active items/variants.',
  })
  @ApiOkResponse({ type: ShopAnalyticsResponseDto })
  @ApiForbiddenResponse({ description: 'Requires ADMIN or SUPER_ADMIN role' })
  getShopAnalytics() {
    return this.shopService.getShopAnalytics();
  }

  @Get('analytics/revenue')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({
    summary: 'Get shop revenue trends',
    description:
      'Time-series shop revenue for PAID and COLLECTED orders, grouped by granularity (daily/weekly/monthly). Each period includes total revenue, order count, and breakdown by payment method. Defaults to the last 12 months, monthly. Periods with no orders are omitted — callers should fill gaps client-side.',
  })
  @ApiOkResponse({ type: ShopRevenueTrendsResponseDto })
  @ApiForbiddenResponse({ description: 'Requires ADMIN or SUPER_ADMIN role' })
  getShopRevenueTrends(@Query() query: AnalyticsQueryDto) {
    return this.shopService.getShopRevenueTrends(query);
  }
}
