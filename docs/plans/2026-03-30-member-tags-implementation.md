# Member Tags Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a member tagging system with auto-computed behavioral tags (daily cron) and manual admin tags, integrated with the existing users list.

**Architecture:** New `member-tags` module following controller → service → Prisma pattern. `Tag` + `MemberTag` join table. Daily cron refreshes system tags. GymSettings extended with configurable thresholds. Feature-gated behind `member-tags`.

**Tech Stack:** NestJS 11, Prisma 6, PostgreSQL, Jest + jest-mock-extended, @nestjs/schedule

---

### Task 1: Prisma Schema — Add Tag models and GymSettings fields

**Files:**
- Modify: `prisma/schema.prisma`

**Step 1: Add TagSource enum and Tag/MemberTag models to schema**

Add after the existing enums (near `DeletionRequestStatus`):

```prisma
enum TagSource {
  SYSTEM
  MANUAL
}
```

Add the models at the end of the schema:

```prisma
model Tag {
  id          String    @id @default(uuid())
  name        String    @unique
  description String?
  source      TagSource
  color       String?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  members     MemberTag[]
}

model MemberTag {
  id         String   @id @default(uuid())
  memberId   String
  tagId      String
  assignedAt DateTime @default(now())
  assignedBy String?
  member     User     @relation(fields: [memberId], references: [id])
  tag        Tag      @relation(fields: [tagId], references: [id], onDelete: Cascade)

  @@unique([memberId, tagId])
}
```

Add relation to existing `User` model:

```prisma
memberTags MemberTag[]
```

Add fields to existing `GymSettings` model:

```prisma
newMemberDays    Int @default(14)
activeDays       Int @default(7)
inactiveDays     Int @default(14)
dormantDays      Int @default(30)
atRiskDays       Int @default(14)
loyalStreakWeeks Int @default(4)
```

**Step 2: Generate and apply migration**

Run: `npx prisma migrate dev --name add-member-tags`
Expected: Migration created and applied successfully.

**Step 3: Verify Prisma client**

Run: `npx prisma generate`
Expected: Generated Prisma Client successfully.

**Step 4: Commit**

```bash
git add prisma/
git commit -m "feat(member-tags): add Tag, MemberTag models and GymSettings thresholds"
```

---

### Task 2: Update GymSettings DTOs and response

**Files:**
- Modify: `src/gym-settings/dto/upsert-gym-settings.dto.ts`
- Modify: `src/gym-settings/dto/gym-settings-response.dto.ts`

**Step 1: Add threshold fields to UpsertGymSettingsDto**

Add these fields to `src/gym-settings/dto/upsert-gym-settings.dto.ts` after the existing fields:

```typescript
@ApiPropertyOptional({
  example: 14,
  description: 'Days since registration to consider a member "new"',
})
@IsOptional()
@IsInt()
@Min(1)
@Max(90)
newMemberDays?: number;

@ApiPropertyOptional({
  example: 7,
  description: 'Days since last check-in to consider a member "active"',
})
@IsOptional()
@IsInt()
@Min(1)
@Max(90)
activeDays?: number;

@ApiPropertyOptional({
  example: 14,
  description: 'Days without check-in to consider a member "inactive"',
})
@IsOptional()
@IsInt()
@Min(1)
@Max(180)
inactiveDays?: number;

@ApiPropertyOptional({
  example: 30,
  description: 'Days without check-in to consider a member "dormant"',
})
@IsOptional()
@IsInt()
@Min(1)
@Max(365)
dormantDays?: number;

@ApiPropertyOptional({
  example: 14,
  description: 'Days without check-in (with active sub) to consider "at-risk"',
})
@IsOptional()
@IsInt()
@Min(1)
@Max(180)
atRiskDays?: number;

@ApiPropertyOptional({
  example: 4,
  description: 'Weekly streak threshold to tag a member as "loyal"',
})
@IsOptional()
@IsInt()
@Min(1)
@Max(52)
loyalStreakWeeks?: number;
```

