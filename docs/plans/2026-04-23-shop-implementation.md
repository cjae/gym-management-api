# Shop Module Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a gym shop where members pay online (Paystack) or admins record counter sales; orders are fulfilled at the gym entrance.

**Architecture:** Standalone `src/shop/` module — `ShopService`, `ShopController`, and a payment listener. The existing Paystack webhook at `/api/payments/webhook` is extended with a `metadata.type` discriminator to route shop payments via EventEmitter without coupling `PaymentsService` to `ShopService`. Stock is decremented optimistically at order creation and restored on cancellation.

**Tech Stack:** NestJS 11, Prisma 7, PostgreSQL, Paystack (axios), `@nestjs/event-emitter`, `@nestjs/schedule`, jest-mock-extended

---

### Task 1: Prisma schema — all shop models + enum additions

**Files:**
- Modify: `prisma/schema.prisma`

**Step 1: Add `currency` to `GymSettings`**

In `prisma/schema.prisma`, inside the `GymSettings` model, after `timezone`:

```prisma
  currency                  String   @default("KES")
```

**Step 2: Add `SHOP_ORDER_COLLECTED` to `NotificationType` enum**

```prisma
enum NotificationType {
  GENERAL
  STREAK_NUDGE
  STATUS_CHANGE
  PAYMENT_REMINDER
  SUBSCRIPTION_EXPIRING
  BIRTHDAY
  REFERRAL_REWARD
  CLASS_UPDATE
  EVENT_UPDATE
  MILESTONE
  GOAL_PLAN_READY
  GOAL_PLAN_FAILED
  GOAL_WEEKLY_PULSE
  SHOP_ORDER_COLLECTED
}
```

**Step 3: Add `ShopOrderStatus` enum (near other enums, e.g. after `SalaryStatus`)**

```prisma
enum ShopOrderStatus {
  PENDING
  PAID
  COLLECTED
  CANCELLED
}
```

**Step 4: Add shop models (before closing of schema, after existing models)**

```prisma
model ShopItem {
  id          String   @id @default(uuid())
  name        String
  description String?
  price       Float
  imageUrl    String?
  stock       Int      @default(0)
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  variants   ShopItemVariant[]
  orderItems ShopOrderItem[]
}

model ShopItemVariant {
  id            String   @id @default(uuid())
  shopItemId    String
  name          String
  priceOverride Float?
  stock         Int      @default(0)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  item       ShopItem      @relation(fields: [shopItemId], references: [id], onDelete: Cascade)
  orderItems ShopOrderItem[]
}

model ShopOrder {
  id                String          @id @default(uuid())
  memberId          String
  status            ShopOrderStatus @default(PENDING)
  totalAmount       Float
  currency          String
  paymentMethod     PaymentMethod
  paystackReference String?         @unique
  createdAt         DateTime        @default(now())
  updatedAt         DateTime        @updatedAt

  member     User           @relation(fields: [memberId], references: [id])
  orderItems ShopOrderItem[]
}

model ShopOrderItem {
  id          String   @id @default(uuid())
  shopOrderId String
  shopItemId  String
  variantId   String?
  quantity    Int
  unitPrice   Float
  createdAt   DateTime @default(now())

  order   ShopOrder        @relation(fields: [shopOrderId], references: [id], onDelete: Cascade)
  item    ShopItem         @relation(fields: [shopItemId], references: [id])
  variant ShopItemVariant? @relation(fields: [variantId], references: [id])
}
```

**Step 5: Add `shopOrders` relation to `User` model**

Find the `User` model and add inside it (after existing relations):
```prisma
  shopOrders ShopOrder[]
```

**Step 6: Run migration**

```bash
npx prisma migrate dev --name add-shop-module
npx prisma generate
```

Expected: migration created, client regenerated with new types.

**Step 7: Run typecheck**

```bash
yarn tsc --noEmit
```

Expected: no errors.

**Step 8: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(shop): add shop models and enum values to prisma schema"
```

---

### Task 2: GymSettings — currency field

**Files:**
- Modify: `src/gym-settings/dto/upsert-gym-settings.dto.ts`
- Modify: `src/gym-settings/gym-settings.service.ts`
- Modify: `src/gym-settings/gym-settings.service.spec.ts`

**Step 1: Write failing test in `gym-settings.service.spec.ts`**

Add to the `upsert` describe block:

```typescript
it('should set currency on upsert', async () => {
  const settings = { ...mockSettings, currency: 'NGN' };
  prisma.gymSettings.upsert.mockResolvedValue(settings as any);

  const result = await service.upsert({ currency: 'NGN' });

  expect(prisma.gymSettings.upsert).toHaveBeenCalledWith(
    expect.objectContaining({
      update: expect.objectContaining({ currency: 'NGN' }),
    }),
  );
  expect(result.currency).toBe('NGN');
});
```

**Step 2: Run test to verify it fails**

```bash
yarn test -- --testPathPattern=gym-settings -t "should set currency"
```

Expected: FAIL — `currency` not in DTO or upsert call.

**Step 3: Add `currency` to `UpsertGymSettingsDto`**

```typescript
@ApiPropertyOptional({
  example: 'KES',
  description: 'ISO 4217 currency code (e.g. KES, NGN, USD)',
})
@IsOptional()
@IsString()
@Length(3, 3)
@Matches(/^[A-Z]{3}$/, { message: 'currency must be a 3-letter ISO code' })
currency?: string;
```

Also add `Length` and `Matches` to the imports from `class-validator`.

**Step 4: Update `GymSettingsService.upsert()`**

In both `create` and `update` blocks of the `prisma.gymSettings.upsert` call, add:

```typescript
...(dto.currency !== undefined && { currency: dto.currency }),
```

**Step 5: Run test to verify it passes**

```bash
yarn test -- --testPathPattern=gym-settings
```

Expected: all tests pass.

**Step 6: Run lint + typecheck**

```bash
yarn lint && yarn tsc --noEmit
```

**Step 7: Commit**

```bash
git add src/gym-settings/
git commit -m "feat(gym-settings): add currency field"
```

---

### Task 3: ShopModule scaffold

**Files:**
- Create: `src/shop/shop.module.ts`
- Create: `src/shop/shop.service.ts`
- Create: `src/shop/shop.controller.ts`
- Create: `src/shop/shop.service.spec.ts`
- Create: `src/shop/dto/` (directory — DTOs added in later tasks)
- Modify: `src/app.module.ts`

**Step 1: Create `src/shop/shop.service.ts`**

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { GymSettingsService } from '../gym-settings/gym-settings.service';
import { ConfigService } from '@nestjs/config';
import {
  PaymentConfig,
  getPaymentConfigName,
} from '../common/config/payment.config';
import axios from 'axios';

@Injectable()
export class ShopService {
  private readonly paystackBaseUrl = 'https://api.paystack.co';
  private readonly paystackSecretKey: string;
  private readonly paystackCallbackUrl: string;
  private readonly paystackCancelUrl: string;
  private readonly logger = new Logger(ShopService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly notificationsService: NotificationsService,
    private readonly gymSettingsService: GymSettingsService,
    private readonly configService: ConfigService,
  ) {
    const paymentConfig = this.configService.get<PaymentConfig>(
      getPaymentConfigName(),
    )!;
    this.paystackSecretKey = paymentConfig.paystackSecretKey;
    this.paystackCallbackUrl = paymentConfig.paystackCallbackUrl;
    this.paystackCancelUrl = paymentConfig.paystackCancelUrl;
  }
}
```

