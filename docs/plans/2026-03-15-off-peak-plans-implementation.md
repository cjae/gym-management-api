# Off-Peak Plans Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow gyms to define off-peak time windows and restrict check-in for off-peak subscription plans to those windows only.

**Architecture:** New `GymSettings` singleton model with related `OffPeakWindow` rows. `SubscriptionPlan` gets an `isOffPeak` flag. Check-in enforcement in `AttendanceService` validates current gym-local time against windows. New `GymSettingsModule` with CRUD endpoints for SUPER_ADMIN.

**Tech Stack:** NestJS 11, Prisma 6, PostgreSQL, class-validator, `Intl.DateTimeFormat` for timezone conversion (no external libs).

---

### Task 1: Schema — Add GymSettings, OffPeakWindow models and isOffPeak flag

**Files:**
- Modify: `prisma/schema.prisma`

**Step 1: Add DayOfWeek enum after existing enums (after line 86)**

Add this after the `AuditAction` enum:

```prisma
enum DayOfWeek {
  MONDAY
  TUESDAY
  WEDNESDAY
  THURSDAY
  FRIDAY
  SATURDAY
  SUNDAY
}
```

**Step 2: Add GymSettings model (after AuditLog model, around line 366)**

```prisma
model GymSettings {
  id        String   @id @default("singleton")
  timezone  String   @default("Africa/Nairobi")
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  offPeakWindows OffPeakWindow[]
}

model OffPeakWindow {
  id            String     @id @default(uuid())
  gymSettingsId String
  dayOfWeek     DayOfWeek?
  startTime     String     // HH:mm 24h format
  endTime       String     // HH:mm 24h format
  createdAt     DateTime   @default(now())
  updatedAt     DateTime   @updatedAt

  gymSettings GymSettings @relation(fields: [gymSettingsId], references: [id])
}
```

Note: `id @default("singleton")` enforces singleton at the DB level (same pattern as `LicenseCache`).

**Step 3: Add `isOffPeak` to SubscriptionPlan**

In the `SubscriptionPlan` model, add after the `maxFreezeDays` field (line 132):

```prisma
  isOffPeak     Boolean         @default(false)
```

**Step 4: Run migration**

```bash
npx prisma migrate dev --name add-gym-settings-off-peak
```

Expected: Migration created and applied, Prisma client regenerated.

**Step 5: Commit**

```bash
git add prisma/
git commit -m "feat(schema): add GymSettings, OffPeakWindow models and isOffPeak plan flag"
```

---

### Task 2: GymSettings module — Service with caching

**Files:**
- Create: `src/gym-settings/gym-settings.service.ts`
- Create: `src/gym-settings/gym-settings.module.ts`
- Create: `src/gym-settings/dto/upsert-gym-settings.dto.ts`
- Create: `src/gym-settings/dto/create-off-peak-window.dto.ts`
- Create: `src/gym-settings/dto/gym-settings-response.dto.ts`

**Step 1: Create DTOs**

`src/gym-settings/dto/upsert-gym-settings.dto.ts`:

```typescript
import { IsString, IsOptional, Matches } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpsertGymSettingsDto {
  @ApiPropertyOptional({
    example: 'Africa/Nairobi',
    description: 'IANA timezone identifier',
  })
  @IsOptional()
  @IsString()
  timezone?: string;
}
```

`src/gym-settings/dto/create-off-peak-window.dto.ts`:

```typescript
import { IsString, IsOptional, IsEnum, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DayOfWeek } from '@prisma/client';

export class CreateOffPeakWindowDto {
  @ApiPropertyOptional({
    enum: DayOfWeek,
    example: 'MONDAY',
    description: 'Null = applies every day',
  })
  @IsOptional()
  @IsEnum(DayOfWeek)
  dayOfWeek?: DayOfWeek;

  @ApiProperty({ example: '06:00', description: 'Start time in HH:mm 24h format' })
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'startTime must be in HH:mm format (00:00-23:59)',
  })
  startTime: string;

  @ApiProperty({ example: '10:00', description: 'End time in HH:mm 24h format' })
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'endTime must be in HH:mm format (00:00-23:59)',
  })
  endTime: string;
}
```