**Step 2: Add threshold fields to GymSettingsResponseDto**

Add these fields to `src/gym-settings/dto/gym-settings-response.dto.ts`:

```typescript
@ApiProperty({ example: 14, description: 'Days to tag as new member' })
newMemberDays: number;

@ApiProperty({ example: 7, description: 'Days to tag as active' })
activeDays: number;

@ApiProperty({ example: 14, description: 'Days to tag as inactive' })
inactiveDays: number;

@ApiProperty({ example: 30, description: 'Days to tag as dormant' })
dormantDays: number;

@ApiProperty({ example: 14, description: 'Days to tag as at-risk' })
atRiskDays: number;

@ApiProperty({ example: 4, description: 'Streak weeks to tag as loyal' })
loyalStreakWeeks: number;
```

**Step 3: Update GymSettingsService.upsert() to handle new fields**

In `src/gym-settings/gym-settings.service.ts`, add the new fields to the `create` and `update` objects in the `upsert` method, following the existing spread pattern:

```typescript
...(dto.newMemberDays !== undefined && { newMemberDays: dto.newMemberDays }),
...(dto.activeDays !== undefined && { activeDays: dto.activeDays }),
...(dto.inactiveDays !== undefined && { inactiveDays: dto.inactiveDays }),
...(dto.dormantDays !== undefined && { dormantDays: dto.dormantDays }),
...(dto.atRiskDays !== undefined && { atRiskDays: dto.atRiskDays }),
...(dto.loyalStreakWeeks !== undefined && { loyalStreakWeeks: dto.loyalStreakWeeks }),
```

Add these lines to BOTH the `create` and `update` objects inside the `prisma.gymSettings.upsert()` call.

**Step 4: Run lint and tests**

Run: `yarn lint`
Run: `yarn test -- --testPathPattern=gym-settings`
Expected: All pass.

**Step 5: Commit**

```bash
git add src/gym-settings/
git commit -m "feat(member-tags): add tag threshold fields to GymSettings"
```

---

### Task 3: Create member-tags module — DTOs

**Files:**
- Create: `src/member-tags/dto/create-tag.dto.ts`
- Create: `src/member-tags/dto/update-tag.dto.ts`
- Create: `src/member-tags/dto/assign-tag.dto.ts`
- Create: `src/member-tags/dto/tag-query.dto.ts`
- Create: `src/member-tags/dto/tag-response.dto.ts`

**Step 1: Create CreateTagDto**

File: `src/member-tags/dto/create-tag.dto.ts`

```typescript
import { IsString, IsNotEmpty, IsOptional, MaxLength, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTagDto {
  @ApiProperty({ example: 'VIP', description: 'Unique tag name' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name: string;

  @ApiPropertyOptional({ example: 'High-value members' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  @ApiPropertyOptional({ example: '#FF5733', description: 'Hex color code' })
  @IsOptional()
  @IsString()
  @Matches(/^#[0-9A-Fa-f]{6}$/, { message: 'color must be a valid hex color (e.g. #FF5733)' })
  color?: string;
}
```

**Step 2: Create UpdateTagDto**

File: `src/member-tags/dto/update-tag.dto.ts`

```typescript
import { PartialType } from '@nestjs/swagger';
import { CreateTagDto } from './create-tag.dto';

export class UpdateTagDto extends PartialType(CreateTagDto) {}
```

**Step 3: Create AssignTagDto**

File: `src/member-tags/dto/assign-tag.dto.ts`

```typescript
import { IsArray, IsUUID, ArrayMinSize } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AssignTagDto {
  @ApiProperty({
    example: ['uuid-1', 'uuid-2'],
    description: 'Member IDs to assign the tag to',
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  memberIds: string[];
}
```

**Step 4: Create TagQueryDto**

File: `src/member-tags/dto/tag-query.dto.ts`

```typescript
import { IsEnum, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { TagSource } from '@prisma/client';

export class TagQueryDto {
  @ApiPropertyOptional({ enum: TagSource, description: 'Filter by tag source' })
  @IsOptional()
  @IsEnum(TagSource)
  source?: TagSource;
}
```

