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
import { Throttle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequiresFeature } from '../licensing/decorators/requires-feature.decorator';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { DiscountCodesService } from './discount-codes.service';
import { CreateDiscountCodeDto } from './dto/create-discount-code.dto';
import { UpdateDiscountCodeDto } from './dto/update-discount-code.dto';
import { ValidateDiscountCodeDto } from './dto/validate-discount-code.dto';

@ApiTags('Discount Codes')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid JWT' })
@RequiresFeature('discount-codes')
@Controller('discount-codes')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DiscountCodesController {
  constructor(private readonly discountCodesService: DiscountCodesService) {}

  @Post()
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiCreatedResponse({ description: 'Discount code created' })
  @ApiForbiddenResponse({ description: 'Requires ADMIN or SUPER_ADMIN role' })
  create(@Body() dto: CreateDiscountCodeDto) {
    return this.discountCodesService.create(dto);
  }

  @Get()
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOkResponse({ description: 'Paginated list of discount codes' })
  @ApiForbiddenResponse({ description: 'Requires ADMIN or SUPER_ADMIN role' })
  @ApiQuery({
    name: 'filter',
    required: false,
    enum: ['active', 'expired', 'inactive'],
  })
  findAll(
    @Query() query: PaginationQueryDto,
    @Query('filter') filter?: string,
  ) {
    return this.discountCodesService.findAll(query.page, query.limit, filter);
  }

  @Get(':id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOkResponse({ description: 'Discount code details' })
  @ApiNotFoundResponse({ description: 'Discount code not found' })
  @ApiForbiddenResponse({ description: 'Requires ADMIN or SUPER_ADMIN role' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.discountCodesService.findOne(id);
  }

  @Patch(':id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOkResponse({ description: 'Discount code updated' })
  @ApiNotFoundResponse({ description: 'Discount code not found' })
  @ApiForbiddenResponse({ description: 'Requires ADMIN or SUPER_ADMIN role' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDiscountCodeDto,
  ) {
    return this.discountCodesService.update(id, dto);
  }

  @Delete(':id')
  @Roles('SUPER_ADMIN')
  @ApiOkResponse({ description: 'Discount code deactivated' })
  @ApiNotFoundResponse({ description: 'Discount code not found' })
  @ApiForbiddenResponse({ description: 'Requires SUPER_ADMIN role' })
  deactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.discountCodesService.deactivate(id);
  }

  @Get(':id/redemptions')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOkResponse({ description: 'Paginated list of redemptions' })
  @ApiNotFoundResponse({ description: 'Discount code not found' })
  @ApiForbiddenResponse({ description: 'Requires ADMIN or SUPER_ADMIN role' })
  getRedemptions(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.discountCodesService.getRedemptions(
      id,
      query.page,
      query.limit,
    );
  }

  @Post('validate')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOkResponse({ description: 'Discount code validation result' })
  @ApiNotFoundResponse({ description: 'Discount code or plan not found' })
  validate(
    @Body() dto: ValidateDiscountCodeDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.discountCodesService.validateCode(dto.code, dto.planId, userId);
  }
}