`src/gym-settings/dto/gym-settings-response.dto.ts`:

```typescript
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class OffPeakWindowResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiPropertyOptional({ enum: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'] })
  dayOfWeek?: string;

  @ApiProperty({ example: '06:00' })
  startTime: string;

  @ApiProperty({ example: '10:00' })
  endTime: string;
}

export class GymSettingsResponseDto {
  @ApiProperty({ example: 'singleton' })
  id: string;

  @ApiProperty({ example: 'Africa/Nairobi' })
  timezone: string;

  @ApiProperty({ type: [OffPeakWindowResponseDto] })
  offPeakWindows: OffPeakWindowResponseDto[];

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
```

**Step 2: Create the service**

`src/gym-settings/gym-settings.service.ts`:

```typescript
import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpsertGymSettingsDto } from './dto/upsert-gym-settings.dto';
import { CreateOffPeakWindowDto } from './dto/create-off-peak-window.dto';

@Injectable()
export class GymSettingsService {
  private cache: {
    settings: any;
    cachedAt: number;
  } | null = null;

  private readonly CACHE_TTL_MS = 60_000; // 1 minute

  constructor(private prisma: PrismaService) {}

  async getSettings() {
    const settings = await this.prisma.gymSettings.findUnique({
      where: { id: 'singleton' },
      include: { offPeakWindows: true },
    });
    if (!settings) {
      throw new NotFoundException('Gym settings not configured');
    }
    return settings;
  }

  async upsert(dto: UpsertGymSettingsDto) {
    if (dto.timezone) {
      this.validateTimezone(dto.timezone);
    }
    const settings = await this.prisma.gymSettings.upsert({
      where: { id: 'singleton' },
      create: { timezone: dto.timezone ?? 'Africa/Nairobi' },
      update: { ...(dto.timezone && { timezone: dto.timezone }) },
      include: { offPeakWindows: true },
    });
    this.invalidateCache();
    return settings;
  }

  async addOffPeakWindow(dto: CreateOffPeakWindowDto) {
    // Ensure settings exist
    let settings = await this.prisma.gymSettings.findUnique({
      where: { id: 'singleton' },
    });
    if (!settings) {
      settings = await this.prisma.gymSettings.create({
        data: { timezone: 'Africa/Nairobi' },
      });
    }

    if (dto.startTime === dto.endTime) {
      throw new BadRequestException('startTime and endTime cannot be the same');
    }

    const window = await this.prisma.offPeakWindow.create({
      data: {
        gymSettingsId: 'singleton',
        dayOfWeek: dto.dayOfWeek ?? null,
        startTime: dto.startTime,
        endTime: dto.endTime,
      },
    });
    this.invalidateCache();
    return window;
  }

  async removeOffPeakWindow(id: string) {
    const window = await this.prisma.offPeakWindow.findUnique({
      where: { id },
    });
    if (!window) {
      throw new NotFoundException(`Off-peak window with id ${id} not found`);
    }
    await this.prisma.offPeakWindow.delete({ where: { id } });
    this.invalidateCache();
    return window;
  }

  /**
   * Get cached settings for use in check-in validation.
   * Returns null if no settings exist (caller should handle).
   */
  async getCachedSettings() {
    if (this.cache && Date.now() - this.cache.cachedAt < this.CACHE_TTL_MS) {
      return this.cache.settings;
    }
    const settings = await this.prisma.gymSettings.findUnique({
      where: { id: 'singleton' },
      include: { offPeakWindows: true },
    });
    if (settings) {
      this.cache = { settings, cachedAt: Date.now() };
    }
    return settings;
  }

  private invalidateCache() {
    this.cache = null;
  }

  private validateTimezone(tz: string) {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: tz });
    } catch {
      throw new BadRequestException(`Invalid timezone: ${tz}`);
    }
  }
}
```

**Step 3: Create the module**

