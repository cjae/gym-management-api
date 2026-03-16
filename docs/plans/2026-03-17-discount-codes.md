# Discount Codes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a discount code system for promotional campaigns and targeted member retention, applying one-time discounts to subscription first payments.

**Architecture:** New `discount-codes/` module (controller → service → Prisma). Two new Prisma models (`DiscountCode`, `DiscountRedemption`) plus two fields on `MemberSubscription`. Discount validation and application happen at subscription creation time. Payment initialization reads the stored discounted amount.

**Tech Stack:** NestJS 11, Prisma 6, PostgreSQL, Jest + jest-mock-extended

---

### Task 1: Prisma Schema — Add DiscountCode and DiscountRedemption models

**Files:**
- Modify: `prisma/schema.prisma`

**Step 1: Add the DiscountType enum and models to the schema**

Add after the existing enums (after line ~58):

```prisma
enum DiscountType {
  PERCENTAGE
  FIXED
}
```

Add the DiscountCode and DiscountRedemption models (after the Banner models, near end of file):

```prisma
model DiscountCode {
  id               String       @id @default(uuid())
  code             String       @unique
  description      String?
  discountType     DiscountType
  discountValue    Float
  maxUses          Int?
  maxUsesPerMember Int          @default(1)
  currentUses      Int          @default(0)
  startDate        DateTime
  endDate          DateTime
  isActive         Boolean      @default(true)
  createdAt        DateTime     @default(now())
  updatedAt        DateTime     @updatedAt

  plans       DiscountCodePlan[]
  redemptions DiscountRedemption[]
  subscriptions MemberSubscription[]
}

model DiscountCodePlan {
  id             String @id @default(uuid())
  discountCodeId String
  planId         String

  discountCode DiscountCode     @relation(fields: [discountCodeId], references: [id], onDelete: Cascade)
  plan         SubscriptionPlan @relation(fields: [planId], references: [id], onDelete: Cascade)

  @@unique([discountCodeId, planId])
}

model DiscountRedemption {
  id              String   @id @default(uuid())
  discountCodeId  String
  memberId        String
  subscriptionId  String
  originalAmount  Float
  discountedAmount Float
  createdAt       DateTime @default(now())

  discountCode DiscountCode       @relation(fields: [discountCodeId], references: [id])
  member       User               @relation("UserDiscountRedemptions", fields: [memberId], references: [id])
  subscription MemberSubscription @relation(fields: [subscriptionId], references: [id])

  @@unique([discountCodeId, memberId, subscriptionId])
  @@index([discountCodeId])
  @@index([memberId])
}
```

**Step 2: Add fields to MemberSubscription**

Add to the `MemberSubscription` model (after `createdBy` field, line ~185):

```prisma
  discountCodeId String?
  discountAmount Float?
```

Add the relation (after the existing relations):

```prisma
  discountCode  DiscountCode? @relation(fields: [discountCodeId], references: [id])
```

**Step 3: Add relation to SubscriptionPlan**

Add to the `SubscriptionPlan` model (after `subscriptions` relation):

```prisma
  discountCodePlans DiscountCodePlan[]
```

**Step 4: Add relation to User**

Add to the `User` model (in the relations section):

```prisma
  discountRedemptions DiscountRedemption[] @relation("UserDiscountRedemptions")
```

**Step 5: Run the migration**

Run: `npx prisma migrate dev --name add-discount-codes`

Expected: Migration created and applied successfully. Prisma client regenerated.

**Step 6: Commit**

```bash
git add prisma/
git commit -m "feat(discount-codes): add schema for DiscountCode, DiscountRedemption, and DiscountCodePlan"
```

---

### Task 2: Discount Codes Module — DTOs

**Files:**
- Create: `src/discount-codes/dto/create-discount-code.dto.ts`
- Create: `src/discount-codes/dto/update-discount-code.dto.ts`
- Create: `src/discount-codes/dto/validate-discount-code.dto.ts`

**Step 1: Create the create DTO**

```typescript
// src/discount-codes/dto/create-discount-code.dto.ts
import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsNumber,
  IsOptional,
  IsInt,
  IsBoolean,
  IsDateString,
  IsArray,
  IsUUID,
  MaxLength,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DiscountType } from '@prisma/client';

export class CreateDiscountCodeDto {
  @ApiProperty({ example: 'NEWYEAR25' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(12)
  code: string;

  @ApiPropertyOptional({ example: 'New Year 2026 promotion' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({ enum: DiscountType, example: 'PERCENTAGE' })
  @IsEnum(DiscountType)
  discountType: DiscountType;

  @ApiProperty({ example: 20 })
  @IsNumber()
  @Min(1)
  discountValue: number;

  @ApiPropertyOptional({ example: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxUses?: number;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxUsesPerMember?: number;

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  @IsDateString()
  startDate: string;

  @ApiProperty({ example: '2026-01-31T23:59:59.000Z' })
  @IsDateString()
  endDate: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ example: ['plan-uuid-1', 'plan-uuid-2'] })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  planIds?: string[];
}
```

**Step 2: Create the update DTO**