**Step 5: Create TagResponseDto**

File: `src/member-tags/dto/tag-response.dto.ts`

```typescript
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TagResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'at-risk' })
  name: string;

  @ApiPropertyOptional({ example: 'Active sub but no recent check-in' })
  description?: string;

  @ApiProperty({ enum: ['SYSTEM', 'MANUAL'], example: 'SYSTEM' })
  source: string;

  @ApiPropertyOptional({ example: '#FF5733' })
  color?: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class TagWithCountResponseDto extends TagResponseDto {
  @ApiProperty({ example: 12 })
  memberCount: number;
}

export class TagSummaryResponseDto {
  @ApiProperty({ type: [TagWithCountResponseDto] })
  tags: TagWithCountResponseDto[];
}

export class MemberTagResponseDto {
  @ApiProperty({ example: 'at-risk' })
  name: string;

  @ApiProperty({ enum: ['SYSTEM', 'MANUAL'] })
  source: string;

  @ApiPropertyOptional({ example: '#FF5733' })
  color?: string;
}
```

**Step 6: Commit**

```bash
git add src/member-tags/
git commit -m "feat(member-tags): add DTOs for tag management"
```

---

### Task 4: Create member-tags service — CRUD and assignment

**Files:**
- Create: `src/member-tags/member-tags.service.ts`

**Step 1: Write the failing test**