`src/gym-settings/gym-settings.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { GymSettingsService } from './gym-settings.service';
import { GymSettingsController } from './gym-settings.controller';

@Module({
  controllers: [GymSettingsController],
  providers: [GymSettingsService],
  exports: [GymSettingsService],
})
export class GymSettingsModule {}
```

**Step 4: Commit**

```bash
git add src/gym-settings/
git commit -m "feat(gym-settings): add service with caching, DTOs, and module"
```

---

### Task 3: GymSettings controller

**Files:**
- Create: `src/gym-settings/gym-settings.controller.ts`

**Step 1: Create the controller**

```typescript
import {
  Controller,
  Get,
  Put,
  Post,
  Delete,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
} from '@nestjs/swagger';
import { GymSettingsService } from './gym-settings.service';
import { UpsertGymSettingsDto } from './dto/upsert-gym-settings.dto';
import { CreateOffPeakWindowDto } from './dto/create-off-peak-window.dto';
import { GymSettingsResponseDto } from './dto/gym-settings-response.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('Gym Settings')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid JWT' })
@ApiForbiddenResponse({ description: 'Insufficient role' })
@Controller('gym-settings')
@UseGuards(JwtAuthGuard, RolesGuard)
export class GymSettingsController {
  constructor(private readonly gymSettingsService: GymSettingsService) {}

  @Get()
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOkResponse({ type: GymSettingsResponseDto })
  @ApiNotFoundResponse({ description: 'Gym settings not configured' })
  getSettings() {
    return this.gymSettingsService.getSettings();
  }

  @Put()
  @Roles('SUPER_ADMIN')
  @ApiOkResponse({ type: GymSettingsResponseDto })
  upsert(@Body() dto: UpsertGymSettingsDto) {
    return this.gymSettingsService.upsert(dto);
  }

  @Post('off-peak-windows')
  @Roles('SUPER_ADMIN')
  @ApiCreatedResponse({ description: 'Off-peak window created' })
  addOffPeakWindow(@Body() dto: CreateOffPeakWindowDto) {
    return this.gymSettingsService.addOffPeakWindow(dto);
  }

  @Delete('off-peak-windows/:id')
  @Roles('SUPER_ADMIN')
  @ApiOkResponse({ description: 'Off-peak window removed' })
  @ApiNotFoundResponse({ description: 'Window not found' })
  removeOffPeakWindow(@Param('id') id: string) {
    return this.gymSettingsService.removeOffPeakWindow(id);
  }
}
```

**Step 2: Commit**

```bash
git add src/gym-settings/gym-settings.controller.ts
git commit -m "feat(gym-settings): add controller with CRUD endpoints"
```

---

### Task 4: Register GymSettingsModule in AppModule

**Files:**
- Modify: `src/app.module.ts`

**Step 1: Add import**

At the top of `src/app.module.ts`, add:

```typescript
import { GymSettingsModule } from './gym-settings/gym-settings.module';
```

**Step 2: Add to imports array**

Add `GymSettingsModule` to the `imports` array, after `BannersModule` (line 63):

```typescript
    BannersModule,
    GymSettingsModule,
```

**Step 3: Commit**

```bash
git add src/app.module.ts
git commit -m "feat(app): register GymSettingsModule"
```

---

### Task 5: Add isOffPeak to subscription plan DTOs

**Files:**
- Modify: `src/subscription-plans/dto/create-plan.dto.ts`
- Modify: `src/subscription-plans/dto/update-plan.dto.ts`
- Modify: `src/subscription-plans/dto/subscription-plan-response.dto.ts`

**Step 1: Add isOffPeak to CreatePlanDto**

At the end of `CreatePlanDto` class (before the closing `}`), add:

```typescript
  @ApiPropertyOptional({
    example: false,
    description: 'Whether this plan is restricted to off-peak hours',
  })
  @IsOptional()
  @IsBoolean()
  isOffPeak?: boolean;
```

Also add `IsBoolean` to the class-validator import.