```typescript
// src/discount-codes/dto/update-discount-code.dto.ts
import {
  IsString,
  IsOptional,
  IsInt,
  IsBoolean,
  IsDateString,
  IsArray,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateDiscountCodeDto {
  @ApiPropertyOptional({ example: 'Updated promotion description' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ example: 200 })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxUses?: number;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxUsesPerMember?: number;

  @ApiPropertyOptional({ example: '2026-02-28T23:59:59.000Z' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ example: '2026-02-28T23:59:59.000Z' })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ example: ['plan-uuid-1'] })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  planIds?: string[];
}
```

Note: `code`, `discountType`, and `discountValue` are intentionally excluded — these are immutable after creation. Admin must create a new code if they want different discount parameters.

**Step 3: Create the validate DTO**

```typescript
// src/discount-codes/dto/validate-discount-code.dto.ts
import { IsString, IsNotEmpty, IsUUID, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ValidateDiscountCodeDto {
  @ApiProperty({ example: 'NEWYEAR25' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(12)
  code: string;

  @ApiProperty({ example: 'plan-uuid' })
  @IsUUID()
  planId: string;
}
```

**Step 4: Commit**

```bash
git add src/discount-codes/
git commit -m "feat(discount-codes): add DTOs for create, update, and validate"
```

---

### Task 3: Discount Codes Service — Core CRUD and Validation

**Files:**
- Create: `src/discount-codes/discount-codes.service.ts`

**Step 1: Write the service with all methods**