**Step 2: Create `src/shop/shop.controller.ts`**

```typescript
import { Controller, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RequiresFeature } from '../licensing/decorators/requires-feature.decorator';
import { ShopService } from './shop.service';

@ApiTags('Shop')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid JWT' })
@RequiresFeature('shop')
@Controller('shop')
@UseGuards(JwtAuthGuard)
export class ShopController {
  constructor(private readonly shopService: ShopService) {}
}
```

**Step 3: Create `src/shop/shop.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { ShopService } from './shop.service';
import { ShopController } from './shop.controller';
import { EmailModule } from '../email/email.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { GymSettingsModule } from '../gym-settings/gym-settings.module';

@Module({
  imports: [EmailModule, NotificationsModule, GymSettingsModule],
  controllers: [ShopController],
  providers: [ShopService],
  exports: [ShopService],
})
export class ShopModule {}
```

**Step 4: Create `src/shop/shop.service.spec.ts`**

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ShopService } from './shop.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { GymSettingsService } from '../gym-settings/gym-settings.service';
import { ConfigService } from '@nestjs/config';
import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaClient } from '@prisma/client';

describe('ShopService', () => {
  let service: ShopService;
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShopService,
        { provide: PrismaService, useValue: mockDeep<PrismaClient>() },
        { provide: EmailService, useValue: mockDeep<EmailService>() },
        {
          provide: NotificationsService,
          useValue: mockDeep<NotificationsService>(),
        },
        {
          provide: GymSettingsService,
          useValue: mockDeep<GymSettingsService>(),
        },
        {
          provide: ConfigService,
          useValue: {
            get: () => ({
              paystackSecretKey: 'test-key',
              paystackCallbackUrl: '',
              paystackCancelUrl: '',
            }),
          },
        },
      ],
    }).compile();

    service = module.get<ShopService>(ShopService);
    prisma = module.get(PrismaService);
    prisma.$transaction.mockImplementation((cb: any) => cb(prisma));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
```

**Step 5: Register `ShopModule` in `src/app.module.ts`**

Add import at top:
```typescript
import { ShopModule } from './shop/shop.module';
```

Add to the `imports` array (alongside the other modules):
```typescript
ShopModule,
```

**Step 6: Run tests**

```bash
yarn test -- --testPathPattern=shop
```

Expected: 1 test passes ("should be defined").

**Step 7: Run lint + typecheck**

```bash
yarn lint && yarn tsc --noEmit
```

**Step 8: Commit**

```bash
git add src/shop/ src/app.module.ts
git commit -m "feat(shop): scaffold shop module"
```

---

### Task 4: Shop item CRUD (admin)

**Files:**
- Create: `src/shop/dto/create-shop-item.dto.ts`
- Create: `src/shop/dto/update-shop-item.dto.ts`
- Create: `src/shop/dto/shop-item-response.dto.ts`
- Modify: `src/shop/shop.service.ts`
- Modify: `src/shop/shop.controller.ts`
- Modify: `src/shop/shop.service.spec.ts`

**Step 1: Create `src/shop/dto/create-shop-item.dto.ts`**

```typescript
import {
  IsString,
  IsNotEmpty,
  IsNumber,
  Min,
  IsOptional,
  IsUrl,
  MaxLength,
  IsBoolean,
  IsInt,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateShopItemDto {
  @ApiProperty({ example: 'Protein Shake - Chocolate' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional({ example: 'Premium whey protein, 1kg' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiProperty({ example: 2500 })
  @IsNumber()
  @Min(0)
  price: number;

  @ApiPropertyOptional({ example: 'https://res.cloudinary.com/...' })
  @IsOptional()
  @IsUrl()
  imageUrl?: string;

  @ApiPropertyOptional({ example: 10, description: 'Stock when no variants exist' })
  @IsOptional()
  @IsInt()
  @Min(0)
  stock?: number;
}
```

**Step 2: Create `src/shop/dto/update-shop-item.dto.ts`**

```typescript
import { PartialType } from '@nestjs/swagger';
import { CreateShopItemDto } from './create-shop-item.dto';
import { IsOptional, IsBoolean } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateShopItemDto extends PartialType(CreateShopItemDto) {
  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
```

**Step 3: Create `src/shop/dto/shop-item-response.dto.ts`**

```typescript
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ShopItemVariantResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() shopItemId: string;
  @ApiProperty() name: string;
  @ApiPropertyOptional() priceOverride?: number | null;
  @ApiProperty() stock: number;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}

export class ShopItemResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiPropertyOptional() description?: string | null;
  @ApiProperty() price: number;
  @ApiPropertyOptional() imageUrl?: string | null;
  @ApiProperty() stock: number;
  @ApiProperty() isActive: boolean;
  @ApiProperty({ type: [ShopItemVariantResponseDto] }) variants: ShopItemVariantResponseDto[];
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}

export class PaginatedShopItemsResponseDto {
  @ApiProperty({ type: [ShopItemResponseDto] }) data: ShopItemResponseDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
}
```

**Step 4: Write failing tests in `shop.service.spec.ts`**

```typescript
const mockItem = {
  id: 'item-1',
  name: 'Protein Shake',
  description: null,
  price: 2500,
  imageUrl: null,
  stock: 10,
  isActive: true,
  variants: [],
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('createItem', () => {
  it('should create a shop item', async () => {
    prisma.shopItem.create.mockResolvedValue(mockItem as any);
    const result = await service.createItem({
      name: 'Protein Shake',
      price: 2500,
      stock: 10,
    });
    expect(prisma.shopItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: 'Protein Shake', price: 2500 }),
      }),
    );
    expect(result.id).toBe('item-1');
  });
});

describe('findAllItems', () => {
  it('should return paginated items (admin sees all)', async () => {
    prisma.shopItem.findMany.mockResolvedValue([mockItem] as any);
    prisma.shopItem.count.mockResolvedValue(1);
    const result = await service.findAllItems(1, 20, false);
    expect(result.total).toBe(1);
    expect(result.data).toHaveLength(1);
  });

  it('should filter active-only for members', async () => {
    prisma.shopItem.findMany.mockResolvedValue([] as any);
    prisma.shopItem.count.mockResolvedValue(0);
    await service.findAllItems(1, 20, true);
    expect(prisma.shopItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isActive: true }),
      }),
    );
  });
});