**Step 2: Add isOffPeak to UpdatePlanDto**

At the end of `UpdatePlanDto` class (before the closing `}`), add:

```typescript
  @ApiPropertyOptional({
    example: false,
    description: 'Whether this plan is restricted to off-peak hours',
  })
  @IsOptional()
  @IsBoolean()
  isOffPeak?: boolean;
```

**Step 3: Add isOffPeak to SubscriptionPlanResponseDto**

After the `maxFreezeDays` field, add:

```typescript
  @ApiProperty({ example: false })
  isOffPeak: boolean;
```

**Step 4: Commit**

```bash
git add src/subscription-plans/dto/
git commit -m "feat(subscription-plans): add isOffPeak to plan DTOs"
```

---

### Task 6: Off-peak check-in enforcement in AttendanceService

**Files:**
- Modify: `src/attendance/attendance.service.ts`
- Modify: `src/attendance/attendance.module.ts`

**Step 1: Write the failing test**

Add this test to `src/attendance/attendance.service.spec.ts`, after the existing tests but before the `weekly streak logic` describe block:

```typescript
  it('should reject off-peak member checking in during peak hours', async () => {
    prisma.gymQrCode.findFirst.mockResolvedValue({
      id: '1',
      code: 'valid',
    } as any);
    prisma.subscriptionMember.findFirst.mockResolvedValue({
      id: 'sm-1',
      memberId: 'member-1',
      subscriptionId: 'sub-1',
    } as any);
    prisma.memberSubscription.findUnique.mockResolvedValue({
      id: 'sub-1',
      plan: { isOffPeak: true },
    } as any);

    const mockGymSettingsService = {
      getCachedSettings: jest.fn().mockResolvedValue({
        timezone: 'Africa/Nairobi',
        offPeakWindows: [
          { dayOfWeek: null, startTime: '06:00', endTime: '10:00' },
        ],
      }),
    };

    // Override the service's gymSettingsService
    (service as any).gymSettingsService = mockGymSettingsService;

    // Mock current time to 14:00 (peak hours - outside 06:00-10:00)
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-03-15T11:00:00Z')); // 14:00 EAT

    await expect(
      service.checkIn('member-1', { qrCode: 'valid' }),
    ).rejects.toThrow(BadRequestException);

    jest.useRealTimers();
  });

  it('should allow off-peak member checking in during off-peak hours', async () => {
    prisma.gymQrCode.findFirst.mockResolvedValue({
      id: '1',
      code: 'valid',
    } as any);
    prisma.subscriptionMember.findFirst.mockResolvedValue({
      id: 'sm-1',
      memberId: 'member-1',
      subscriptionId: 'sub-1',
    } as any);
    prisma.memberSubscription.findUnique.mockResolvedValue({
      id: 'sub-1',
      plan: { isOffPeak: true },
    } as any);

    const mockGymSettingsService = {
      getCachedSettings: jest.fn().mockResolvedValue({
        timezone: 'Africa/Nairobi',
        offPeakWindows: [
          { dayOfWeek: null, startTime: '06:00', endTime: '10:00' },
        ],
      }),
    };

    (service as any).gymSettingsService = mockGymSettingsService;

    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-03-15T05:00:00Z')); // 08:00 EAT

    prisma.attendance.findUnique.mockResolvedValue(null);
    prisma.attendance.create.mockResolvedValue({} as any);
    prisma.user.findUnique.mockResolvedValue({
      id: 'member-1',
      firstName: 'Jane',
      lastName: 'Smith',
      displayPicture: null,
    } as any);
    prisma.streak.findUnique.mockResolvedValue(null);
    prisma.streak.upsert.mockResolvedValue({
      weeklyStreak: 0,
      longestStreak: 0,
      daysThisWeek: 1,
      weekStart: new Date(),
    } as any);

    const result = await service.checkIn('member-1', { qrCode: 'valid' });
    expect(result.alreadyCheckedIn).toBe(false);

    jest.useRealTimers();
  });
```

**Step 2: Run test to verify it fails**