```typescript
// src/discount-codes/discount-codes.service.ts
import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDiscountCodeDto } from './dto/create-discount-code.dto';
import { UpdateDiscountCodeDto } from './dto/update-discount-code.dto';
import { DiscountType } from '@prisma/client';

const PAYSTACK_MIN_KES = 50;

@Injectable()
export class DiscountCodesService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateDiscountCodeDto) {
    const code = dto.code.toUpperCase().trim();

    if (code.length < 3) {
      throw new BadRequestException('Code must be at least 3 characters');
    }

    const existing = await this.prisma.discountCode.findUnique({
      where: { code },
    });
    if (existing) {
      throw new BadRequestException(`Discount code "${code}" already exists`);
    }

    if (dto.discountType === DiscountType.PERCENTAGE && dto.discountValue > 100) {
      throw new BadRequestException('Percentage discount cannot exceed 100');
    }

    if (new Date(dto.endDate) <= new Date(dto.startDate)) {
      throw new BadRequestException('End date must be after start date');
    }

    // Validate plan IDs if provided
    if (dto.planIds?.length) {
      const plans = await this.prisma.subscriptionPlan.findMany({
        where: { id: { in: dto.planIds } },
        select: { id: true },
      });
      if (plans.length !== dto.planIds.length) {
        throw new BadRequestException('One or more plan IDs are invalid');
      }
    }

    return this.prisma.discountCode.create({
      data: {
        code,
        description: dto.description,
        discountType: dto.discountType,
        discountValue: dto.discountValue,
        maxUses: dto.maxUses,
        maxUsesPerMember: dto.maxUsesPerMember ?? 1,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
        isActive: dto.isActive ?? true,
        plans: dto.planIds?.length
          ? { create: dto.planIds.map((planId) => ({ planId })) }
          : undefined,
      },
      include: { plans: { include: { plan: true } } },
    });
  }

  async findAll(page: number = 1, limit: number = 20, filter?: string) {
    const where: any = {};
    const now = new Date();

    if (filter === 'active') {
      where.isActive = true;
      where.endDate = { gte: now };
    } else if (filter === 'expired') {
      where.endDate = { lt: now };
    } else if (filter === 'inactive') {
      where.isActive = false;
    }

    const [data, total] = await Promise.all([
      this.prisma.discountCode.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { plans: { include: { plan: true } } },
      }),
      this.prisma.discountCode.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const code = await this.prisma.discountCode.findUnique({
      where: { id },
      include: {
        plans: { include: { plan: true } },
        _count: { select: { redemptions: true } },
      },
    });
    if (!code) {
      throw new NotFoundException(`Discount code with id ${id} not found`);
    }
    return code;
  }

  async update(id: string, dto: UpdateDiscountCodeDto) {
    const existing = await this.findOne(id);

    // Reject updates on expired codes
    if (new Date(existing.endDate) < new Date()) {
      throw new BadRequestException(
        'Cannot update an expired discount code. Create a new one instead.',
      );
    }

    if (dto.endDate && dto.startDate && new Date(dto.endDate) <= new Date(dto.startDate)) {
      throw new BadRequestException('End date must be after start date');
    }
    if (dto.endDate && !dto.startDate && new Date(dto.endDate) <= new Date(existing.startDate)) {
      throw new BadRequestException('End date must be after start date');
    }

    // Validate plan IDs if provided
    if (dto.planIds?.length) {
      const plans = await this.prisma.subscriptionPlan.findMany({
        where: { id: { in: dto.planIds } },
        select: { id: true },
      });
      if (plans.length !== dto.planIds.length) {
        throw new BadRequestException('One or more plan IDs are invalid');
      }
    }

    // Build update data (exclude planIds from direct data)
    const { planIds, startDate, endDate, ...rest } = dto;
    const data: any = { ...rest };
    if (startDate) data.startDate = new Date(startDate);
    if (endDate) data.endDate = new Date(endDate);

    // If planIds provided, replace all plan associations
    if (planIds !== undefined) {
      await this.prisma.discountCodePlan.deleteMany({
        where: { discountCodeId: id },
      });
      if (planIds.length > 0) {
        await this.prisma.discountCodePlan.createMany({
          data: planIds.map((planId) => ({ discountCodeId: id, planId })),
        });
      }
    }

    return this.prisma.discountCode.update({
      where: { id },
      data,
      include: { plans: { include: { plan: true } } },
    });
  }

  async deactivate(id: string) {
    await this.findOne(id);
    return this.prisma.discountCode.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async getRedemptions(id: string, page: number = 1, limit: number = 20) {
    await this.findOne(id);

    const [data, total] = await Promise.all([
      this.prisma.discountRedemption.findMany({
        where: { discountCodeId: id },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          member: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
        },
      }),
      this.prisma.discountRedemption.count({ where: { discountCodeId: id } }),
    ]);

    return { data, total, page, limit };
  }

  /**
   * Validates a discount code for a given plan and member.
   * Returns the discount details if valid, throws if invalid.
   */
  async validateCode(
    code: string,
    planId: string,
    memberId: string,
  ): Promise<{
    discountCode: { id: string; discountType: DiscountType; discountValue: number };
    finalPrice: number;
    originalPrice: number;
  }> {
    const upperCode = code.toUpperCase().trim();

    // 1. Code exists
    const discountCode = await this.prisma.discountCode.findUnique({
      where: { code: upperCode },
      include: { plans: true },
    });
    if (!discountCode) {
      throw new BadRequestException('Invalid discount code');
    }

    // 2. Code is active
    if (!discountCode.isActive) {
      throw new BadRequestException('This discount code is no longer active');
    }

    // 3. Within date window
    const now = new Date();
    if (now < new Date(discountCode.startDate)) {
      throw new BadRequestException('This discount code is not yet valid');
    }
    if (now > new Date(discountCode.endDate)) {
      throw new BadRequestException('This discount code has expired');
    }

    // 4. Global usage cap
    if (
      discountCode.maxUses !== null &&
      discountCode.currentUses >= discountCode.maxUses
    ) {
      throw new BadRequestException('This discount code has reached its usage limit');
    }

    // 5. Per-member cap
    const memberUses = await this.prisma.discountRedemption.count({
      where: { discountCodeId: discountCode.id, memberId },
    });
    if (memberUses >= discountCode.maxUsesPerMember) {
      throw new BadRequestException(
        'You have already used this discount code the maximum number of times',
      );
    }

    // 6. Plan restriction
    if (discountCode.plans.length > 0) {
      const validPlan = discountCode.plans.some((p) => p.planId === planId);
      if (!validPlan) {
        throw new BadRequestException(
          'This discount code is not valid for the selected plan',
        );
      }
    }

    // 7. Calculate final price
    const plan = await this.prisma.subscriptionPlan.findUnique({
      where: { id: planId },
    });
    if (!plan) {
      throw new BadRequestException('Plan not found');
    }

    let finalPrice: number;
    if (discountCode.discountType === DiscountType.PERCENTAGE) {
      finalPrice = Math.round(plan.price - (plan.price * discountCode.discountValue) / 100);
    } else {
      finalPrice = plan.price - discountCode.discountValue;
    }

    // Sanity checks
    if (discountCode.discountType === DiscountType.FIXED && discountCode.discountValue >= plan.price) {
      throw new BadRequestException(
        'Discount amount exceeds the plan price',
      );
    }
    if (finalPrice < PAYSTACK_MIN_KES) {
      throw new BadRequestException(
        `Discounted price (${finalPrice} KES) is below the minimum charge of ${PAYSTACK_MIN_KES} KES`,
      );
    }

    return {
      discountCode: {
        id: discountCode.id,
        discountType: discountCode.discountType,
        discountValue: discountCode.discountValue,
      },
      finalPrice,
      originalPrice: plan.price,
    };
  }

  /**
   * Records a redemption and increments usage count.
   * Uses conditional update for race-condition safety on global cap.
   * Call this inside a Prisma transaction.
   */
  async redeemCode(
    tx: any,
    discountCodeId: string,
    memberId: string,
    subscriptionId: string,
    originalAmount: number,
    discountedAmount: number,
    maxUses: number | null,
  ) {
    // Conditional increment for race safety
    const updateResult = await tx.discountCode.updateMany({
      where: {
        id: discountCodeId,
        ...(maxUses !== null ? { currentUses: { lt: maxUses } } : {}),
      },
      data: { currentUses: { increment: 1 } },
    });

    if (updateResult.count === 0) {
      throw new BadRequestException('This discount code has reached its usage limit');
    }

    await tx.discountRedemption.create({
      data: {
        discountCodeId,
        memberId,
        subscriptionId,
        originalAmount,
        discountedAmount,
      },
    });
  }

  /**
   * Reverses a redemption (used when PENDING subscription is cleaned up).
   */
  async reverseRedemption(tx: any, subscriptionId: string) {
    const redemption = await tx.discountRedemption.findFirst({
      where: { subscriptionId },
    });
    if (!redemption) return;

    await tx.discountRedemption.delete({
      where: { id: redemption.id },
    });
    await tx.discountCode.update({
      where: { id: redemption.discountCodeId },
      data: { currentUses: { decrement: 1 } },
    });
  }
}
```

