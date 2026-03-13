# In-App Banners Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an admin-managed promotional banner system with carousel display and detailed analytics tracking.

**Architecture:** Standalone `banners/` module following controller → service → PrismaService pattern. Two Prisma models (`Banner`, `BannerInteraction`), two enums (`BannerCtaType`, `BannerInteractionType`). Admin CRUD + analytics endpoints, mobile active-list + interaction-logging endpoints.

**Tech Stack:** NestJS 11, Prisma 6, PostgreSQL, Jest, Swagger

**Design doc:** `docs/plans/2026-03-13-in-app-banners-design.md`

---

### Task 1: Add Prisma Schema Models

**Files:**
- Modify: `prisma/schema.prisma`

**Step 1: Add enums and models to schema**

Add after the existing `PushTicketStatus` enum (near the end of the file):

```prisma
enum BannerCtaType {
  NONE
  DEEP_LINK
  EXTERNAL_URL
}

enum BannerInteractionType {
  IMPRESSION
  TAP
}

model Banner {
  id            String        @id @default(uuid())
  title         String
  body          String?
  imageUrl      String
  ctaType       BannerCtaType @default(NONE)
  ctaTarget     String?
  ctaLabel      String?
  discountCode  String?
  displayOrder  Int           @default(0)
  isPublished   Boolean       @default(false)
  startDate     DateTime
  endDate       DateTime
  deletedAt     DateTime?
  createdBy     String
  createdAt     DateTime      @default(now())
  updatedAt     DateTime      @updatedAt

  creator       User              @relation("UserBanners", fields: [createdBy], references: [id])
  interactions  BannerInteraction[]

  @@index([isPublished, startDate, endDate, deletedAt])
  @@index([createdBy])
}

model BannerInteraction {
  id        String                @id @default(uuid())
  bannerId  String
  userId    String
  type      BannerInteractionType
  createdAt DateTime              @default(now())

  banner    Banner @relation(fields: [bannerId], references: [id], onDelete: Cascade)
  user      User   @relation("UserBannerInteractions", fields: [userId], references: [id])

  @@index([bannerId, type])
  @@index([userId])
}
```

Also add the reverse relations to the `User` model:

```prisma
// Add these two lines inside the User model, near the other relation fields:
banners             Banner[]              @relation("UserBanners")
bannerInteractions  BannerInteraction[]   @relation("UserBannerInteractions")
```

**Step 2: Generate migration**

Run: `npx prisma migrate dev --name add-banner-models`
Expected: Migration created and applied successfully.

**Step 3: Generate Prisma client**

Run: `npx prisma generate`
Expected: Prisma client regenerated with Banner and BannerInteraction types.

**Step 4: Commit**

```bash
git add prisma/
git commit -m "feat(banners): add Banner and BannerInteraction schema models"
```

---

### Task 2: Create DTOs

**Files:**
- Create: `src/banners/dto/create-banner.dto.ts`
- Create: `src/banners/dto/update-banner.dto.ts`
- Create: `src/banners/dto/banner-response.dto.ts`
- Create: `src/banners/dto/banner-analytics-response.dto.ts`
- Create: `src/banners/dto/create-banner-interaction.dto.ts`

**Step 1: Create `create-banner.dto.ts`**

```typescript
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BannerCtaType } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateBannerDto {
  @ApiProperty({ example: 'Summer Promo', maxLength: 200 })
  @IsString()
  @MaxLength(200)
  title: string;

  @ApiPropertyOptional({ example: 'Get 20% off all plans!', maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  body?: string;

  @ApiProperty({ example: 'https://res.cloudinary.com/example/image.jpg' })
  @IsUrl()
  imageUrl: string;

  @ApiProperty({ enum: BannerCtaType, example: 'NONE', default: 'NONE' })
  @IsEnum(BannerCtaType)
  ctaType: BannerCtaType;

  @ApiPropertyOptional({ example: '/subscription-plans' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  ctaTarget?: string;

  @ApiPropertyOptional({ example: 'View Plans' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  ctaLabel?: string;

  @ApiPropertyOptional({ example: 'SUMMER20' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  discountCode?: string;

  @ApiProperty({ example: 0, default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  displayOrder?: number;

  @ApiProperty({ example: '2026-03-15T00:00:00.000Z' })
  @IsDateString()
  startDate: string;

  @ApiProperty({ example: '2026-04-15T00:00:00.000Z' })
  @IsDateString()
  endDate: string;
}
```