describe('findOneItem', () => {
  it('should throw NotFoundException when item not found', async () => {
    prisma.shopItem.findUnique.mockResolvedValue(null);
    await expect(service.findOneItem('item-1', false)).rejects.toThrow(
      'Shop item not found',
    );
  });

  it('should throw NotFoundException for inactive item when member', async () => {
    prisma.shopItem.findUnique.mockResolvedValue({ ...mockItem, isActive: false } as any);
    await expect(service.findOneItem('item-1', true)).rejects.toThrow(
      'Shop item not found',
    );
  });
});
```

**Step 5: Run tests to verify they fail**

```bash
yarn test -- --testPathPattern=shop -t "createItem|findAllItems|findOneItem"
```

Expected: FAIL — methods not on service.

**Step 6: Add item service methods to `ShopService`**

```typescript
async createItem(dto: CreateShopItemDto) {
  return this.prisma.shopItem.create({
    data: {
      name: dto.name,
      description: dto.description,
      price: dto.price,
      imageUrl: dto.imageUrl,
      stock: dto.stock ?? 0,
    },
    include: { variants: true },
  });
}

async findAllItems(page = 1, limit = 20, memberOnly = false) {
  const where = memberOnly ? { isActive: true } : {};
  const [data, total] = await Promise.all([
    this.prisma.shopItem.findMany({
      where,
      include: { variants: true },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    this.prisma.shopItem.count({ where }),
  ]);
  return { data, total, page, limit };
}

async findOneItem(id: string, memberOnly = false) {
  const item = await this.prisma.shopItem.findUnique({
    where: { id },
    include: { variants: true },
  });
  if (!item || (memberOnly && !item.isActive)) {
    throw new NotFoundException('Shop item not found');
  }
  return item;
}

async updateItem(id: string, dto: UpdateShopItemDto) {
  await this.findOneItem(id);
  return this.prisma.shopItem.update({
    where: { id },
    data: {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.description !== undefined && { description: dto.description }),
      ...(dto.price !== undefined && { price: dto.price }),
      ...(dto.imageUrl !== undefined && { imageUrl: dto.imageUrl }),
      ...(dto.stock !== undefined && { stock: dto.stock }),
      ...(dto.isActive !== undefined && { isActive: dto.isActive }),
    },
    include: { variants: true },
  });
}

async removeItem(id: string) {
  await this.findOneItem(id);
  return this.prisma.shopItem.delete({ where: { id } });
}
```

Also add to imports at top of service file:
```typescript
import { NotFoundException, BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { CreateShopItemDto } from './dto/create-shop-item.dto';
import { UpdateShopItemDto } from './dto/update-shop-item.dto';
```

**Step 7: Add item endpoints to `ShopController`**

```typescript
import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query,
  UseGuards, ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags, ApiBearerAuth, ApiUnauthorizedResponse, ApiCreatedResponse,
  ApiOkResponse, ApiNotFoundResponse,
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
```

**Step 8: Run tests**

```bash
yarn test -- --testPathPattern=shop
```

Expected: all tests pass.

**Step 9: Run lint + typecheck**

```bash
yarn lint && yarn tsc --noEmit
```

**Step 10: Commit**

```bash
git add src/shop/
git commit -m "feat(shop): shop item CRUD"
```

---

### Task 5: Shop item variant CRUD (admin)

**Files:**
- Create: `src/shop/dto/create-shop-item-variant.dto.ts`
- Create: `src/shop/dto/update-shop-item-variant.dto.ts`
- Modify: `src/shop/shop.service.ts`
- Modify: `src/shop/shop.controller.ts`
- Modify: `src/shop/shop.service.spec.ts`

**Step 1: Create `src/shop/dto/create-shop-item-variant.dto.ts`**

```typescript
import { IsString, IsNotEmpty, MaxLength, IsOptional, IsNumber, Min, IsInt } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateShopItemVariantDto {
  @ApiProperty({ example: 'Large' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({ example: 3000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  priceOverride?: number;

  @ApiProperty({ example: 5 })
  @IsInt()
  @Min(0)
  stock: number;
}
```

**Step 2: Create `src/shop/dto/update-shop-item-variant.dto.ts`**

```typescript
import { PartialType } from '@nestjs/swagger';
import { CreateShopItemVariantDto } from './create-shop-item-variant.dto';

export class UpdateShopItemVariantDto extends PartialType(CreateShopItemVariantDto) {}
```

**Step 3: Write failing tests**

```typescript
const mockVariant = {
  id: 'variant-1',
  shopItemId: 'item-1',
  name: 'Large',
  priceOverride: null,
  stock: 5,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('addVariant', () => {
  it('should add a variant to an item', async () => {
    prisma.shopItem.findUnique.mockResolvedValue(mockItem as any);
    prisma.shopItemVariant.create.mockResolvedValue(mockVariant as any);
    const result = await service.addVariant('item-1', { name: 'Large', stock: 5 });
    expect(result.name).toBe('Large');
  });

  it('should throw NotFoundException if item not found', async () => {
    prisma.shopItem.findUnique.mockResolvedValue(null);
    await expect(service.addVariant('item-1', { name: 'Large', stock: 5 })).rejects.toThrow(
      'Shop item not found',
    );
  });
});

describe('removeVariant', () => {
  it('should throw NotFoundException if variant not found', async () => {
    prisma.shopItemVariant.findUnique.mockResolvedValue(null);
    await expect(service.removeVariant('item-1', 'variant-1')).rejects.toThrow(
      'Variant not found',
    );
  });
});
```

**Step 4: Run tests to verify they fail**

```bash
yarn test -- --testPathPattern=shop -t "addVariant|removeVariant"
```

Expected: FAIL.

**Step 5: Add variant methods to `ShopService`**

```typescript
async addVariant(itemId: string, dto: CreateShopItemVariantDto) {
  await this.findOneItem(itemId);
  return this.prisma.shopItemVariant.create({
    data: {
      shopItemId: itemId,
      name: dto.name,
      priceOverride: dto.priceOverride ?? null,
      stock: dto.stock,
    },
  });
}

async updateVariant(itemId: string, variantId: string, dto: UpdateShopItemVariantDto) {
  const variant = await this.prisma.shopItemVariant.findUnique({
    where: { id: variantId },
  });
  if (!variant || variant.shopItemId !== itemId) {
    throw new NotFoundException('Variant not found');
  }
  return this.prisma.shopItemVariant.update({
    where: { id: variantId },
    data: {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.priceOverride !== undefined && { priceOverride: dto.priceOverride }),
      ...(dto.stock !== undefined && { stock: dto.stock }),
    },
  });
}

async removeVariant(itemId: string, variantId: string) {
  const variant = await this.prisma.shopItemVariant.findUnique({
    where: { id: variantId },
  });
  if (!variant || variant.shopItemId !== itemId) {
    throw new NotFoundException('Variant not found');
  }
  return this.prisma.shopItemVariant.delete({ where: { id: variantId } });
}
```

Also add to imports at top:
```typescript
import { CreateShopItemVariantDto } from './dto/create-shop-item-variant.dto';
import { UpdateShopItemVariantDto } from './dto/update-shop-item-variant.dto';
```

**Step 6: Add variant endpoints to `ShopController`**

```typescript
import { CreateShopItemVariantDto } from './dto/create-shop-item-variant.dto';
import { UpdateShopItemVariantDto } from './dto/update-shop-item-variant.dto';
import { ShopItemVariantResponseDto } from './dto/shop-item-response.dto';

// Inside class:
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
```

**Step 7: Run tests**

```bash
yarn test -- --testPathPattern=shop
```

Expected: all pass.

**Step 8: Run lint + typecheck + commit**

```bash
yarn lint && yarn tsc --noEmit
git add src/shop/
git commit -m "feat(shop): shop item variant CRUD"
```

---

### Task 6: Member order creation (online Paystack)

**Files:**
- Create: `src/shop/dto/create-shop-order.dto.ts`
- Create: `src/shop/dto/shop-order-response.dto.ts`
- Modify: `src/shop/shop.service.ts`
- Modify: `src/shop/shop.controller.ts`
- Modify: `src/shop/shop.service.spec.ts`

**Step 1: Create `src/shop/dto/create-shop-order.dto.ts`**

```typescript
import {
  IsArray, ValidateNested, IsUUID, IsInt, Min, IsOptional, IsEnum,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentMethod } from '@prisma/client';

export class ShopOrderItemDto {
  @ApiProperty() @IsUUID() shopItemId: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() variantId?: string;
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) quantity: number;
}

export class CreateShopOrderDto {
  @ApiProperty({ type: [ShopOrderItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ShopOrderItemDto)
  items: ShopOrderItemDto[];

  @ApiProperty({ enum: [PaymentMethod.CARD, PaymentMethod.MOBILE_MONEY, PaymentMethod.BANK_TRANSFER] })
  @IsEnum([PaymentMethod.CARD, PaymentMethod.MOBILE_MONEY, PaymentMethod.BANK_TRANSFER])
  paymentMethod: PaymentMethod;
}
```

**Step 2: Create `src/shop/dto/shop-order-response.dto.ts`**

```typescript
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ShopOrderStatus, PaymentMethod } from '@prisma/client';

export class ShopOrderItemResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() shopItemId: string;
  @ApiPropertyOptional() variantId?: string | null;
  @ApiProperty() quantity: number;
  @ApiProperty() unitPrice: number;
}

export class ShopOrderResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() memberId: string;
  @ApiProperty({ enum: ShopOrderStatus }) status: ShopOrderStatus;
  @ApiProperty() totalAmount: number;
  @ApiProperty() currency: string;
  @ApiProperty({ enum: PaymentMethod }) paymentMethod: PaymentMethod;
  @ApiPropertyOptional() paystackReference?: string | null;
  @ApiProperty({ type: [ShopOrderItemResponseDto] }) orderItems: ShopOrderItemResponseDto[];
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}

export class CreateShopOrderResponseDto {
  @ApiProperty({ type: ShopOrderResponseDto }) order: ShopOrderResponseDto;
  @ApiPropertyOptional({ description: 'Paystack checkout URL — present for online orders' })
  checkout?: { authorization_url: string; access_code: string; reference: string };
}

export class PaginatedShopOrdersResponseDto {
  @ApiProperty({ type: [ShopOrderResponseDto] }) data: ShopOrderResponseDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
}
```

**Step 3: Write failing tests**

```typescript
describe('createOrder', () => {
  const mockSettings = {
    currency: 'KES',
    timezone: 'Africa/Nairobi',
  };
  const mockMember = {
    id: 'member-1',
    email: 'member@test.com',
    firstName: 'Jane',
  };
  let gymSettingsService: DeepMockProxy<GymSettingsService>;

  beforeEach(() => {
    gymSettingsService = module.get(GymSettingsService);
    gymSettingsService.getCachedSettings.mockResolvedValue(mockSettings as any);
  });

  it('should throw BadRequestException when item not found', async () => {
    prisma.shopItem.findUnique.mockResolvedValue(null);
    await expect(
      service.createOrder('member-1', 'member@test.com', {
        items: [{ shopItemId: 'item-1', quantity: 1 }],
        paymentMethod: 'CARD' as any,
      }),
    ).rejects.toThrow('Shop item item-1 not found');
  });

  it('should throw ConflictException when stock insufficient', async () => {
    prisma.shopItem.findUnique.mockResolvedValue({ ...mockItem, stock: 0, variants: [] } as any);
    await expect(
      service.createOrder('member-1', 'member@test.com', {
        items: [{ shopItemId: 'item-1', quantity: 1 }],
        paymentMethod: 'CARD' as any,
      }),
    ).rejects.toThrow('Insufficient stock');
  });
});
```

**Step 4: Run tests to verify they fail**

```bash
yarn test -- --testPathPattern=shop -t "createOrder"
```

Expected: FAIL.

**Step 5: Add `createOrder` to `ShopService`**

```typescript
async createOrder(
  memberId: string,
  email: string,
  dto: CreateShopOrderDto,
) {
  const settings = await this.gymSettingsService.getCachedSettings();
  const currency = settings?.currency ?? 'KES';

  // Validate all items + variants upfront, compute unit prices
  const lineItems: Array<{
    shopItemId: string;
    variantId?: string;
    quantity: number;
    unitPrice: number;
    hasVariant: boolean;
  }> = [];

  for (const line of dto.items) {
    const item = await this.prisma.shopItem.findUnique({
      where: { id: line.shopItemId },
      include: { variants: true },
    });
    if (!item || !item.isActive) {
      throw new BadRequestException(`Shop item ${line.shopItemId} not found`);
    }

    if (line.variantId) {
      const variant = item.variants.find((v) => v.id === line.variantId);
      if (!variant) {
        throw new BadRequestException(
          `Variant ${line.variantId} not found on item ${line.shopItemId}`,
        );
      }
      if (variant.stock < line.quantity) {
        throw new ConflictException(
          `Insufficient stock for variant ${variant.name}`,
        );
      }
      lineItems.push({
        shopItemId: line.shopItemId,
        variantId: line.variantId,
        quantity: line.quantity,
        unitPrice: variant.priceOverride ?? item.price,
        hasVariant: true,
      });
    } else {
      if (item.stock < line.quantity) {
        throw new ConflictException(
          `Insufficient stock for item ${item.name}`,
        );
      }
      lineItems.push({
        shopItemId: line.shopItemId,
        quantity: line.quantity,
        unitPrice: item.price,
        hasVariant: false,
      });
    }
  }

  const totalAmount = lineItems.reduce(
    (sum, l) => sum + l.unitPrice * l.quantity,
    0,
  );

  // Create order + decrement stock atomically
  const order = await this.prisma.$transaction(async (tx) => {
    const created = await tx.shopOrder.create({
      data: {
        memberId,
        totalAmount,
        currency,
        paymentMethod: dto.paymentMethod,
        orderItems: {
          create: lineItems.map((l) => ({
            shopItemId: l.shopItemId,
            variantId: l.variantId ?? null,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
          })),
        },
      },
      include: { orderItems: true },
    });

    // Decrement stock per line — if any decrement misses (stock already 0)
    // the transaction rolls back and we surface a ConflictException.
    for (const l of lineItems) {
      if (l.hasVariant && l.variantId) {
        const result = await tx.shopItemVariant.updateMany({
          where: { id: l.variantId, stock: { gte: l.quantity } },
          data: { stock: { decrement: l.quantity } },
        });
        if (result.count === 0) {
          throw new ConflictException('Insufficient stock (concurrent order)');
        }
      } else {
        const result = await tx.shopItem.updateMany({
          where: { id: l.shopItemId, stock: { gte: l.quantity } },
          data: { stock: { decrement: l.quantity } },
        });
        if (result.count === 0) {
          throw new ConflictException('Insufficient stock (concurrent order)');
        }
      }
    }

    return created;
  });

  // Initialize Paystack
  const reference = `shop_${order.id}_${Date.now()}`;
  const channelMap: Record<string, string> = {
    CARD: 'card',
    MOBILE_MONEY: 'mobile_money',
    BANK_TRANSFER: 'bank_transfer',
  };
  const channel = channelMap[dto.paymentMethod] ?? 'card';

  const payload = {
    email,
    amount: Math.round(totalAmount * 100),
    currency,
    channels: [channel],
    reference,
    ...(this.paystackCallbackUrl && { callback_url: this.paystackCallbackUrl }),
    metadata: {
      type: 'shop',
      orderId: order.id,
      ...(this.paystackCancelUrl && { cancel_action: this.paystackCancelUrl }),
    },
  };

  try {
    const response = await axios.post<{
      data: { authorization_url: string; access_code: string; reference: string };
    }>(`${this.paystackBaseUrl}/transaction/initialize`, payload, {
      headers: {
        Authorization: `Bearer ${this.paystackSecretKey}`,
        'Content-Type': 'application/json',
      },
    });

    await this.prisma.shopOrder.update({
      where: { id: order.id },
      data: { paystackReference: reference },
    });

    return { order, checkout: response.data.data };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      this.logger.error('Paystack shop initialization failed', {
        status: error.response?.status,
        body: error.response?.data,
      });
    }
    throw new BadRequestException('Payment initialization failed');
  }
}
```

Also add to imports:
```typescript
import { CreateShopOrderDto } from './dto/create-shop-order.dto';
import axios from 'axios';
```

**Step 6: Add order creation endpoint to `ShopController`**

```typescript
import { CreateShopOrderDto } from './dto/create-shop-order.dto';
import { CreateShopOrderResponseDto } from './dto/shop-order-response.dto';

// Inside class:
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
```

**Step 7: Run tests**

```bash
yarn test -- --testPathPattern=shop
```

Expected: all pass.

**Step 8: Run lint + typecheck + commit**

```bash
yarn lint && yarn tsc --noEmit
git add src/shop/
git commit -m "feat(shop): member order creation with Paystack checkout"
```

---

### Task 7: Extend Paystack webhook routing

**Files:**
- Modify: `src/payments/payments.service.ts`
- Modify: `src/payments/payments.service.spec.ts`

**Step 1: Write failing test in `payments.service.spec.ts`**

Add to the `handleWebhook` describe block:

```typescript
it('should emit shop.payment.success when metadata.type is shop', async () => {
  const rawBody = Buffer.from(
    JSON.stringify({
      event: 'charge.success',
      data: {
        reference: 'shop_ref_123',
        metadata: { type: 'shop', orderId: 'order-1' },
      },
    }),
  );
  const hash = crypto
    .createHmac('sha512', 'test-secret')
    .update(rawBody)
    .digest('hex');

  await service.handleWebhook(rawBody, hash);

  expect(eventEmitter.emit).toHaveBeenCalledWith('shop.payment.success', {
    orderId: 'order-1',
    reference: 'shop_ref_123',
  });
});
```

**Step 2: Run test to verify it fails**

```bash
yarn test -- --testPathPattern=payments.service -t "shop.payment.success"
```

Expected: FAIL.

**Step 3: Update `PaystackWebhookMetadata` interface in `payments.service.ts`**

Change:
```typescript
interface PaystackWebhookMetadata {
  subscriptionId?: string;
  paymentId?: string;
}
```
To:
```typescript
interface PaystackWebhookMetadata {
  type?: 'subscription' | 'shop';
  subscriptionId?: string;
  paymentId?: string;
  orderId?: string;
}
```

**Step 4: Add routing logic in `handleWebhook`**

In the `if (body.event === 'charge.success')` block, add shop routing **before** the subscription logic:

```typescript
if (body.event === 'charge.success') {
  const { reference, metadata, authorization, channel } = body.data;

  // Route shop payments to ShopService via EventEmitter
  if (metadata?.type === 'shop') {
    const orderId = metadata.orderId;
    if (!orderId) {
      this.logger.warn(`shop charge.success missing orderId (reference=${reference})`);
      return { received: true };
    }
    this.eventEmitter.emit('shop.payment.success', { orderId, reference });
    return { received: true };
  }

  // Existing subscription flow below...
```

**Step 5: Run tests**

```bash
yarn test -- --testPathPattern=payments.service
```

Expected: all pass.

**Step 6: Run lint + typecheck + commit**

```bash
yarn lint && yarn tsc --noEmit
git add src/payments/
git commit -m "feat(shop): route shop webhook events via EventEmitter"
```

---

### Task 8: Shop payment listener

**Files:**
- Create: `src/shop/listeners/shop-payment.listener.ts`
- Modify: `src/shop/shop.module.ts`
- Modify: `src/shop/shop.service.ts`
- Modify: `src/shop/shop.service.spec.ts`

**Step 1: Add `handlePaymentSuccess` to `ShopService`**

```typescript
async handlePaymentSuccess(orderId: string, reference: string) {
  const updated = await this.prisma.shopOrder.updateMany({
    where: { id: orderId, status: 'PENDING' },
    data: { status: 'PAID', paystackReference: reference },
  });

  if (updated.count === 0) {
    this.logger.warn(
      `shop.payment.success: order ${orderId} not PENDING or already processed`,
    );
    return;
  }

  // Check for zero-stock items after payment and send low-stock emails
  const order = await this.prisma.shopOrder.findUnique({
    where: { id: orderId },
    include: { orderItems: true },
  });
  if (order) {
    await this.checkAndNotifyLowStock(order.orderItems);
  }
}
```

**Step 2: Write failing test**

```typescript
describe('handlePaymentSuccess', () => {
  it('should update order to PAID', async () => {
    prisma.shopOrder.updateMany.mockResolvedValue({ count: 1 });
    prisma.shopOrder.findUnique.mockResolvedValue({
      id: 'order-1',
      orderItems: [],
    } as any);

    await service.handlePaymentSuccess('order-1', 'ref_123');

    expect(prisma.shopOrder.updateMany).toHaveBeenCalledWith({
      where: { id: 'order-1', status: 'PENDING' },
      data: { status: 'PAID', paystackReference: 'ref_123' },
    });
  });

  it('should log warn when order not PENDING', async () => {
    prisma.shopOrder.updateMany.mockResolvedValue({ count: 0 });
    const logSpy = jest.spyOn((service as any).logger, 'warn');

    await service.handlePaymentSuccess('order-1', 'ref_123');

    expect(logSpy).toHaveBeenCalled();
  });
});
```

**Step 3: Run tests to verify they fail**

```bash
yarn test -- --testPathPattern=shop -t "handlePaymentSuccess"
```

**Step 4: Create `src/shop/listeners/shop-payment.listener.ts`**

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ShopService } from '../shop.service';

@Injectable()
export class ShopPaymentListener {
  private readonly logger = new Logger(ShopPaymentListener.name);

  constructor(private readonly shopService: ShopService) {}

  @OnEvent('shop.payment.success', { async: true })
  async handle(payload: { orderId: string; reference: string }) {
    try {
      await this.shopService.handlePaymentSuccess(payload.orderId, payload.reference);
    } catch (err) {
      this.logger.error(
        `Failed to process shop payment for order ${payload.orderId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
```

**Step 5: Register listener in `shop.module.ts`**

```typescript
import { ShopPaymentListener } from './listeners/shop-payment.listener';

@Module({
  imports: [EmailModule, NotificationsModule, GymSettingsModule],
  controllers: [ShopController],
  providers: [ShopService, ShopPaymentListener],
  exports: [ShopService],
})
export class ShopModule {}
```

**Step 6: Run tests**

```bash
yarn test -- --testPathPattern=shop
```

Expected: all pass.

**Step 7: Run lint + typecheck + commit**

```bash
yarn lint && yarn tsc --noEmit
git add src/shop/
git commit -m "feat(shop): shop payment listener — mark order PAID on webhook"
```

---

### Task 9: Admin order management

**Files:**
- Create: `src/shop/dto/admin-create-shop-order.dto.ts`
- Create: `src/shop/dto/filter-shop-orders.dto.ts`
- Modify: `src/shop/shop.service.ts`
- Modify: `src/shop/shop.controller.ts`
- Modify: `src/shop/shop.service.spec.ts`

**Step 1: Create `src/shop/dto/admin-create-shop-order.dto.ts`**

```typescript
import { IsUUID, IsEnum, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { ADMIN_PAYMENT_METHODS, AdminPaymentMethod } from '../../common/constants/payment-methods';
import { ShopOrderItemDto } from './create-shop-order.dto';

export class AdminCreateShopOrderDto {
  @ApiProperty() @IsUUID() memberId: string;

  @ApiProperty({ type: [ShopOrderItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ShopOrderItemDto)
  items: ShopOrderItemDto[];

  @ApiProperty({ enum: ADMIN_PAYMENT_METHODS })
  @IsEnum(ADMIN_PAYMENT_METHODS)
  paymentMethod: AdminPaymentMethod;
}
```

**Step 2: Create `src/shop/dto/filter-shop-orders.dto.ts`**

```typescript
import { IsOptional, IsEnum, IsUUID, IsDateString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ShopOrderStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class FilterShopOrdersDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ShopOrderStatus })
  @IsOptional()
  @IsEnum(ShopOrderStatus)
  status?: ShopOrderStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  memberId?: string;

  @ApiPropertyOptional({ example: '2026-01-01' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @IsDateString()
  to?: string;
}
```

**Step 3: Write failing tests**

```typescript
describe('createAdminOrder', () => {
  it('should create order with COLLECTED status', async () => {
    prisma.shopItem.findUnique.mockResolvedValue({ ...mockItem, variants: [] } as any);
    prisma.shopOrder.create.mockResolvedValue({
      id: 'order-1',
      status: 'COLLECTED',
      orderItems: [],
    } as any);
    prisma.shopItem.updateMany.mockResolvedValue({ count: 1 });
    prisma.$transaction.mockImplementation((cb: any) => cb(prisma));

    const gymSettingsServiceMock = module.get(GymSettingsService);
    gymSettingsServiceMock.getCachedSettings.mockResolvedValue({ currency: 'KES' } as any);

    const result = await service.createAdminOrder({
      memberId: 'member-1',
      items: [{ shopItemId: 'item-1', quantity: 1 }],
      paymentMethod: 'MOBILE_MONEY_IN_PERSON' as any,
    });

    expect(result.status).toBe('COLLECTED');
  });
});

describe('collectOrder', () => {
  it('should throw NotFoundException if order not found', async () => {
    prisma.shopOrder.findUnique.mockResolvedValue(null);
    await expect(service.collectOrder('order-1')).rejects.toThrow('Order not found');
  });

  it('should throw BadRequestException if order is not PAID', async () => {
    prisma.shopOrder.findUnique.mockResolvedValue({
      id: 'order-1',
      status: 'PENDING',
      member: { id: 'member-1', firstName: 'Jane' },
    } as any);
    await expect(service.collectOrder('order-1')).rejects.toThrow(
      'Order is not ready for collection',
    );
  });
});
```

**Step 4: Run tests to verify they fail**

```bash
yarn test -- --testPathPattern=shop -t "createAdminOrder|collectOrder"
```

**Step 5: Add `createAdminOrder`, `findAllOrders`, `collectOrder` to `ShopService`**

```typescript
async createAdminOrder(dto: AdminCreateShopOrderDto) {
  const settings = await this.gymSettingsService.getCachedSettings();
  const currency = settings?.currency ?? 'KES';

  // Validate items (same logic as createOrder but without Paystack)
  const lineItems: Array<{
    shopItemId: string;
    variantId?: string;
    quantity: number;
    unitPrice: number;
    hasVariant: boolean;
  }> = [];

  for (const line of dto.items) {
    const item = await this.prisma.shopItem.findUnique({
      where: { id: line.shopItemId },
      include: { variants: true },
    });
    if (!item || !item.isActive) {
      throw new BadRequestException(`Shop item ${line.shopItemId} not found`);
    }

    if (line.variantId) {
      const variant = item.variants.find((v) => v.id === line.variantId);
      if (!variant) {
        throw new BadRequestException(`Variant ${line.variantId} not found`);
      }
      if (variant.stock < line.quantity) {
        throw new ConflictException(`Insufficient stock for variant ${variant.name}`);
      }
      lineItems.push({
        shopItemId: line.shopItemId,
        variantId: line.variantId,
        quantity: line.quantity,
        unitPrice: variant.priceOverride ?? item.price,
        hasVariant: true,
      });
    } else {
      if (item.stock < line.quantity) {
        throw new ConflictException(`Insufficient stock for item ${item.name}`);
      }
      lineItems.push({
        shopItemId: line.shopItemId,
        quantity: line.quantity,
        unitPrice: item.price,
        hasVariant: false,
      });
    }
  }

  const totalAmount = lineItems.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);

  const order = await this.prisma.$transaction(async (tx) => {
    const created = await tx.shopOrder.create({
      data: {
        memberId: dto.memberId,
        status: 'COLLECTED',
        totalAmount,
        currency,
        paymentMethod: dto.paymentMethod,
        orderItems: {
          create: lineItems.map((l) => ({
            shopItemId: l.shopItemId,
            variantId: l.variantId ?? null,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
          })),
        },
      },
      include: { orderItems: true },
    });

    for (const l of lineItems) {
      if (l.hasVariant && l.variantId) {
        const result = await tx.shopItemVariant.updateMany({
          where: { id: l.variantId, stock: { gte: l.quantity } },
          data: { stock: { decrement: l.quantity } },
        });
        if (result.count === 0) {
          throw new ConflictException('Insufficient stock (concurrent order)');
        }
      } else {
        const result = await tx.shopItem.updateMany({
          where: { id: l.shopItemId, stock: { gte: l.quantity } },
          data: { stock: { decrement: l.quantity } },
        });
        if (result.count === 0) {
          throw new ConflictException('Insufficient stock (concurrent order)');
        }
      }
    }

    return created;
  });

  await this.checkAndNotifyLowStock(order.orderItems);
  return order;
}

async findAllOrders(dto: FilterShopOrdersDto) {
  const where: any = {};
  if (dto.status) where.status = dto.status;
  if (dto.memberId) where.memberId = dto.memberId;
  if (dto.from || dto.to) {
    where.createdAt = {};
    if (dto.from) where.createdAt.gte = new Date(dto.from);
    if (dto.to) where.createdAt.lte = new Date(dto.to);
  }

  const [data, total] = await Promise.all([
    this.prisma.shopOrder.findMany({
      where,
      include: {
        orderItems: true,
        member: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: ((dto.page ?? 1) - 1) * (dto.limit ?? 20),
      take: dto.limit ?? 20,
    }),
    this.prisma.shopOrder.count({ where }),
  ]);

  return { data, total, page: dto.page ?? 1, limit: dto.limit ?? 20 };
}

async collectOrder(orderId: string) {
  const order = await this.prisma.shopOrder.findUnique({
    where: { id: orderId },
    include: {
      member: { select: { id: true, firstName: true } },
    },
  });

  if (!order) throw new NotFoundException('Order not found');
  if (order.status !== 'PAID') {
    throw new BadRequestException('Order is not ready for collection');
  }

  const updated = await this.prisma.shopOrder.update({
    where: { id: orderId },
    data: { status: 'COLLECTED' },
    include: { orderItems: true, member: { select: { id: true, firstName: true } } },
  });

  this.notificationsService
    .create({
      userId: order.member.id,
      title: 'Order Ready for Pickup',
      body: `Your order is ready for collection at the gym entrance.`,
      type: 'SHOP_ORDER_COLLECTED' as any,
      metadata: { orderId },
    })
    .catch((err) =>
      this.logger.error(`Failed to send order collected notification: ${err.message}`),
    );

  return updated;
}
```

Also add to imports:
```typescript
import { AdminCreateShopOrderDto } from './dto/admin-create-shop-order.dto';
import { FilterShopOrdersDto } from './dto/filter-shop-orders.dto';
```

**Step 6: Add admin endpoints to `ShopController`**

```typescript
import { AdminCreateShopOrderDto } from './dto/admin-create-shop-order.dto';
import { FilterShopOrdersDto } from './dto/filter-shop-orders.dto';
import { ShopOrderResponseDto, PaginatedShopOrdersResponseDto } from './dto/shop-order-response.dto';

// Inside class:
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
```

**Step 7: Run tests**

```bash
yarn test -- --testPathPattern=shop
```

Expected: all pass.

**Step 8: Run lint + typecheck + commit**

```bash
yarn lint && yarn tsc --noEmit
git add src/shop/
git commit -m "feat(shop): admin order management — counter sale, list orders, mark collected"
```

---

### Task 10: Member order history

**Files:**
- Modify: `src/shop/shop.service.ts`
- Modify: `src/shop/shop.controller.ts`
- Modify: `src/shop/shop.service.spec.ts`

**Step 1: Write failing tests**

```typescript
describe('findMyOrders', () => {
  it('should return paginated orders for member', async () => {
    prisma.shopOrder.findMany.mockResolvedValue([]);
    prisma.shopOrder.count.mockResolvedValue(0);
    const result = await service.findMyOrders('member-1', 1, 20);
    expect(prisma.shopOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { memberId: 'member-1' },
      }),
    );
    expect(result.total).toBe(0);
  });
});

describe('findMyOrder', () => {
  it('should throw ForbiddenException when order belongs to another member', async () => {
    prisma.shopOrder.findUnique.mockResolvedValue({
      id: 'order-1',
      memberId: 'other-member',
      orderItems: [],
    } as any);
    await expect(service.findMyOrder('order-1', 'member-1')).rejects.toThrow(
      'Order not found',
    );
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
yarn test -- --testPathPattern=shop -t "findMyOrders|findMyOrder"
```

**Step 3: Add `findMyOrders` and `findMyOrder` to `ShopService`**

```typescript
async findMyOrders(memberId: string, page = 1, limit = 20) {
  const where = { memberId };
  const [data, total] = await Promise.all([
    this.prisma.shopOrder.findMany({
      where,
      include: { orderItems: true },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    this.prisma.shopOrder.count({ where }),
  ]);
  return { data, total, page, limit };
}

async findMyOrder(orderId: string, memberId: string) {
  const order = await this.prisma.shopOrder.findUnique({
    where: { id: orderId },
    include: { orderItems: true },
  });
  if (!order || order.memberId !== memberId) {
    throw new NotFoundException('Order not found');
  }
  return order;
}
```

**Step 4: Add member order history endpoints to `ShopController`**

```typescript
@Get('orders/mine')
@UseGuards(RolesGuard)
@Roles('MEMBER')
@ApiOkResponse({ type: PaginatedShopOrdersResponseDto })
findMyOrders(
  @CurrentUser('id') memberId: string,
  @Query() query: PaginationQueryDto,
) {
  return this.shopService.findMyOrders(memberId, query.page, query.limit);
}

@Get('orders/:id')
@ApiOkResponse({ type: ShopOrderResponseDto })
@ApiNotFoundResponse({ description: 'Order not found' })
findMyOrder(
  @Param('id', ParseUUIDPipe) orderId: string,
  @CurrentUser('id') memberId: string,
) {
  return this.shopService.findMyOrder(orderId, memberId);
}
```

**Step 5: Run tests**

```bash
yarn test -- --testPathPattern=shop
```

Expected: all pass.

**Step 6: Run lint + typecheck + commit**

```bash
yarn lint && yarn tsc --noEmit
git add src/shop/
git commit -m "feat(shop): member order history endpoints"
```

---

### Task 11: PENDING order cleanup cron

**Files:**
- Modify: `src/shop/shop.service.ts`
- Modify: `src/shop/shop.service.spec.ts`

**Step 1: Write failing test**

```typescript
describe('cleanupPendingOrders', () => {
  it('should cancel PENDING orders older than 1 hour and restore stock', async () => {
    const staleOrder = {
      id: 'order-1',
      status: 'PENDING',
      createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2h ago
      orderItems: [
        { shopItemId: 'item-1', variantId: null, quantity: 2 },
      ],
    };
    prisma.shopOrder.findMany.mockResolvedValue([staleOrder] as any);
    prisma.shopOrder.updateMany.mockResolvedValue({ count: 1 });
    prisma.shopItem.updateMany.mockResolvedValue({ count: 1 });

    await service.cleanupPendingOrders();

    expect(prisma.shopOrder.updateMany).toHaveBeenCalledWith({
      where: { id: 'order-1', status: 'PENDING' },
      data: { status: 'CANCELLED' },
    });
    expect(prisma.shopItem.updateMany).toHaveBeenCalledWith({
      where: { id: 'item-1' },
      data: { stock: { increment: 2 } },
    });
  });
});
```

**Step 2: Run test to verify it fails**

```bash
yarn test -- --testPathPattern=shop -t "cleanupPendingOrders"
```

**Step 3: Add `cleanupPendingOrders` to `ShopService`**

Add the import at the top:
```typescript
import { Cron, CronExpression } from '@nestjs/schedule';
```

Add the method:
```typescript
@Cron(CronExpression.EVERY_HOUR, { timeZone: 'Africa/Nairobi' })
async cleanupPendingOrders() {
  const cutoff = new Date(Date.now() - 60 * 60 * 1000);

  const staleOrders = await this.prisma.shopOrder.findMany({
    where: {
      status: 'PENDING',
      createdAt: { lt: cutoff },
    },
    include: { orderItems: true },
  });

  for (const order of staleOrders) {
    const result = await this.prisma.shopOrder.updateMany({
      where: { id: order.id, status: 'PENDING' },
      data: { status: 'CANCELLED' },
    });

    if (result.count === 0) continue; // already claimed by another process

    // Restore stock for each line item
    for (const item of order.orderItems) {
      if (item.variantId) {
        await this.prisma.shopItemVariant.updateMany({
          where: { id: item.variantId },
          data: { stock: { increment: item.quantity } },
        });
      } else {
        await this.prisma.shopItem.updateMany({
          where: { id: item.shopItemId },
          data: { stock: { increment: item.quantity } },
        });
      }
    }

    this.logger.log(`Cancelled stale shop order ${order.id} and restored stock`);
  }
}
```

**Step 4: Run tests**

```bash
yarn test -- --testPathPattern=shop
```

Expected: all pass.

**Step 5: Run lint + typecheck + commit**

```bash
yarn lint && yarn tsc --noEmit
git add src/shop/
git commit -m "feat(shop): hourly cron to cancel stale PENDING orders and restore stock"
```

---

### Task 12: Low-stock email notification

**Files:**
- Create: `src/email/templates/shop-low-stock.hbs`
- Modify: `src/shop/shop.service.ts`
- Modify: `src/shop/shop.service.spec.ts`

**Step 1: Create `src/email/templates/shop-low-stock.hbs`**

```handlebars
{{> header}}
<table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;background:#ffffff;">
  <tr>
    <td style="padding:32px 24px;">
      <h2 style="margin:0 0 16px;font-family:sans-serif;font-size:20px;color:#121212;">Shop Item Out of Stock</h2>
      <p style="margin:0 0 12px;font-family:sans-serif;font-size:16px;color:#333333;">
        The following item has run out of stock:
      </p>
      <p style="margin:0 0 24px;font-family:sans-serif;font-size:18px;font-weight:bold;color:#121212;">
        {{itemName}}{{#if variantName}} — {{variantName}}{{/if}}
      </p>
      <p style="margin:0;font-family:sans-serif;font-size:14px;color:#666666;">
        Please restock this item in the admin dashboard.
      </p>
    </td>
  </tr>
</table>
{{> footer}}
```

**Step 2: Write failing test**

```typescript
describe('checkAndNotifyLowStock', () => {
  it('should email admins when item stock reaches zero', async () => {
    prisma.shopItem.findUnique.mockResolvedValue({
      ...mockItem,
      stock: 0,
      variants: [],
    } as any);
    prisma.user.findMany.mockResolvedValue([
      { id: 'admin-1', email: 'admin@gym.com', firstName: 'Admin' },
    ] as any);

    const emailService: DeepMockProxy<EmailService> = module.get(EmailService);
    emailService.sendEmail.mockResolvedValue(undefined as any);

    await (service as any).checkAndNotifyLowStock([
      { shopItemId: 'item-1', variantId: null, quantity: 1 },
    ]);

    expect(emailService.sendEmail).toHaveBeenCalledWith(
      'admin@gym.com',
      expect.stringContaining('Out of Stock'),
      'shop-low-stock',
      expect.objectContaining({ itemName: 'Protein Shake' }),
    );
  });
});
```

**Step 3: Run test to verify it fails**

```bash
yarn test -- --testPathPattern=shop -t "checkAndNotifyLowStock"
```

**Step 4: Add `checkAndNotifyLowStock` to `ShopService`**

```typescript
private async checkAndNotifyLowStock(
  orderItems: Array<{ shopItemId: string; variantId: string | null; quantity: number }>,
) {
  for (const line of orderItems) {
    try {
      if (line.variantId) {
        const variant = await this.prisma.shopItemVariant.findUnique({
          where: { id: line.variantId },
          include: { item: true },
        });
        if (variant && variant.stock === 0) {
          await this.notifyAdminsLowStock(variant.item.name, variant.name);
        }
      } else {
        const item = await this.prisma.shopItem.findUnique({
          where: { id: line.shopItemId },
        });
        if (item && item.stock === 0) {
          await this.notifyAdminsLowStock(item.name);
        }
      }
    } catch (err) {
      this.logger.error(
        `Failed to check low stock for item ${line.shopItemId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

private async notifyAdminsLowStock(itemName: string, variantName?: string) {
  const admins = await this.prisma.user.findMany({
    where: {
      role: { in: ['ADMIN', 'SUPER_ADMIN'] },
      deletedAt: null,
    },
    select: { email: true, firstName: true },
  });

  const subject = `Shop Item Out of Stock: ${itemName}${variantName ? ` — ${variantName}` : ''}`;

  for (const admin of admins) {
    this.emailService
      .sendEmail(admin.email, subject, 'shop-low-stock', {
        itemName,
        variantName: variantName ?? null,
        firstName: admin.firstName,
      })
      .catch((err) =>
        this.logger.error(`Failed to send low-stock email to ${admin.email}: ${err.message}`),
      );
  }
}
```

**Step 5: Run all shop tests**

```bash
yarn test -- --testPathPattern=shop
```

Expected: all pass.

**Step 6: Run full test suite + lint + typecheck**

```bash
yarn test && yarn lint && yarn tsc --noEmit
```

Expected: all green.

**Step 7: Commit**

```bash
git add src/shop/ src/email/templates/
git commit -m "feat(shop): low-stock email notification to admins"
```

---

### Final: Wire up + smoke test

**Step 1: Start dev server**

```bash
yarn start:dev
```

Expected: server starts on port 3000, no errors.

**Step 2: Verify Swagger**

Open `http://localhost:3000/api/docs` — confirm `Shop` tag appears with all endpoints listed.

**Step 3: Run full test suite one last time**

```bash
yarn test && yarn lint && yarn tsc --noEmit
```

Expected: all green.

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat(shop): complete shop module implementation"
```