**Step 2: Commit**

```bash
git add src/discount-codes/
git commit -m "feat(discount-codes): add service with CRUD, validation, redemption, and reversal"
```

---

### Task 4: Discount Codes Controller

**Files:**
- Create: `src/discount-codes/discount-codes.controller.ts`

**Step 1: Write the controller**

```typescript
// src/discount-codes/discount-codes.controller.ts
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
  ApiResponse,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { DiscountCodesService } from './discount-codes.service';
import { CreateDiscountCodeDto } from './dto/create-discount-code.dto';
import { UpdateDiscountCodeDto } from './dto/update-discount-code.dto';
import { ValidateDiscountCodeDto } from './dto/validate-discount-code.dto';

@ApiTags('Discount Codes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('discount-codes')
export class DiscountCodesController {
  constructor(private readonly discountCodesService: DiscountCodesService) {}

  @Post()
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiResponse({ status: 201, description: 'Discount code created' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  create(@Body() dto: CreateDiscountCodeDto) {
    return this.discountCodesService.create(dto);
  }

  @Get()
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiQuery({ name: 'filter', required: false, enum: ['active', 'expired', 'inactive'] })
  @ApiResponse({ status: 200, description: 'Paginated list of discount codes' })
  findAll(
    @Query() { page, limit }: PaginationQueryDto,
    @Query('filter') filter?: string,
  ) {
    return this.discountCodesService.findAll(page, limit, filter);
  }

  @Get(':id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiResponse({ status: 200, description: 'Discount code details' })
  @ApiResponse({ status: 404, description: 'Not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.discountCodesService.findOne(id);
  }

  @Patch(':id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiResponse({ status: 200, description: 'Discount code updated' })
  @ApiResponse({ status: 400, description: 'Cannot update expired code' })
  @ApiResponse({ status: 404, description: 'Not found' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDiscountCodeDto,
  ) {
    return this.discountCodesService.update(id, dto);
  }

  @Delete(':id')
  @Roles('SUPER_ADMIN')
  @ApiResponse({ status: 200, description: 'Discount code deactivated' })
  @ApiResponse({ status: 404, description: 'Not found' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.discountCodesService.deactivate(id);
  }

  @Get(':id/redemptions')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiResponse({ status: 200, description: 'Paginated redemptions' })
  @ApiResponse({ status: 404, description: 'Not found' })
  getRedemptions(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() { page, limit }: PaginationQueryDto,
  ) {
    return this.discountCodesService.getRedemptions(id, page, limit);
  }

  @Post('validate')
  @ApiResponse({ status: 200, description: 'Code is valid' })
  @ApiResponse({ status: 400, description: 'Code is invalid' })
  validate(
    @Body() dto: ValidateDiscountCodeDto,
    @CurrentUser() user: any,
  ) {
    return this.discountCodesService.validateCode(dto.code, dto.planId, user.id);
  }
}
```

**Step 2: Commit**

```bash
git add src/discount-codes/
git commit -m "feat(discount-codes): add controller with CRUD, redemptions, and validate endpoints"
```

---

### Task 5: Discount Codes Module — Wire Up

**Files:**
- Create: `src/discount-codes/discount-codes.module.ts`
- Modify: `src/app.module.ts`

**Step 1: Create the module**

```typescript
// src/discount-codes/discount-codes.module.ts
import { Module } from '@nestjs/common';
import { DiscountCodesService } from './discount-codes.service';
import { DiscountCodesController } from './discount-codes.controller';

@Module({
  controllers: [DiscountCodesController],
  providers: [DiscountCodesService],
  exports: [DiscountCodesService],
})
export class DiscountCodesModule {}
```

**Step 2: Register in AppModule**

In `src/app.module.ts`, add the import:

```typescript
import { DiscountCodesModule } from './discount-codes/discount-codes.module';
```

Add `DiscountCodesModule` to the `imports` array (after `ImportsModule`).

**Step 3: Verify the app compiles**

Run: `yarn build`

Expected: Build succeeds with no errors.

**Step 4: Commit**

```bash
git add src/discount-codes/ src/app.module.ts
git commit -m "feat(discount-codes): wire up module in AppModule"
```

---

### Task 6: Integrate Discount Codes into Member Subscription Creation

**Files:**
- Modify: `src/subscriptions/dto/create-subscription.dto.ts`
- Modify: `src/subscriptions/subscriptions.module.ts`
- Modify: `src/subscriptions/subscriptions.service.ts`

**Step 1: Add discountCode to CreateSubscriptionDto**

In `src/subscriptions/dto/create-subscription.dto.ts`, add:

```typescript
import { IsOptional, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
```

Add field to the class:

```typescript
  @ApiPropertyOptional({ example: 'NEWYEAR25' })
  @IsOptional()
  @IsString()
  @MaxLength(12)
  discountCode?: string;
```

**Step 2: Import DiscountCodesModule in SubscriptionsModule**

In `src/subscriptions/subscriptions.module.ts`, add:

```typescript
import { DiscountCodesModule } from '../discount-codes/discount-codes.module';
```

Add `DiscountCodesModule` to the `imports` array.

**Step 3: Inject DiscountCodesService into SubscriptionsService**