Create: `src/member-tags/member-tags.service.spec.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaClient, TagSource } from '@prisma/client';
import { MemberTagsService } from './member-tags.service';
import { PrismaService } from '../prisma/prisma.service';
import { GymSettingsService } from '../gym-settings/gym-settings.service';

describe('MemberTagsService', () => {
  let service: MemberTagsService;
  let prisma: DeepMockProxy<PrismaClient>;
  let gymSettingsService: { getCachedSettings: jest.Mock };

  beforeEach(async () => {
    gymSettingsService = { getCachedSettings: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MemberTagsService,
        { provide: PrismaService, useValue: mockDeep<PrismaClient>() },
        { provide: GymSettingsService, useValue: gymSettingsService },
      ],
    }).compile();

    service = module.get<MemberTagsService>(MemberTagsService);
    prisma = module.get(PrismaService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should return all tags', async () => {
      const tags = [
        { id: 't1', name: 'VIP', source: TagSource.MANUAL, members: [] },
      ];
      prisma.tag.findMany.mockResolvedValueOnce(tags as any);

      const result = await service.findAll();
      expect(result).toEqual(tags);
    });

    it('should filter by source', async () => {
      prisma.tag.findMany.mockResolvedValueOnce([]);

      await service.findAll(TagSource.SYSTEM);
      expect(prisma.tag.findMany).toHaveBeenCalledWith({
        where: { source: TagSource.SYSTEM },
        orderBy: { name: 'asc' },
      });
    });
  });

  describe('create', () => {
    it('should create a manual tag', async () => {
      prisma.tag.findUnique.mockResolvedValueOnce(null);
      prisma.tag.create.mockResolvedValueOnce({
        id: 't1',
        name: 'VIP',
        source: TagSource.MANUAL,
      } as any);

      const result = await service.create({ name: 'VIP' });
      expect(result.name).toBe('VIP');
      expect(prisma.tag.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: 'VIP',
          source: TagSource.MANUAL,
        }),
      });
    });

    it('should reject duplicate tag name', async () => {
      prisma.tag.findUnique.mockResolvedValueOnce({ id: 't1', name: 'VIP' } as any);

      await expect(service.create({ name: 'VIP' })).rejects.toThrow(ConflictException);
    });
  });

  describe('update', () => {
    it('should update a manual tag', async () => {
      prisma.tag.findUnique.mockResolvedValueOnce({
        id: 't1',
        name: 'VIP',
        source: TagSource.MANUAL,
      } as any);
      prisma.tag.update.mockResolvedValueOnce({
        id: 't1',
        name: 'VIP Updated',
        source: TagSource.MANUAL,
      } as any);

      const result = await service.update('t1', { name: 'VIP Updated' });
      expect(result.name).toBe('VIP Updated');
    });

    it('should reject updating a SYSTEM tag', async () => {
      prisma.tag.findUnique.mockResolvedValueOnce({
        id: 't1',
        name: 'at-risk',
        source: TagSource.SYSTEM,
      } as any);

      await expect(service.update('t1', { name: 'renamed' })).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('delete', () => {
    it('should delete a manual tag', async () => {
      prisma.tag.findUnique.mockResolvedValueOnce({
        id: 't1',
        source: TagSource.MANUAL,
      } as any);
      prisma.tag.delete.mockResolvedValueOnce({ id: 't1' } as any);

      await service.delete('t1');
      expect(prisma.tag.delete).toHaveBeenCalledWith({ where: { id: 't1' } });
    });

    it('should reject deleting a SYSTEM tag', async () => {
      prisma.tag.findUnique.mockResolvedValueOnce({
        id: 't1',
        source: TagSource.SYSTEM,
      } as any);

      await expect(service.delete('t1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('assignTag', () => {
    it('should assign a manual tag to members', async () => {
      prisma.tag.findUnique.mockResolvedValueOnce({
        id: 't1',
        source: TagSource.MANUAL,
      } as any);
      prisma.memberTag.createMany.mockResolvedValueOnce({ count: 2 });

      const result = await service.assignTag('t1', ['m1', 'm2'], 'admin-1');
      expect(result.count).toBe(2);
    });

    it('should reject assigning a SYSTEM tag', async () => {
      prisma.tag.findUnique.mockResolvedValueOnce({
        id: 't1',
        source: TagSource.SYSTEM,
      } as any);

      await expect(
        service.assignTag('t1', ['m1'], 'admin-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('removeTag', () => {
    it('should remove a manual tag from a member', async () => {
      prisma.tag.findUnique.mockResolvedValueOnce({
        id: 't1',
        source: TagSource.MANUAL,
      } as any);
      prisma.memberTag.deleteMany.mockResolvedValueOnce({ count: 1 });

      await service.removeTag('t1', 'm1');
      expect(prisma.memberTag.deleteMany).toHaveBeenCalledWith({
        where: { tagId: 't1', memberId: 'm1' },
      });
    });
  });

  describe('getSummary', () => {
    it('should return tag counts', async () => {
      prisma.tag.findMany.mockResolvedValueOnce([
        { id: 't1', name: 'at-risk', source: TagSource.SYSTEM, _count: { members: 5 } },
        { id: 't2', name: 'VIP', source: TagSource.MANUAL, _count: { members: 3 } },
      ] as any);

      const result = await service.getSummary();
      expect(result).toHaveLength(2);
      expect(result[0]).toHaveProperty('memberCount', 5);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `yarn test -- --testPathPattern=member-tags`
Expected: FAIL — `Cannot find module './member-tags.service'`

**Step 3: Write the service**

Create: `src/member-tags/member-tags.service.ts`

```typescript
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma, TagSource } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { GymSettingsService } from '../gym-settings/gym-settings.service';
import { CreateTagDto } from './dto/create-tag.dto';
import { UpdateTagDto } from './dto/update-tag.dto';

const SYSTEM_TAGS = [
  { name: 'new-member', description: 'Joined recently', color: '#4CAF50' },
  { name: 'active', description: 'Checked in recently', color: '#2196F3' },
  { name: 'inactive', description: 'No recent check-ins', color: '#FF9800' },
  { name: 'dormant', description: 'No check-ins for extended period', color: '#9E9E9E' },
  { name: 'at-risk', description: 'Active subscription but not visiting', color: '#F44336' },
  { name: 'expired', description: 'Subscription expired', color: '#795548' },
  { name: 'loyal', description: 'Consistent weekly attendance', color: '#9C27B0' },
  { name: 'frozen', description: 'Subscription currently frozen', color: '#607D8B' },
];