**Step 2: Create `update-banner.dto.ts`**

```typescript
import { PartialType } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { CreateBannerDto } from './create-banner.dto';

export class UpdateBannerDto extends PartialType(CreateBannerDto) {
  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;
}
```

**Step 3: Create `banner-response.dto.ts`**

```typescript
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BannerCtaType } from '@prisma/client';

export class BannerListItemDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  title: string;

  @ApiPropertyOptional()
  body?: string;

  @ApiProperty()
  imageUrl: string;

  @ApiProperty({ enum: BannerCtaType })
  ctaType: BannerCtaType;

  @ApiPropertyOptional()
  ctaTarget?: string;

  @ApiPropertyOptional()
  ctaLabel?: string;

  @ApiPropertyOptional()
  discountCode?: string;

  @ApiProperty()
  displayOrder: number;

  @ApiProperty()
  isPublished: boolean;

  @ApiProperty()
  startDate: Date;

  @ApiProperty()
  endDate: Date;

  @ApiProperty()
  createdBy: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  @ApiProperty({ example: 1250 })
  totalImpressions: number;

  @ApiProperty({ example: 87 })
  totalTaps: number;
}

export class PaginatedBannersResponseDto {
  @ApiProperty({ type: [BannerListItemDto] })
  data: BannerListItemDto[];

  @ApiProperty({ example: 100 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;
}

export class ActiveBannerResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  title: string;

  @ApiPropertyOptional()
  body?: string;

  @ApiProperty()
  imageUrl: string;

  @ApiProperty({ enum: BannerCtaType })
  ctaType: BannerCtaType;

  @ApiPropertyOptional()
  ctaTarget?: string;

  @ApiPropertyOptional()
  ctaLabel?: string;

  @ApiPropertyOptional()
  discountCode?: string;

  @ApiProperty()
  displayOrder: number;
}
```

**Step 4: Create `banner-analytics-response.dto.ts`**

```typescript
import { ApiProperty } from '@nestjs/swagger';

export class InteractionCountDto {
  @ApiProperty({ example: 1250 })
  total: number;

  @ApiProperty({ example: 340 })
  unique: number;
}

export class BannerAnalyticsResponseDto {
  @ApiProperty({ format: 'uuid' })
  bannerId: string;

  @ApiProperty()
  title: string;

  @ApiProperty()
  period: { startDate: Date; endDate: Date };

  @ApiProperty({ type: InteractionCountDto })
  impressions: InteractionCountDto;

  @ApiProperty({ type: InteractionCountDto })
  taps: InteractionCountDto;

  @ApiProperty({ example: 18.24 })
  tapThroughRate: number;
}
```

**Step 5: Create `create-banner-interaction.dto.ts`**

```typescript
import { ApiProperty } from '@nestjs/swagger';
import { BannerInteractionType } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class CreateBannerInteractionDto {
  @ApiProperty({ enum: BannerInteractionType, example: 'IMPRESSION' })
  @IsEnum(BannerInteractionType)
  type: BannerInteractionType;
}
```

**Step 6: Commit**

```bash
git add src/banners/dto/
git commit -m "feat(banners): add banner DTOs"
```

---

### Task 3: Create Banner Service with Tests (TDD)

**Files:**
- Create: `src/banners/banners.service.ts`
- Create: `src/banners/banners.service.spec.ts`

**Step 1: Write the test file**

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { BannersService } from './banners.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { BannerCtaType } from '@prisma/client';