In `src/subscriptions/subscriptions.service.ts`, add to constructor:

```typescript
import { DiscountCodesService } from '../discount-codes/discount-codes.service';

// In constructor:
constructor(
  private prisma: PrismaService,
  private eventEmitter: EventEmitter2,
  private discountCodesService: DiscountCodesService,
) {}
```

**Step 4: Modify the `create` method**

After validating the plan and checking for active subscription (around line 75, before the `const startDate = new Date()` line), add discount validation:

```typescript
    // Validate discount code if provided
    let discountResult: {
      discountCode: { id: string; discountType: string; discountValue: number };
      finalPrice: number;
      originalPrice: number;
    } | null = null;

    if (dto.discountCode) {
      discountResult = await this.discountCodesService.validateCode(
        dto.discountCode,
        dto.planId,
        memberId,
      );
    }

    const discountCodeId = discountResult?.discountCode.id ?? null;
    const discountAmount = discountResult
      ? discountResult.originalPrice - discountResult.finalPrice
      : null;
```

Then modify the subscription create/update data to include discount fields. In the `create` branch (inside `this.prisma.memberSubscription.create`), add to `data`:

```typescript
          discountCodeId,
          discountAmount,
```

In the `update` branch (existing PENDING subscription), add to `data`:

```typescript
          discountCodeId,
          discountAmount,
```

After the subscription is created/updated but before the event emit, add the redemption inside a transaction. Since the current code doesn't use a transaction for member-created subscriptions, wrap the create + redeem in one:

Replace the non-transactional create/update with a `$transaction` block:

```typescript
    const include = { plan: true, members: true } as const;

    const subscription = await this.prisma.$transaction(async (tx) => {
      const sub = existingPending
        ? await tx.memberSubscription.update({
            where: { id: existingPending.id },
            data: {
              planId: dto.planId,
              startDate,
              endDate,
              paymentMethod: dto.paymentMethod,
              nextBillingDate: endDate,
              discountCodeId,
              discountAmount,
            },
            include,
          })
        : await tx.memberSubscription.create({
            data: {
              primaryMemberId: memberId,
              planId: dto.planId,
              startDate,
              endDate,
              status: SubscriptionStatus.PENDING,
              paymentMethod: dto.paymentMethod,
              nextBillingDate: endDate,
              discountCodeId,
              discountAmount,
              members: {
                create: { memberId },
              },
            },
            include,
          });

      // Record discount redemption if a code was used
      if (discountResult) {
        await this.discountCodesService.redeemCode(
          tx,
          discountResult.discountCode.id,
          memberId,
          sub.id,
          discountResult.originalPrice,
          discountResult.finalPrice,
          null, // maxUses already validated; race-safe increment handles it
        );
      }

      return sub;
    });
```

Note: Pass the actual `maxUses` from the discount code to `redeemCode`. Update the call:

```typescript
        await this.discountCodesService.redeemCode(
          tx,
          discountResult.discountCode.id,
          memberId,
          sub.id,
          discountResult.originalPrice,
          discountResult.finalPrice,
          // Need to pass maxUses — add it to validateCode return
        );
```

To make this clean, update `validateCode` return type to also include `maxUses`:

In `discount-codes.service.ts`, change the return in `validateCode` to:

```typescript
    return {
      discountCode: {
        id: discountCode.id,
        discountType: discountCode.discountType,
        discountValue: discountCode.discountValue,
        maxUses: discountCode.maxUses,
      },
      finalPrice,
      originalPrice: plan.price,
    };
```

Then in the subscription service:

```typescript
        await this.discountCodesService.redeemCode(
          tx,
          discountResult.discountCode.id,
          memberId,
          sub.id,
          discountResult.originalPrice,
          discountResult.finalPrice,
          discountResult.discountCode.maxUses,
        );
```

**Step 5: Commit**

```bash
git add src/subscriptions/ src/discount-codes/
git commit -m "feat(discount-codes): integrate discount validation into member subscription creation"
```

---

### Task 7: Integrate Discount Codes into Admin Subscription Creation

**Files:**
- Modify: `src/subscriptions/dto/admin-create-subscription.dto.ts`
- Modify: `src/subscriptions/subscriptions.service.ts` (adminCreate method, line 124)

**Step 1: Add discountCode to AdminCreateSubscriptionDto**

```typescript
  @ApiPropertyOptional({ example: 'RETENTION50' })
  @IsOptional()
  @IsString()
  @MaxLength(12)
  discountCode?: string;
```

**Step 2: Modify adminCreate method**

After the plan validation and before `const amount = ...` (around line 176), add:

```typescript
    // Validate discount code if provided (skip for COMPLIMENTARY)
    let discountResult: any = null;
    if (dto.discountCode && dto.paymentMethod !== AdminPaymentMethod.COMPLIMENTARY) {
      discountResult = await this.discountCodesService.validateCode(
        dto.discountCode,
        dto.planId,
        dto.memberId,
      );
    }

    const discountCodeId = discountResult?.discountCode.id ?? null;
    const discountAmountValue = discountResult
      ? discountResult.originalPrice - discountResult.finalPrice
      : null;
```

Modify the amount calculation:

```typescript
    const amount =
      dto.paymentMethod === AdminPaymentMethod.COMPLIMENTARY
        ? 0
        : discountResult
          ? discountResult.finalPrice
          : plan.price;
```