```bash
yarn test -- --testPathPattern=attendance.service
```

Expected: FAIL — `gymSettingsService` is not injected yet.

**Step 3: Add GymSettingsModule import to AttendanceModule**

Modify `src/attendance/attendance.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { AttendanceController } from './attendance.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { GymSettingsModule } from '../gym-settings/gym-settings.module';

@Module({
  imports: [NotificationsModule, GymSettingsModule],
  controllers: [AttendanceController],
  providers: [AttendanceService],
  exports: [AttendanceService],
})
export class AttendanceModule {}
```

**Step 4: Add off-peak validation to AttendanceService**

Modify `src/attendance/attendance.service.ts`:

Add import at top:
```typescript
import { GymSettingsService } from '../gym-settings/gym-settings.service';
```

Add to constructor:
```typescript
  constructor(
    private prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly notificationsService: NotificationsService,
    private readonly gymSettingsService: GymSettingsService,
  ) {}
```

After the active subscription check (after line 91, before the idempotent check), add:

```typescript
    // Check off-peak restriction
    const subscription = await this.prisma.memberSubscription.findUnique({
      where: { id: activeMembership.subscriptionId },
      include: { plan: { select: { isOffPeak: true } } },
    });

    if (subscription?.plan.isOffPeak) {
      await this.validateOffPeakWindow(memberId, entranceId);
    }
```

Add this private method to the service (before `getMondayOfWeek`):

```typescript
  private async validateOffPeakWindow(
    memberId: string,
    entranceId?: string,
  ) {
    const settings = await this.gymSettingsService.getCachedSettings();
    if (!settings || settings.offPeakWindows.length === 0) {
      throw new BadRequestException(
        'Off-peak hours not configured. Contact gym admin.',
      );
    }

    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: settings.timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      weekday: 'long',
    });

    const parts = formatter.formatToParts(now);
    const hour = parseInt(parts.find((p) => p.type === 'hour')!.value, 10);
    const minute = parseInt(parts.find((p) => p.type === 'minute')!.value, 10);
    const currentMinutes = hour * 60 + minute;

    const weekdayName = parts.find((p) => p.type === 'weekday')!.value;
    const dayOfWeekMap: Record<string, string> = {
      Monday: 'MONDAY',
      Tuesday: 'TUESDAY',
      Wednesday: 'WEDNESDAY',
      Thursday: 'THURSDAY',
      Friday: 'FRIDAY',
      Saturday: 'SATURDAY',
      Sunday: 'SUNDAY',
    };
    const currentDay = dayOfWeekMap[weekdayName];

    // Find applicable windows: day-specific for today + universal (null day)
    const applicableWindows = settings.offPeakWindows.filter(
      (w: { dayOfWeek: string | null }) =>
        w.dayOfWeek === null || w.dayOfWeek === currentDay,
    );

    const isWithinWindow = applicableWindows.some(
      (w: { startTime: string; endTime: string }) => {
        const [sh, sm] = w.startTime.split(':').map(Number);
        const [eh, em] = w.endTime.split(':').map(Number);
        const start = sh * 60 + sm;
        const end = eh * 60 + em;

        if (start <= end) {
          // Normal window: e.g., 06:00-10:00
          return currentMinutes >= start && currentMinutes < end;
        } else {
          // Overnight window: e.g., 22:00-05:00
          return currentMinutes >= start || currentMinutes < end;
        }
      },
    );

    if (!isWithinWindow) {
      const windowDescriptions = applicableWindows
        .map(
          (w: { startTime: string; endTime: string; dayOfWeek: string | null }) =>
            `${w.startTime}-${w.endTime}${w.dayOfWeek ? ` (${w.dayOfWeek})` : ''}`,
        )
        .join(', ');

      const member = await this.prisma.user.findUnique({
        where: { id: memberId },
        select: { id: true, firstName: true, lastName: true, displayPicture: true },
      });
      this.eventEmitter.emit('check_in.result', {
        type: 'check_in_result',
        member: {
          id: memberId,
          firstName: member?.firstName ?? null,
          lastName: member?.lastName ?? null,
          displayPicture: member?.displayPicture ?? null,
        },
        success: false,
        message: 'Outside off-peak hours',
        entranceId,
        timestamp: new Date().toISOString(),
      });

      throw new BadRequestException(
        `Check-in restricted to off-peak hours: ${windowDescriptions}`,
      );
    }
  }
```