@Injectable()
export class MemberTagsService {
  private readonly logger = new Logger(MemberTagsService.name);

  constructor(
    private prisma: PrismaService,
    private gymSettingsService: GymSettingsService,
  ) {}

  async findAll(source?: TagSource) {
    const where: Prisma.TagWhereInput = {};
    if (source) where.source = source;

    return this.prisma.tag.findMany({
      where,
      orderBy: { name: 'asc' },
    });
  }

  async create(dto: CreateTagDto) {
    const existing = await this.prisma.tag.findUnique({
      where: { name: dto.name },
    });
    if (existing) {
      throw new ConflictException(`Tag "${dto.name}" already exists`);
    }

    return this.prisma.tag.create({
      data: {
        name: dto.name,
        description: dto.description,
        color: dto.color,
        source: TagSource.MANUAL,
      },
    });
  }

  async update(id: string, dto: UpdateTagDto) {
    const tag = await this.findOneOrFail(id);

    if (tag.source === TagSource.SYSTEM) {
      throw new BadRequestException('Cannot modify system tags');
    }

    if (dto.name && dto.name !== tag.name) {
      const existing = await this.prisma.tag.findUnique({
        where: { name: dto.name },
      });
      if (existing) {
        throw new ConflictException(`Tag "${dto.name}" already exists`);
      }
    }

    return this.prisma.tag.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.color !== undefined && { color: dto.color }),
      },
    });
  }

  async delete(id: string) {
    const tag = await this.findOneOrFail(id);

    if (tag.source === TagSource.SYSTEM) {
      throw new BadRequestException('Cannot delete system tags');
    }

    return this.prisma.tag.delete({ where: { id } });
  }

  async assignTag(tagId: string, memberIds: string[], assignedBy: string) {
    const tag = await this.findOneOrFail(tagId);

    if (tag.source === TagSource.SYSTEM) {
      throw new BadRequestException('Cannot manually assign system tags');
    }

    return this.prisma.memberTag.createMany({
      data: memberIds.map((memberId) => ({
        tagId,
        memberId,
        assignedBy,
      })),
      skipDuplicates: true,
    });
  }

  async removeTag(tagId: string, memberId: string) {
    const tag = await this.findOneOrFail(tagId);

    if (tag.source === TagSource.SYSTEM) {
      throw new BadRequestException('Cannot manually remove system tags');
    }

    return this.prisma.memberTag.deleteMany({
      where: { tagId, memberId },
    });
  }

  async getSummary() {
    const tags = await this.prisma.tag.findMany({
      include: { _count: { select: { members: true } } },
      orderBy: { name: 'asc' },
    });

    return tags.map((tag) => ({
      id: tag.id,
      name: tag.name,
      description: tag.description,
      source: tag.source,
      color: tag.color,
      createdAt: tag.createdAt,
      updatedAt: tag.updatedAt,
      memberCount: tag._count.members,
    }));
  }

  @Cron('0 2 * * *', { timeZone: 'Africa/Nairobi' })
  async refreshSystemTags(): Promise<void> {
    this.logger.log('Starting daily system tag refresh...');

    await this.ensureSystemTags();

    const settings = await this.gymSettingsService.getCachedSettings();
    const now = new Date();

    const systemTags = await this.prisma.tag.findMany({
      where: { source: TagSource.SYSTEM },
    });
    const tagMap = new Map(systemTags.map((t) => [t.name, t.id]));

    // Delete all existing system tag assignments
    await this.prisma.memberTag.deleteMany({
      where: { tag: { source: TagSource.SYSTEM } },
    });

    const newMemberDays = settings?.newMemberDays ?? 14;
    const activeDays = settings?.activeDays ?? 7;
    const inactiveDays = settings?.inactiveDays ?? 14;
    const dormantDays = settings?.dormantDays ?? 30;
    const atRiskDays = settings?.atRiskDays ?? 14;
    const loyalStreakWeeks = settings?.loyalStreakWeeks ?? 4;

    const assignments: { memberId: string; tagId: string }[] = [];

    // Fetch all active members (not soft-deleted)
    const members = await this.prisma.user.findMany({
      where: { role: 'MEMBER', deletedAt: null },
      select: {
        id: true,
        createdAt: true,
        attendances: {
          orderBy: { checkInDate: 'desc' },
          take: 1,
          select: { checkInDate: true },
        },
        subscriptionMembers: {
          where: { subscription: { status: { in: ['ACTIVE', 'FROZEN', 'EXPIRED'] } } },
          select: { subscription: { select: { status: true } } },
        },
        streak: {
          select: { weeklyStreak: true },
        },
      },
    });

    for (const member of members) {
      const lastCheckIn = member.attendances[0]?.checkInDate;
      const daysSinceCheckIn = lastCheckIn
        ? Math.floor((now.getTime() - new Date(lastCheckIn).getTime()) / (1000 * 60 * 60 * 24))
        : null;
      const daysSinceJoined = Math.floor(
        (now.getTime() - member.createdAt.getTime()) / (1000 * 60 * 60 * 24),
      );

      const subStatuses = member.subscriptionMembers.map((sm) => sm.subscription.status);
      const hasActive = subStatuses.includes('ACTIVE');
      const hasFrozen = subStatuses.includes('FROZEN');
      const hasExpired = subStatuses.includes('EXPIRED');

      // new-member
      if (daysSinceJoined <= newMemberDays && tagMap.has('new-member')) {
        assignments.push({ memberId: member.id, tagId: tagMap.get('new-member')! });
      }

      // active
      if (daysSinceCheckIn !== null && daysSinceCheckIn <= activeDays && tagMap.has('active')) {
        assignments.push({ memberId: member.id, tagId: tagMap.get('active')! });
      }

      // inactive
      if ((daysSinceCheckIn === null || daysSinceCheckIn >= inactiveDays) && tagMap.has('inactive')) {
        assignments.push({ memberId: member.id, tagId: tagMap.get('inactive')! });
      }

      // dormant
      if ((daysSinceCheckIn === null || daysSinceCheckIn >= dormantDays) && tagMap.has('dormant')) {
        assignments.push({ memberId: member.id, tagId: tagMap.get('dormant')! });
      }

      // at-risk
      if (
        hasActive &&
        (daysSinceCheckIn === null || daysSinceCheckIn >= atRiskDays) &&
        tagMap.has('at-risk')
      ) {
        assignments.push({ memberId: member.id, tagId: tagMap.get('at-risk')! });
      }

      // expired
      if (hasExpired && !hasActive && tagMap.has('expired')) {
        assignments.push({ memberId: member.id, tagId: tagMap.get('expired')! });
      }

      // loyal
      if (
        member.streak?.weeklyStreak &&
        member.streak.weeklyStreak >= loyalStreakWeeks &&
        tagMap.has('loyal')
      ) {
        assignments.push({ memberId: member.id, tagId: tagMap.get('loyal')! });
      }

      // frozen
      if (hasFrozen && tagMap.has('frozen')) {
        assignments.push({ memberId: member.id, tagId: tagMap.get('frozen')! });
      }
    }

    if (assignments.length > 0) {
      await this.prisma.memberTag.createMany({
        data: assignments,
        skipDuplicates: true,
      });
    }

    this.logger.log(`System tag refresh complete: ${assignments.length} assignments for ${members.length} members`);
  }

  private async ensureSystemTags() {
    for (const tag of SYSTEM_TAGS) {
      await this.prisma.tag.upsert({
        where: { name: tag.name },
        create: { ...tag, source: TagSource.SYSTEM },
        update: {},
      });
    }
  }

  private async findOneOrFail(id: string) {
    const tag = await this.prisma.tag.findUnique({ where: { id } });
    if (!tag) {
      throw new NotFoundException('Tag not found');
    }
    return tag;
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `yarn test -- --testPathPattern=member-tags`
Expected: All tests PASS.

**Step 5: Commit**

```bash
git add src/member-tags/
git commit -m "feat(member-tags): add service with CRUD, assignment, and daily cron"
```

---

### Task 5: Create member-tags controller

**Files:**
- Create: `src/member-tags/member-tags.controller.ts`

**Step 1: Create the controller**

```typescript
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
import { RequiresFeature } from '../licensing/decorators/requires-feature.decorator';
import { MemberTagsService } from './member-tags.service';
import { CreateTagDto } from './dto/create-tag.dto';
import { UpdateTagDto } from './dto/update-tag.dto';
import { AssignTagDto } from './dto/assign-tag.dto';
import { TagQueryDto } from './dto/tag-query.dto';
import {
  TagResponseDto,
  TagSummaryResponseDto,
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
  @ApiOkResponse({ type: TagSummaryResponseDto })
  getSummary() {
    return this.memberTagsService.getSummary();
  }

  @Post()
  @ApiCreatedResponse({ type: TagResponseDto })
  create(@Body() dto: CreateTagDto) {
    return this.memberTagsService.create(dto);
  }

  @Patch(':id')
  @ApiOkResponse({ type: TagResponseDto })
  @ApiNotFoundResponse({ description: 'Tag not found' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTagDto,
  ) {
    return this.memberTagsService.update(id, dto);
  }

  @Delete(':id')
  @Roles('SUPER_ADMIN')
  @ApiOkResponse({ type: TagResponseDto })
  @ApiNotFoundResponse({ description: 'Tag not found' })
  delete(@Param('id', ParseUUIDPipe) id: string) {
    return this.memberTagsService.delete(id);
  }

  @Post(':tagId/members')
  @ApiCreatedResponse({ description: 'Tag assigned to members' })
  @ApiNotFoundResponse({ description: 'Tag not found' })
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
```

**Step 2: Commit**

```bash
git add src/member-tags/member-tags.controller.ts
git commit -m "feat(member-tags): add controller with CRUD and assignment endpoints"
```

---

### Task 6: Create module and register in AppModule

**Files:**
- Create: `src/member-tags/member-tags.module.ts`
- Modify: `src/app.module.ts`

**Step 1: Create the module**

File: `src/member-tags/member-tags.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { MemberTagsController } from './member-tags.controller';
import { MemberTagsService } from './member-tags.service';
import { GymSettingsModule } from '../gym-settings/gym-settings.module';

@Module({
  imports: [GymSettingsModule],
  controllers: [MemberTagsController],
  providers: [MemberTagsService],
  exports: [MemberTagsService],
})
export class MemberTagsModule {}
```

**Step 2: Register in AppModule**

In `src/app.module.ts`, add import:

```typescript
import { MemberTagsModule } from './member-tags/member-tags.module';
```

Add `MemberTagsModule` to the `imports` array (after `MilestonesModule`).

**Step 3: Verify GymSettingsModule exports GymSettingsService**

Check `src/gym-settings/gym-settings.module.ts` has `exports: [GymSettingsService]`. If not, add it.

**Step 4: Run lint and all tests**

Run: `yarn lint`
Run: `yarn test -- --testPathPattern=member-tags`
Expected: All pass.

**Step 5: Commit**

```bash
git add src/member-tags/member-tags.module.ts src/app.module.ts src/gym-settings/gym-settings.module.ts
git commit -m "feat(member-tags): register module in AppModule"
```

---

### Task 7: Integrate tags with GET /users

**Files:**
- Modify: `src/users/dto/users-query.dto.ts`
- Modify: `src/users/users.service.ts`
- Modify: `src/common/constants/safe-user-select.ts`
- Modify: `src/users/dto/paginated-users-response.dto.ts` (or equivalent response DTO)

**Step 1: Add tags query param to UsersQueryDto**

In `src/users/dto/users-query.dto.ts`, add:

```typescript
import { Transform } from 'class-transformer';
// ... existing imports

@ApiPropertyOptional({
  description: 'Filter by tag names (comma-separated). Returns users with ALL specified tags.',
  example: 'at-risk,inactive',
})
@IsOptional()
@IsString()
@MaxLength(500)
tags?: string;
```

**Step 2: Update safeUserWithSubscriptionSelect to include memberTags**

In `src/common/constants/safe-user-select.ts`, add to `safeUserWithSubscriptionSelect`:

```typescript
memberTags: {
  select: {
    tag: {
      select: {
        name: true,
        source: true,
        color: true,
      },
    },
  },
},
```

**Step 3: Update UsersService.findAll() to filter by tags and flatten tags in response**

In `src/users/users.service.ts`:

1. Add `tags` parameter to `findAll()`:

```typescript
async findAll(
  page: number = 1,
  limit: number = 20,
  role?: Role[],
  search?: string,
  tags?: string,
) {
```

2. Add tag filtering to the `where` clause. If `tags` is provided, parse comma-separated names and filter users who have ALL specified tags:

```typescript
const tagNames = tags ? tags.split(',').map((t) => t.trim()).filter(Boolean) : [];

const where = {
  deletedAt: null,
  ...(role?.length ? { role: { in: role } } : {}),
  ...(search
    ? {
        OR: [
          { firstName: { contains: search, mode: 'insensitive' as const } },
          { lastName: { contains: search, mode: 'insensitive' as const } },
          { email: { contains: search, mode: 'insensitive' as const } },
        ],
      }
    : {}),
  ...(tagNames.length
    ? {
        AND: tagNames.map((name) => ({
          memberTags: { some: { tag: { name } } },
        })),
      }
    : {}),
};
```

3. Update the `flattenSubscription` method (or the map at the end of `findAll`) to include tags:

```typescript
const data = users.map((user) => {
  const flat = this.flattenSubscription(user);
  return {
    ...flat,
    tags: (user as any).memberTags?.map((mt: any) => mt.tag) ?? [],
  };
});
```

**Step 4: Update UsersController.findAll() to pass tags**

In `src/users/users.controller.ts`, update the `findAll` call:

```typescript
findAll(@Query() query: UsersQueryDto) {
  return this.usersService.findAll(
    query.page,
    query.limit,
    query.role,
    query.search,
    query.tags,
  );
}
```

**Step 5: Update the user response DTO to include tags**

Add to the user response DTO (likely `src/users/dto/user-response.dto.ts` or `paginated-users-response.dto.ts`):

```typescript
import { MemberTagResponseDto } from '../../member-tags/dto/tag-response.dto';

// Add to the user response class:
@ApiPropertyOptional({ type: [MemberTagResponseDto] })
tags?: MemberTagResponseDto[];
```

**Step 6: Run lint and tests**

Run: `yarn lint`
Run: `yarn test -- --testPathPattern=users`
Expected: Existing tests still pass (may need minor mock updates if `memberTags` is now expected in select).

**Step 7: Commit**

```bash
git add src/users/ src/common/constants/safe-user-select.ts src/member-tags/dto/tag-response.dto.ts
git commit -m "feat(member-tags): integrate tags with GET /users endpoint"
```

---

### Task 8: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Add member-tags to the modules list**

Add after the `exports/` entry:

```markdown
- `member-tags/` — Member tagging and segmentation. Auto-computed system tags (daily cron: new-member, active, inactive, dormant, at-risk, expired, loyal, frozen) with configurable thresholds via GymSettings. Manual admin tags with CRUD. Tag filtering on `GET /users` via `?tags=` query param. Feature-gated (`member-tags`).
```

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add member-tags module to CLAUDE.md"
```

---

### Task 9: Final verification

**Step 1: Run full lint**

Run: `yarn lint`
Expected: No errors.

**Step 2: Run full type check**

Run: `yarn build`
Expected: Compiles without errors.

**Step 3: Run full test suite**

Run: `yarn test`
Expected: All tests pass, including new member-tags tests.

**Step 4: Commit any fixes**

If any fixes were needed, commit them:

```bash
git commit -m "fix(member-tags): address lint/type/test issues"
```