Add `discountCodeId` and `discountAmount: discountAmountValue` to `txData`.

Inside the `$transaction`, after the payment creation and before `return sub`, add:

```typescript
      if (discountResult) {
        await this.discountCodesService.redeemCode(
          tx,
          discountResult.discountCode.id,
          dto.memberId,
          sub.id,
          discountResult.originalPrice,
          discountResult.finalPrice,
          discountResult.discountCode.maxUses,
        );
      }
```

**Step 3: Commit**

```bash
git add src/subscriptions/
git commit -m "feat(discount-codes): integrate discount codes into admin subscription creation"
```

---

### Task 8: Modify Payment Initialization to Use Discounted Amount

**Files:**
- Modify: `src/payments/payments.service.ts` (initializePayment method, line 79)

**Step 1: Change amount calculation**

In `initializePayment`, change the payment creation and Paystack call to use the discounted price.

Replace (line ~113):
```typescript
      amount: subscription.plan.price,
```
with:
```typescript
      amount: subscription.plan.price - (subscription.discountAmount ?? 0),
```

Replace in the Paystack API call (line ~119):
```typescript
      amount: subscription.plan.price * 100,
```
with:
```typescript
      amount: (subscription.plan.price - (subscription.discountAmount ?? 0)) * 100,
```

**Step 2: Commit**

```bash
git add src/payments/
git commit -m "feat(discount-codes): use discounted amount in payment initialization"
```

---

### Task 9: Modify PENDING Subscription Cleanup to Reverse Redemptions

**Files:**
- Modify: `src/subscriptions/subscriptions.service.ts` (cleanupPendingSubscriptions method, line ~682)

**Step 1: Add discount redemption reversal to cleanup**

The cleanup method currently deletes payments, subscription members, and subscriptions in a transaction. Add redemption reversal before the deletes.

Modify the `$transaction` block to:

```typescript
    await this.prisma.$transaction(async (tx) => {
      // Reverse discount redemptions for stale subscriptions
      for (const sub of staleSubscriptions) {
        await this.discountCodesService.reverseRedemption(tx, sub.id);
      }

      await tx.payment.deleteMany({
        where: { subscriptionId: { in: ids } },
      });
      await tx.discountRedemption.deleteMany({
        where: { subscriptionId: { in: ids } },
      });
      await tx.subscriptionMember.deleteMany({
        where: { subscriptionId: { in: ids } },
      });
      await tx.memberSubscription.deleteMany({
        where: { id: { in: ids } },
      });
    });
```

Note: `reverseRedemption` decrements `currentUses` first, then we also delete the redemption records. Actually, `reverseRedemption` already deletes the record and decrements. So we can simplify — just call `reverseRedemption` for each, and remove the separate `discountRedemption.deleteMany`:

```typescript
    await this.prisma.$transaction(async (tx) => {
      // Reverse discount redemptions (decrements currentUses and deletes records)
      for (const sub of staleSubscriptions) {
        await this.discountCodesService.reverseRedemption(tx, sub.id);
      }

      await tx.payment.deleteMany({
        where: { subscriptionId: { in: ids } },
      });
      await tx.subscriptionMember.deleteMany({
        where: { subscriptionId: { in: ids } },
      });
      await tx.memberSubscription.deleteMany({
        where: { id: { in: ids } },
      });
    });
```

Note: The current cleanup uses `this.prisma.$transaction([...])` (array form). Convert to the interactive form `this.prisma.$transaction(async (tx) => { ... })` to support the loop.

**Step 2: Commit**

```bash
git add src/subscriptions/
git commit -m "feat(discount-codes): reverse redemptions on PENDING subscription cleanup"
```

---

### Task 10: Unit Tests — Discount Codes Service

**Files:**
- Create: `src/discount-codes/discount-codes.service.spec.ts`

**Step 1: Write tests for the service**