**Step 5: Update the test setup to inject GymSettingsService**

In `src/attendance/attendance.service.spec.ts`, add to the providers in `beforeEach`:

```typescript
import { GymSettingsService } from '../gym-settings/gym-settings.service';

// In the providers array:
{
  provide: GymSettingsService,
  useValue: { getCachedSettings: jest.fn().mockResolvedValue(null) },
},
```

Also update the existing tests' `subscriptionMember.findFirst` mock to include `subscriptionId`:

```typescript
prisma.subscriptionMember.findFirst.mockResolvedValue({
  id: 'sm-1',
  memberId: 'member-1',
  subscriptionId: 'sub-1',
} as any);
```

And mock `memberSubscription.findUnique` to return a non-off-peak plan for existing tests:

```typescript
prisma.memberSubscription.findUnique.mockResolvedValue({
  id: 'sub-1',
  plan: { isOffPeak: false },
} as any);
```

This needs to be added to `setupCheckInMocks()` and to the individual tests that mock `subscriptionMember.findFirst` (the "successful check-in", "re-scan", "entranceId", and "backwards compatibility" tests).

**Step 6: Run tests to verify they pass**

```bash
yarn test -- --testPathPattern=attendance.service
```

Expected: ALL PASS (existing + 2 new off-peak tests).

**Step 7: Commit**

```bash
git add src/attendance/ src/gym-settings/
git commit -m "feat(attendance): enforce off-peak check-in restrictions"
```

---

### Task 7: GymSettings unit tests

**Files:**
- Create: `src/gym-settings/gym-settings.service.spec.ts`

**Step 1: Write the tests**

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaClient } from '@prisma/client';
import { GymSettingsService } from './gym-settings.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';