describe('BannersService', () => {
  let service: BannersService;

  const mockBanner = {
    id: 'banner-1',
    title: 'Summer Promo',
    body: 'Get 20% off!',
    imageUrl: 'https://example.com/image.jpg',
    ctaType: BannerCtaType.DEEP_LINK,
    ctaTarget: '/subscription-plans',
    ctaLabel: 'View Plans',
    discountCode: 'SUMMER20',
    displayOrder: 0,
    isPublished: true,
    startDate: new Date('2026-03-01'),
    endDate: new Date('2026-04-01'),
    deletedAt: null,
    createdBy: 'admin-1',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockPrisma = {
    banner: {
      create: jest.fn().mockResolvedValue(mockBanner),
      findMany: jest.fn().mockResolvedValue([mockBanner]),
      findFirst: jest.fn().mockResolvedValue(mockBanner),
      update: jest.fn().mockResolvedValue(mockBanner),
      count: jest.fn().mockResolvedValue(1),
    },
    bannerInteraction: {
      create: jest.fn().mockResolvedValue({ id: 'interaction-1' }),
      count: jest.fn().mockResolvedValue(10),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    $queryRaw: jest.fn().mockResolvedValue([{ count: BigInt(5) }]),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BannersService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<BannersService>(BannersService);
  });

  describe('create', () => {
    it('should create a banner', async () => {
      const dto = {
        title: 'Summer Promo',
        body: 'Get 20% off!',
        imageUrl: 'https://example.com/image.jpg',
        ctaType: BannerCtaType.DEEP_LINK,
        ctaTarget: '/subscription-plans',
        ctaLabel: 'View Plans',
        discountCode: 'SUMMER20',
        startDate: '2026-03-01T00:00:00.000Z',
        endDate: '2026-04-01T00:00:00.000Z',
      };
      const result = await service.create(dto, 'admin-1');
      expect(mockPrisma.banner.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          title: dto.title,
          createdBy: 'admin-1',
        }),
      });
      expect(result).toEqual(mockBanner);
    });

    it('should throw if endDate is before startDate', async () => {
      const dto = {
        title: 'Bad Banner',
        imageUrl: 'https://example.com/image.jpg',
        ctaType: BannerCtaType.NONE,
        startDate: '2026-04-01T00:00:00.000Z',
        endDate: '2026-03-01T00:00:00.000Z',
      };
      await expect(service.create(dto, 'admin-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('findAll', () => {
    it('should return paginated banners with analytics', async () => {
      mockPrisma.bannerInteraction.count
        .mockResolvedValueOnce(100)
        .mockResolvedValueOnce(25);

      const result = await service.findAll(1, 20);
      expect(mockPrisma.banner.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          skip: 0,
          take: 20,
        }),
      );
      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('total');
      expect(result).toHaveProperty('page');
      expect(result).toHaveProperty('limit');
    });
  });

  describe('findOne', () => {
    it('should return a banner by id', async () => {
      const result = await service.findOne('banner-1');
      expect(mockPrisma.banner.findFirst).toHaveBeenCalledWith({
        where: { id: 'banner-1', deletedAt: null },
      });
      expect(result).toEqual(mockBanner);
    });

    it('should throw NotFoundException if banner not found', async () => {
      mockPrisma.banner.findFirst.mockResolvedValueOnce(null);
      await expect(service.findOne('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('should update a banner', async () => {
      const dto = { title: 'Updated Promo' };
      const result = await service.update('banner-1', dto);
      expect(mockPrisma.banner.findFirst).toHaveBeenCalled();
      expect(mockPrisma.banner.update).toHaveBeenCalledWith({
        where: { id: 'banner-1' },
        data: expect.objectContaining({ title: 'Updated Promo' }),
      });
      expect(result).toEqual(mockBanner);
    });

    it('should throw NotFoundException if banner not found', async () => {
      mockPrisma.banner.findFirst.mockResolvedValueOnce(null);
      await expect(
        service.update('nonexistent', { title: 'x' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('softDelete', () => {
    it('should set deletedAt on the banner', async () => {
      await service.softDelete('banner-1');
      expect(mockPrisma.banner.findFirst).toHaveBeenCalled();
      expect(mockPrisma.banner.update).toHaveBeenCalledWith({
        where: { id: 'banner-1' },
        data: { deletedAt: expect.any(Date) },
      });
    });

    it('should throw NotFoundException if banner not found', async () => {
      mockPrisma.banner.findFirst.mockResolvedValueOnce(null);
      await expect(service.softDelete('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findActive', () => {
    it('should return active banners ordered by displayOrder', async () => {
      const result = await service.findActive();
      expect(mockPrisma.banner.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            isPublished: true,
            deletedAt: null,
          }),
          orderBy: { displayOrder: 'asc' },
          take: 10,
        }),
      );
      expect(result).toEqual([mockBanner]);
    });
  });

  describe('logInteraction', () => {
    it('should create a banner interaction', async () => {
      await service.logInteraction('banner-1', 'user-1', 'IMPRESSION');
      expect(mockPrisma.banner.findFirst).toHaveBeenCalled();
      expect(mockPrisma.bannerInteraction.create).toHaveBeenCalledWith({
        data: {
          bannerId: 'banner-1',
          userId: 'user-1',
          type: 'IMPRESSION',
        },
      });
    });

    it('should throw NotFoundException if banner not found', async () => {
      mockPrisma.banner.findFirst.mockResolvedValueOnce(null);
      await expect(
        service.logInteraction('nonexistent', 'user-1', 'TAP'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getAnalytics', () => {
    it('should return analytics for a banner', async () => {
      mockPrisma.bannerInteraction.count
        .mockResolvedValueOnce(1250)
        .mockResolvedValueOnce(87);
      mockPrisma.$queryRaw
        .mockResolvedValueOnce([{ count: BigInt(340) }])
        .mockResolvedValueOnce([{ count: BigInt(62) }]);

      const result = await service.getAnalytics('banner-1');
      expect(result).toHaveProperty('bannerId', 'banner-1');
      expect(result).toHaveProperty('impressions');
      expect(result).toHaveProperty('taps');
      expect(result).toHaveProperty('tapThroughRate');
    });

    it('should throw NotFoundException if banner not found', async () => {
      mockPrisma.banner.findFirst.mockResolvedValueOnce(null);
      await expect(service.getAnalytics('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `yarn test -- --testPathPattern=banners.service`
Expected: FAIL — `Cannot find module './banners.service'`

**Step 3: Write the service implementation**

```typescript
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBannerDto } from './dto/create-banner.dto';
import { UpdateBannerDto } from './dto/update-banner.dto';
import { BannerInteractionType, Prisma } from '@prisma/client';

@Injectable()
export class BannersService {
  private readonly logger = new Logger(BannersService.name);

  constructor(private prisma: PrismaService) {}

  async create(dto: CreateBannerDto, createdBy: string) {
    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);

    if (endDate <= startDate) {
      throw new BadRequestException('endDate must be after startDate');
    }

    return this.prisma.banner.create({
      data: {
        title: dto.title,
        body: dto.body,
        imageUrl: dto.imageUrl,
        ctaType: dto.ctaType,
        ctaTarget: dto.ctaTarget,
        ctaLabel: dto.ctaLabel,
        discountCode: dto.discountCode,
        displayOrder: dto.displayOrder ?? 0,
        startDate,
        endDate,
        createdBy,
      },
    });
  }

  async findAll(page = 1, limit = 20) {
    const where: Prisma.BannerWhereInput = { deletedAt: null };

    const [banners, total] = await Promise.all([
      this.prisma.banner.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.banner.count({ where }),
    ]);

    const data = await Promise.all(
      banners.map(async (banner) => {
        const [totalImpressions, totalTaps] = await Promise.all([
          this.prisma.bannerInteraction.count({
            where: { bannerId: banner.id, type: 'IMPRESSION' },
          }),
          this.prisma.bannerInteraction.count({
            where: { bannerId: banner.id, type: 'TAP' },
          }),
        ]);
        return { ...banner, totalImpressions, totalTaps };
      }),
    );

    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const banner = await this.prisma.banner.findFirst({
      where: { id, deletedAt: null },
    });
    if (!banner) {
      throw new NotFoundException('Banner not found');
    }
    return banner;
  }

  async update(id: string, dto: UpdateBannerDto) {
    await this.findOne(id);

    const data: Prisma.BannerUpdateInput = { ...dto };

    if (dto.startDate) {
      data.startDate = new Date(dto.startDate);
    }
    if (dto.endDate) {
      data.endDate = new Date(dto.endDate);
    }

    return this.prisma.banner.update({
      where: { id },
      data,
    });
  }

  async softDelete(id: string) {
    await this.findOne(id);
    return this.prisma.banner.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async findActive() {
    const now = new Date();
    return this.prisma.banner.findMany({
      where: {
        isPublished: true,
        deletedAt: null,
        startDate: { lte: now },
        endDate: { gt: now },
      },
      orderBy: { displayOrder: 'asc' },
      take: 10,
      select: {
        id: true,
        title: true,
        body: true,
        imageUrl: true,
        ctaType: true,
        ctaTarget: true,
        ctaLabel: true,
        discountCode: true,
        displayOrder: true,
      },
    });
  }

  async logInteraction(
    bannerId: string,
    userId: string,
    type: BannerInteractionType,
  ) {
    await this.findOne(bannerId);
    return this.prisma.bannerInteraction.create({
      data: { bannerId, userId, type },
    });
  }

  async getAnalytics(id: string) {
    const banner = await this.findOne(id);

    const [totalImpressions, totalTaps, uniqueImpressions, uniqueTaps] =
      await Promise.all([
        this.prisma.bannerInteraction.count({
          where: { bannerId: id, type: 'IMPRESSION' },
        }),
        this.prisma.bannerInteraction.count({
          where: { bannerId: id, type: 'TAP' },
        }),
        this.prisma.$queryRaw<
          { count: bigint }[]
        >`SELECT COUNT(DISTINCT "userId") as count FROM "BannerInteraction" WHERE "bannerId" = ${id} AND "type" = 'IMPRESSION'`,
        this.prisma.$queryRaw<
          { count: bigint }[]
        >`SELECT COUNT(DISTINCT "userId") as count FROM "BannerInteraction" WHERE "bannerId" = ${id} AND "type" = 'TAP'`,
      ]);

    const uniqueImpressionsCount = Number(uniqueImpressions[0]?.count ?? 0);
    const uniqueTapsCount = Number(uniqueTaps[0]?.count ?? 0);
    const tapThroughRate =
      uniqueImpressionsCount > 0
        ? Math.round((uniqueTapsCount / uniqueImpressionsCount) * 10000) / 100
        : 0;

    return {
      bannerId: id,
      title: banner.title,
      period: { startDate: banner.startDate, endDate: banner.endDate },
      impressions: { total: totalImpressions, unique: uniqueImpressionsCount },
      taps: { total: totalTaps, unique: uniqueTapsCount },
      tapThroughRate,
    };
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `yarn test -- --testPathPattern=banners.service`
Expected: All tests PASS.

**Step 5: Commit**

```bash
git add src/banners/banners.service.ts src/banners/banners.service.spec.ts
git commit -m "feat(banners): add banners service with unit tests"
```

---

### Task 4: Create Banner Controller

**Files:**
- Create: `src/banners/banners.controller.ts`

**Step 1: Write the controller**

```typescript
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
  create(
    @Body() dto: CreateBannerDto,
    @CurrentUser('id') userId: string,
  ) {
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
```

**Step 2: Commit**

```bash
git add src/banners/banners.controller.ts
git commit -m "feat(banners): add banners controller"
```

---

### Task 5: Create Module and Register in App

**Files:**
- Create: `src/banners/banners.module.ts`
- Modify: `src/app.module.ts`

**Step 1: Create the module**

```typescript
import { Module } from '@nestjs/common';
import { BannersController } from './banners.controller';
import { BannersService } from './banners.service';

@Module({
  controllers: [BannersController],
  providers: [BannersService],
  exports: [BannersService],
})
export class BannersModule {}
```

**Step 2: Register in app.module.ts**

Add `BannersModule` to the imports array in `src/app.module.ts`, after `NotificationsModule`. Also add the import statement at the top of the file:

```typescript
import { BannersModule } from './banners/banners.module';
```

**Step 3: Run the lint check**

Run: `yarn lint`
Expected: No errors.

**Step 4: Run all tests**

Run: `yarn test`
Expected: All existing tests pass + new banner tests pass.

**Step 5: Commit**

```bash
git add src/banners/banners.module.ts src/app.module.ts
git commit -m "feat(banners): register banners module in app"
```

---

### Task 6: Verify End-to-End

**Step 1: Run the full test suite**

Run: `yarn test`
Expected: All tests pass.

**Step 2: Run lint**

Run: `yarn lint`
Expected: No errors.

**Step 3: Start dev server and verify Swagger**

Run: `yarn start:dev`
Expected: Server starts on port 3000. Visit `/api/docs` — "Banners" tag should appear with all 8 endpoints documented.

**Step 4: Commit any final fixes if needed**

```bash
git add -A
git commit -m "feat(banners): finalize banner module"
```