```typescript
// src/discount-codes/discount-codes.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaClient, DiscountType } from '@prisma/client';
import { DiscountCodesService } from './discount-codes.service';
import { PrismaService } from '../prisma/prisma.service';

describe('DiscountCodesService', () => {
  let service: DiscountCodesService;
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DiscountCodesService,
        { provide: PrismaService, useValue: mockDeep<PrismaClient>() },
      ],
    }).compile();
    service = module.get<DiscountCodesService>(DiscountCodesService);
    prisma = module.get(PrismaService);
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create a discount code', async () => {
      const dto = {
        code: 'NEWYEAR25',
        discountType: DiscountType.PERCENTAGE,
        discountValue: 25,
        startDate: '2026-01-01T00:00:00Z',
        endDate: '2026-01-31T23:59:59Z',
      };
      const created = { id: 'dc-1', ...dto, currentUses: 0, isActive: true, plans: [] };
      prisma.discountCode.findUnique.mockResolvedValue(null);
      prisma.discountCode.create.mockResolvedValue(created as any);

      const result = await service.create(dto);
      expect(result).toEqual(created);
      expect(prisma.discountCode.create).toHaveBeenCalled();
    });

    it('should reject duplicate code', async () => {
      prisma.discountCode.findUnique.mockResolvedValue({ id: 'dc-1' } as any);
      await expect(
        service.create({
          code: 'DUPE',
          discountType: DiscountType.PERCENTAGE,
          discountValue: 10,
          startDate: '2026-01-01T00:00:00Z',
          endDate: '2026-01-31T23:59:59Z',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject percentage > 100', async () => {
      prisma.discountCode.findUnique.mockResolvedValue(null);
      await expect(
        service.create({
          code: 'TOOMUCH',
          discountType: DiscountType.PERCENTAGE,
          discountValue: 150,
          startDate: '2026-01-01T00:00:00Z',
          endDate: '2026-01-31T23:59:59Z',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject endDate before startDate', async () => {
      prisma.discountCode.findUnique.mockResolvedValue(null);
      await expect(
        service.create({
          code: 'BADDATE',
          discountType: DiscountType.FIXED,
          discountValue: 500,
          startDate: '2026-02-01T00:00:00Z',
          endDate: '2026-01-01T00:00:00Z',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findOne', () => {
    it('should return a discount code by id', async () => {
      const code = { id: 'dc-1', code: 'TEST', plans: [], _count: { redemptions: 5 } };
      prisma.discountCode.findUnique.mockResolvedValue(code as any);
      const result = await service.findOne('dc-1');
      expect(result).toEqual(code);
    });

    it('should throw NotFoundException for missing code', async () => {
      prisma.discountCode.findUnique.mockResolvedValue(null);
      await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('should reject updates on expired codes', async () => {
      const expired = {
        id: 'dc-1',
        endDate: new Date('2025-01-01'),
        startDate: new Date('2024-12-01'),
        plans: [],
        _count: { redemptions: 0 },
      };
      prisma.discountCode.findUnique.mockResolvedValue(expired as any);
      await expect(
        service.update('dc-1', { description: 'nope' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should allow updates on inactive but non-expired codes', async () => {
      const inactive = {
        id: 'dc-1',
        endDate: new Date('2027-01-01'),
        startDate: new Date('2026-01-01'),
        isActive: false,
        plans: [],
        _count: { redemptions: 0 },
      };
      prisma.discountCode.findUnique.mockResolvedValue(inactive as any);
      prisma.discountCode.update.mockResolvedValue({ ...inactive, isActive: true } as any);
      const result = await service.update('dc-1', { isActive: true });
      expect(result.isActive).toBe(true);
    });
  });

  describe('validateCode', () => {
    const validCode = {
      id: 'dc-1',
      code: 'VALID20',
      isActive: true,
      startDate: new Date('2026-01-01'),
      endDate: new Date('2027-12-31'),
      maxUses: 100,
      currentUses: 5,
      maxUsesPerMember: 1,
      discountType: DiscountType.PERCENTAGE,
      discountValue: 20,
      plans: [],
    };
    const plan = { id: 'plan-1', price: 3000 };

    it('should validate and return discount details for percentage code', async () => {
      prisma.discountCode.findUnique.mockResolvedValue(validCode as any);
      prisma.discountRedemption.count.mockResolvedValue(0);
      prisma.subscriptionPlan.findUnique.mockResolvedValue(plan as any);

      const result = await service.validateCode('VALID20', 'plan-1', 'member-1');
      expect(result.finalPrice).toBe(2400);
      expect(result.originalPrice).toBe(3000);
    });

    it('should validate fixed amount discount', async () => {
      const fixedCode = { ...validCode, discountType: DiscountType.FIXED, discountValue: 500 };
      prisma.discountCode.findUnique.mockResolvedValue(fixedCode as any);
      prisma.discountRedemption.count.mockResolvedValue(0);
      prisma.subscriptionPlan.findUnique.mockResolvedValue(plan as any);

      const result = await service.validateCode('VALID20', 'plan-1', 'member-1');
      expect(result.finalPrice).toBe(2500);
    });

    it('should reject non-existent code', async () => {
      prisma.discountCode.findUnique.mockResolvedValue(null);
      await expect(
        service.validateCode('FAKE', 'plan-1', 'member-1'),
      ).rejects.toThrow('Invalid discount code');
    });

    it('should reject inactive code', async () => {
      prisma.discountCode.findUnique.mockResolvedValue({
        ...validCode,
        isActive: false,
      } as any);
      await expect(
        service.validateCode('VALID20', 'plan-1', 'member-1'),
      ).rejects.toThrow('no longer active');
    });

    it('should reject expired code', async () => {
      prisma.discountCode.findUnique.mockResolvedValue({
        ...validCode,
        endDate: new Date('2025-01-01'),
      } as any);
      await expect(
        service.validateCode('VALID20', 'plan-1', 'member-1'),
      ).rejects.toThrow('expired');
    });

    it('should reject code not yet valid', async () => {
      prisma.discountCode.findUnique.mockResolvedValue({
        ...validCode,
        startDate: new Date('2099-01-01'),
      } as any);
      await expect(
        service.validateCode('VALID20', 'plan-1', 'member-1'),
      ).rejects.toThrow('not yet valid');
    });

    it('should reject code at global usage limit', async () => {
      prisma.discountCode.findUnique.mockResolvedValue({
        ...validCode,
        maxUses: 5,
        currentUses: 5,
      } as any);
      await expect(
        service.validateCode('VALID20', 'plan-1', 'member-1'),
      ).rejects.toThrow('usage limit');
    });

    it('should reject code at per-member limit', async () => {
      prisma.discountCode.findUnique.mockResolvedValue(validCode as any);
      prisma.discountRedemption.count.mockResolvedValue(1);
      await expect(
        service.validateCode('VALID20', 'plan-1', 'member-1'),
      ).rejects.toThrow('maximum number of times');
    });

    it('should reject code not valid for selected plan', async () => {
      prisma.discountCode.findUnique.mockResolvedValue({
        ...validCode,
        plans: [{ planId: 'other-plan' }],
      } as any);
      prisma.discountRedemption.count.mockResolvedValue(0);
      await expect(
        service.validateCode('VALID20', 'plan-1', 'member-1'),
      ).rejects.toThrow('not valid for the selected plan');
    });

    it('should reject fixed discount exceeding plan price', async () => {
      const bigFixed = { ...validCode, discountType: DiscountType.FIXED, discountValue: 5000 };
      prisma.discountCode.findUnique.mockResolvedValue(bigFixed as any);
      prisma.discountRedemption.count.mockResolvedValue(0);
      prisma.subscriptionPlan.findUnique.mockResolvedValue(plan as any);
      await expect(
        service.validateCode('VALID20', 'plan-1', 'member-1'),
      ).rejects.toThrow('exceeds the plan price');
    });

    it('should reject when final price below Paystack minimum', async () => {
      const bigPercent = { ...validCode, discountValue: 99 };
      prisma.discountCode.findUnique.mockResolvedValue(bigPercent as any);
      prisma.discountRedemption.count.mockResolvedValue(0);
      prisma.subscriptionPlan.findUnique.mockResolvedValue(plan as any);
      await expect(
        service.validateCode('VALID20', 'plan-1', 'member-1'),
      ).rejects.toThrow('below the minimum charge');
    });
  });

  describe('findAll', () => {
    it('should return paginated results', async () => {
      prisma.discountCode.findMany.mockResolvedValue([]);
      prisma.discountCode.count.mockResolvedValue(0);
      const result = await service.findAll(1, 20);
      expect(result).toEqual({ data: [], total: 0, page: 1, limit: 20 });
    });
  });

  describe('deactivate', () => {
    it('should set isActive to false', async () => {
      prisma.discountCode.findUnique.mockResolvedValue({ id: 'dc-1', plans: [], _count: { redemptions: 0 } } as any);
      prisma.discountCode.update.mockResolvedValue({ id: 'dc-1', isActive: false } as any);
      const result = await service.deactivate('dc-1');
      expect(result.isActive).toBe(false);
    });
  });
});
```