describe('GymSettingsService', () => {
  let service: GymSettingsService;
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GymSettingsService,
        { provide: PrismaService, useValue: mockDeep<PrismaClient>() },
      ],
    }).compile();
    service = module.get<GymSettingsService>(GymSettingsService);
    prisma = module.get(PrismaService);
  });

  describe('getSettings', () => {
    it('should return settings with off-peak windows', async () => {
      const settings = {
        id: 'singleton',
        timezone: 'Africa/Nairobi',
        offPeakWindows: [
          { id: 'w1', startTime: '06:00', endTime: '10:00', dayOfWeek: null },
        ],
      };
      prisma.gymSettings.findUnique.mockResolvedValue(settings as any);
      const result = await service.getSettings();
      expect(result.timezone).toBe('Africa/Nairobi');
      expect(result.offPeakWindows).toHaveLength(1);
    });

    it('should throw NotFoundException when no settings exist', async () => {
      prisma.gymSettings.findUnique.mockResolvedValue(null);
      await expect(service.getSettings()).rejects.toThrow(NotFoundException);
    });
  });

  describe('upsert', () => {
    it('should create settings with valid timezone', async () => {
      const settings = {
        id: 'singleton',
        timezone: 'Africa/Nairobi',
        offPeakWindows: [],
      };
      prisma.gymSettings.upsert.mockResolvedValue(settings as any);
      const result = await service.upsert({ timezone: 'Africa/Nairobi' });
      expect(result.timezone).toBe('Africa/Nairobi');
    });

    it('should reject invalid timezone', async () => {
      await expect(
        service.upsert({ timezone: 'Invalid/Timezone' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('addOffPeakWindow', () => {
    it('should create window when settings exist', async () => {
      prisma.gymSettings.findUnique.mockResolvedValue({
        id: 'singleton',
      } as any);
      prisma.offPeakWindow.create.mockResolvedValue({
        id: 'w1',
        startTime: '06:00',
        endTime: '10:00',
        dayOfWeek: null,
      } as any);
      const result = await service.addOffPeakWindow({
        startTime: '06:00',
        endTime: '10:00',
      });
      expect(result.startTime).toBe('06:00');
    });

    it('should auto-create settings if none exist', async () => {
      prisma.gymSettings.findUnique.mockResolvedValue(null);
      prisma.gymSettings.create.mockResolvedValue({
        id: 'singleton',
      } as any);
      prisma.offPeakWindow.create.mockResolvedValue({
        id: 'w1',
        startTime: '06:00',
        endTime: '10:00',
      } as any);
      await service.addOffPeakWindow({
        startTime: '06:00',
        endTime: '10:00',
      });
      expect(prisma.gymSettings.create).toHaveBeenCalled();
    });

    it('should reject same start and end time', async () => {
      prisma.gymSettings.findUnique.mockResolvedValue({
        id: 'singleton',
      } as any);
      await expect(
        service.addOffPeakWindow({ startTime: '10:00', endTime: '10:00' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('removeOffPeakWindow', () => {
    it('should delete existing window', async () => {
      prisma.offPeakWindow.findUnique.mockResolvedValue({
        id: 'w1',
      } as any);
      prisma.offPeakWindow.delete.mockResolvedValue({ id: 'w1' } as any);
      await service.removeOffPeakWindow('w1');
      expect(prisma.offPeakWindow.delete).toHaveBeenCalledWith({
        where: { id: 'w1' },
      });
    });

    it('should throw NotFoundException for missing window', async () => {
      prisma.offPeakWindow.findUnique.mockResolvedValue(null);
      await expect(
        service.removeOffPeakWindow('missing'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getCachedSettings', () => {
    it('should return cached value on second call', async () => {
      const settings = {
        id: 'singleton',
        timezone: 'Africa/Nairobi',
        offPeakWindows: [],
      };
      prisma.gymSettings.findUnique.mockResolvedValue(settings as any);

      await service.getCachedSettings();
      await service.getCachedSettings();

      expect(prisma.gymSettings.findUnique).toHaveBeenCalledTimes(1);
    });
  });
});
```

**Step 2: Run tests**

```bash
yarn test -- --testPathPattern=gym-settings
```

Expected: ALL PASS.

**Step 3: Commit**

```bash
git add src/gym-settings/gym-settings.service.spec.ts
git commit -m "test(gym-settings): add unit tests for service"
```

---

### Task 8: Update seed data

**Files:**
- Modify: `prisma/seed.ts`

**Step 1: Add GymSettings and off-peak plan to seed**

At the end of `main()` (before `console.log('Seed data created successfully')`), add:

```typescript
  // Gym Settings with off-peak windows
  await prisma.gymSettings.create({
    data: {
      id: 'singleton',
      timezone: 'Africa/Nairobi',
      offPeakWindows: {
        create: [
          { startTime: '06:00', endTime: '10:00' },
          { startTime: '14:00', endTime: '17:00' },
        ],
      },
    },
  });

  // Off-peak subscription plan
  await prisma.subscriptionPlan.create({
    data: {
      name: 'Off-Peak Monthly',
      price: 2000,
      currency: 'KES',
      billingInterval: 'MONTHLY',
      description: 'Monthly membership restricted to off-peak hours (6-10am, 2-5pm)',
      maxMembers: 1,
      isOffPeak: true,
    },
  });
```

**Step 2: Commit**

```bash
git add prisma/seed.ts
git commit -m "feat(seed): add GymSettings, off-peak windows, and off-peak plan"
```

---

### Task 9: Run full test suite and lint

**Step 1: Run all tests**

```bash
yarn test
```

Expected: ALL PASS.

**Step 2: Run lint**

```bash
yarn lint
```

Expected: No errors.

**Step 3: Final commit if lint fixed anything**

```bash
git add -A
git commit -m "chore: lint fixes"
```

(Only if lint made changes.)