**Step 2: Run the tests**

Run: `yarn test -- --testPathPattern=discount-codes`

Expected: All tests pass.

**Step 3: Commit**

```bash
git add src/discount-codes/
git commit -m "test(discount-codes): add unit tests for discount codes service"
```

---

### Task 11: Update Subscription Service Tests

**Files:**
- Modify: `src/subscriptions/subscriptions.service.spec.ts`

**Step 1: Update test setup to mock DiscountCodesService**

Add to the test module providers:

```typescript
import { DiscountCodesService } from '../discount-codes/discount-codes.service';

// In beforeEach:
{
  provide: DiscountCodesService,
  useValue: {
    validateCode: jest.fn(),
    redeemCode: jest.fn(),
    reverseRedemption: jest.fn(),
  },
},
```

**Step 2: Add tests for subscription creation with discount code**

Add test cases:
- Creating subscription with valid discount code stores discountCodeId and discountAmount
- Creating subscription with invalid discount code throws BadRequestException
- PENDING subscription cleanup calls reverseRedemption

**Step 3: Run all subscription tests**

Run: `yarn test -- --testPathPattern=subscriptions`

Expected: All existing tests still pass + new tests pass.

**Step 4: Commit**

```bash
git add src/subscriptions/
git commit -m "test(discount-codes): update subscription service tests for discount code integration"
```

---

### Task 12: Update Payment Service Tests

**Files:**
- Modify: `src/payments/payments.service.spec.ts`

**Step 1: Add test for discounted payment initialization**

Add a test case that verifies when a subscription has `discountAmount`, the payment is created with `plan.price - discountAmount` and Paystack is called with the correct amount in cents.

**Step 2: Run payment tests**

Run: `yarn test -- --testPathPattern=payments`

Expected: All tests pass.

**Step 3: Commit**

```bash
git add src/payments/
git commit -m "test(discount-codes): verify payment initialization uses discounted amount"
```

---

### Task 13: Run Full Test Suite and Final Verification

**Step 1: Run all tests**

Run: `yarn test`

Expected: All ~320+ tests pass (existing + new).

**Step 2: Run lint**

Run: `yarn lint`

Expected: No lint errors.

**Step 3: Run build**

Run: `yarn build`

Expected: Clean build, no errors.

**Step 4: Verify Swagger**

Run: `yarn start:dev`

Visit `/api/docs` and verify:
- "Discount Codes" tag appears with all 7 endpoints
- DTOs show correct fields and examples
- Subscription creation DTOs show optional `discountCode` field

**Step 5: Final commit (if any lint fixes needed)**

```bash
git add -A
git commit -m "chore: lint fixes for discount codes feature"
```
