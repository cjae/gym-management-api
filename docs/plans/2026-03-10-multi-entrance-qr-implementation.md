# Multi-Entrance QR Check-in Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow gyms with multiple entrance points to display QR codes on separate screens, routing check-in result banners to only the entrance where the scan occurred.

**Architecture:** New `Entrance` Prisma model with admin CRUD. The shared rotating QR code stays unchanged. Each entrance screen appends its UUID to the QR payload (`code:entranceId`). The attendance service splits and validates both parts, saves `entranceId` on the attendance record, and includes it in WebSocket events. The gateway uses Socket.IO rooms to route `check_in_result` to the correct entrance screen.

**Tech Stack:** NestJS 11, Prisma 6, Socket.IO, Jest

**Design doc:** `docs/plans/2026-03-10-multi-entrance-qr-design.md`

---

### Task 1: Prisma Schema — Add Entrance model and Attendance FK

**Files:**
- Modify: `prisma/schema.prisma:135-144` (Attendance model), add new Entrance model after line 275

**Step 1: Add Entrance model to schema**

Add after `GymQrCode` model (line 275):

```prisma
model Entrance {
  id        String   @id @default(uuid())
  name      String
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  attendances Attendance[]
}
```

**Step 2: Add entranceId FK to Attendance model**

Update the Attendance model (lines 135-144) to:

```prisma
model Attendance {
  id          String    @id @default(uuid())
  memberId    String
  checkInDate DateTime  @db.Date
  checkInTime DateTime  @default(now())
  entranceId  String?

  member   User      @relation(fields: [memberId], references: [id])
  entrance Entrance? @relation(fields: [entranceId], references: [id])

  @@unique([memberId, checkInDate])
}
```

**Step 3: Generate migration**

Run: `npx prisma migrate dev --name add_entrance_model`
Expected: Migration created and applied, Prisma client regenerated.

**Step 4: Verify Prisma client**

Run: `npx prisma generate`
Expected: No errors.

**Step 5: Commit**

```bash
git add prisma/
git commit -m "feat(schema): add Entrance model and entranceId FK on Attendance"
```

---

### Task 2: Entrance Module — DTOs

**Files:**
- Create: `src/entrances/dto/create-entrance.dto.ts`
- Create: `src/entrances/dto/update-entrance.dto.ts`
- Create: `src/entrances/dto/entrance-response.dto.ts`

**Step 1: Create CreateEntranceDto**

```typescript
// src/entrances/dto/create-entrance.dto.ts
import { IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateEntranceDto {
  @ApiProperty({ example: 'Front Door' })
  @IsString()
  @MaxLength(100)
  name: string;
}
```

**Step 2: Create UpdateEntranceDto**

```typescript
// src/entrances/dto/update-entrance.dto.ts
import { IsString, IsOptional, IsBoolean, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateEntranceDto {
  @ApiPropertyOptional({ example: 'Side Gate' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
```

**Step 3: Create EntranceResponseDto**

```typescript
// src/entrances/dto/entrance-response.dto.ts
import { ApiProperty } from '@nestjs/swagger';

export class EntranceResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Front Door' })
  name: string;

  @ApiProperty({ example: true })
  isActive: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
```

**Step 4: Commit**

```bash
git add src/entrances/
git commit -m "feat(entrances): add DTOs for entrance CRUD"
```

---

### Task 3: Entrance Module — Service with Tests (TDD)

**Files:**
- Create: `src/entrances/entrances.service.ts`
- Create: `src/entrances/entrances.service.spec.ts`

**Step 1: Write the failing tests**

```typescript
// src/entrances/entrances.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { EntrancesService } from './entrances.service';
import { PrismaService } from '../prisma/prisma.service';

describe('EntrancesService', () => {
  let service: EntrancesService;

  const mockPrisma = {
    entrance: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EntrancesService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<EntrancesService>(EntrancesService);
    jest.clearAllMocks();
  });

  it('should create an entrance', async () => {
    const entrance = { id: 'e-1', name: 'Front Door', isActive: true };
    mockPrisma.entrance.create.mockResolvedValue(entrance);

    const result = await service.create({ name: 'Front Door' });
    expect(result).toEqual(entrance);
    expect(mockPrisma.entrance.create).toHaveBeenCalledWith({
      data: { name: 'Front Door' },
    });
  });

  it('should return paginated entrances', async () => {
    const entrances = [{ id: 'e-1', name: 'Front Door' }];
    mockPrisma.entrance.findMany.mockResolvedValue(entrances);
    mockPrisma.entrance.count.mockResolvedValue(1);

    const result = await service.findAll(1, 20);
    expect(result).toEqual({ data: entrances, total: 1, page: 1, limit: 20 });
  });

  it('should find one entrance by id', async () => {
    const entrance = { id: 'e-1', name: 'Front Door' };
    mockPrisma.entrance.findUnique.mockResolvedValue(entrance);

    const result = await service.findOne('e-1');
    expect(result).toEqual(entrance);
  });

  it('should throw NotFoundException for missing entrance', async () => {
    mockPrisma.entrance.findUnique.mockResolvedValue(null);
    await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
  });

  it('should update an entrance', async () => {
    const entrance = { id: 'e-1', name: 'Side Gate', isActive: true };
    mockPrisma.entrance.findUnique.mockResolvedValue(entrance);
    mockPrisma.entrance.update.mockResolvedValue({ ...entrance, name: 'Side Gate' });

    const result = await service.update('e-1', { name: 'Side Gate' });
    expect(result.name).toBe('Side Gate');
  });

  it('should delete an entrance', async () => {
    const entrance = { id: 'e-1', name: 'Front Door' };
    mockPrisma.entrance.findUnique.mockResolvedValue(entrance);
    mockPrisma.entrance.delete.mockResolvedValue(entrance);

    const result = await service.remove('e-1');
    expect(result).toEqual(entrance);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `yarn test -- --testPathPattern=entrances`
Expected: FAIL — cannot find module `./entrances.service`

**Step 3: Write the service**

```typescript
// src/entrances/entrances.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEntranceDto } from './dto/create-entrance.dto';
import { UpdateEntranceDto } from './dto/update-entrance.dto';

@Injectable()
export class EntrancesService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateEntranceDto) {
    return this.prisma.entrance.create({ data: dto });
  }

  async findAll(page: number = 1, limit: number = 20) {
    const [data, total] = await Promise.all([
      this.prisma.entrance.findMany({
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.entrance.count(),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const entrance = await this.prisma.entrance.findUnique({ where: { id } });
    if (!entrance) {
      throw new NotFoundException(`Entrance with id ${id} not found`);
    }
    return entrance;
  }

  async update(id: string, dto: UpdateEntranceDto) {
    await this.findOne(id);
    return this.prisma.entrance.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.entrance.delete({ where: { id } });
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `yarn test -- --testPathPattern=entrances`
Expected: 6 tests PASS

**Step 5: Commit**

```bash
git add src/entrances/
git commit -m "feat(entrances): add service with unit tests"
```

---

### Task 4: Entrance Module — Controller and Module Registration

**Files:**
- Create: `src/entrances/entrances.controller.ts`
- Create: `src/entrances/entrances.module.ts`
- Modify: `src/app.module.ts:1-74`

**Step 1: Create the controller**

```typescript
// src/entrances/entrances.controller.ts
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
} from '@nestjs/swagger';
import { EntrancesService } from './entrances.service';
import { CreateEntranceDto } from './dto/create-entrance.dto';
import { UpdateEntranceDto } from './dto/update-entrance.dto';
import { EntranceResponseDto } from './dto/entrance-response.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';

@ApiTags('Entrances')
@ApiBearerAuth()
@Controller('entrances')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'SUPER_ADMIN')
export class EntrancesController {
  constructor(private readonly entrancesService: EntrancesService) {}

  @Post()
  @ApiCreatedResponse({ type: EntranceResponseDto })
  create(@Body() dto: CreateEntranceDto) {
    return this.entrancesService.create(dto);
  }

  @Get()
  @ApiOkResponse({ type: [EntranceResponseDto] })
  findAll(@Query() query: PaginationQueryDto) {
    return this.entrancesService.findAll(query.page, query.limit);
  }

  @Get(':id')
  @ApiOkResponse({ type: EntranceResponseDto })
  @ApiNotFoundResponse({ description: 'Entrance not found' })
  findOne(@Param('id') id: string) {
    return this.entrancesService.findOne(id);
  }

  @Patch(':id')
  @ApiOkResponse({ type: EntranceResponseDto })
  @ApiNotFoundResponse({ description: 'Entrance not found' })
  update(@Param('id') id: string, @Body() dto: UpdateEntranceDto) {
    return this.entrancesService.update(id, dto);
  }

  @Delete(':id')
  @ApiOkResponse({ type: EntranceResponseDto })
  @ApiNotFoundResponse({ description: 'Entrance not found' })
  remove(@Param('id') id: string) {
    return this.entrancesService.remove(id);
  }
}
```

**Step 2: Create the module**

```typescript
// src/entrances/entrances.module.ts
import { Module } from '@nestjs/common';
import { EntrancesService } from './entrances.service';
import { EntrancesController } from './entrances.controller';

@Module({
  controllers: [EntrancesController],
  providers: [EntrancesService],
  exports: [EntrancesService],
})
export class EntrancesModule {}
```

**Step 3: Register in AppModule**

In `src/app.module.ts`, add import statement:

```typescript
import { EntrancesModule } from './entrances/entrances.module';
```

Add `EntrancesModule` to the `imports` array (after `AttendanceModule`).

**Step 4: Run lint and tests**

Run: `yarn lint && yarn test`
Expected: No lint errors, all tests pass.

**Step 5: Commit**

```bash
git add src/entrances/ src/app.module.ts
git commit -m "feat(entrances): add controller, module, register in AppModule"
```

---

### Task 5: Update Attendance Check-in — Parse QR Payload and Validate Entrance

**Files:**
- Modify: `src/attendance/attendance.service.ts:17-144`
- Modify: `src/attendance/attendance.service.spec.ts`

**Step 1: Write failing tests for entrance parsing**

Add to `src/attendance/attendance.service.spec.ts`, add `entrance` to `mockPrisma`:

```typescript
// Add to mockPrisma object:
entrance: { findUnique: jest.fn() },
```

Add new test cases:

```typescript
it('should parse entranceId from QR payload and save on attendance', async () => {
  const entranceId = 'entrance-1';
  mockPrisma.gymQrCode.findFirst.mockResolvedValue({ id: '1', code: 'valid' });
  mockPrisma.entrance.findUnique.mockResolvedValue({ id: entranceId, name: 'Front Door', isActive: true });
  mockPrisma.subscriptionMember.findFirst.mockResolvedValue({ id: 'sm-1', memberId: 'member-1' });
  mockPrisma.attendance.findUnique.mockResolvedValue(null);
  mockPrisma.attendance.create.mockResolvedValue({});
  mockPrisma.user.findUnique.mockResolvedValue({
    id: 'member-1', firstName: 'Jane', lastName: 'Smith', displayPicture: null,
  });
  mockPrisma.streak.findUnique.mockResolvedValue(null);
  mockPrisma.streak.upsert.mockResolvedValue({ currentStreak: 1, longestStreak: 1 });

  await service.checkIn('member-1', { qrCode: `valid:${entranceId}` });

  expect(mockPrisma.attendance.create).toHaveBeenCalledWith({
    data: expect.objectContaining({ entranceId }),
  });
  expect(mockEventEmitter.emit).toHaveBeenCalledWith(
    'check_in.result',
    expect.objectContaining({ entranceId }),
  );
});

it('should reject check-in with inactive entrance', async () => {
  mockPrisma.gymQrCode.findFirst.mockResolvedValue({ id: '1', code: 'valid' });
  mockPrisma.entrance.findUnique.mockResolvedValue({ id: 'e-1', name: 'Closed Gate', isActive: false });

  await expect(
    service.checkIn('member-1', { qrCode: 'valid:e-1' }),
  ).rejects.toThrow(BadRequestException);
});

it('should reject check-in with non-existent entrance', async () => {
  mockPrisma.gymQrCode.findFirst.mockResolvedValue({ id: '1', code: 'valid' });
  mockPrisma.entrance.findUnique.mockResolvedValue(null);

  await expect(
    service.checkIn('member-1', { qrCode: 'valid:missing-id' }),
  ).rejects.toThrow(BadRequestException);
});

it('should work without entranceId for backwards compatibility', async () => {
  mockPrisma.gymQrCode.findFirst.mockResolvedValue({ id: '1', code: 'valid' });
  mockPrisma.subscriptionMember.findFirst.mockResolvedValue({ id: 'sm-1', memberId: 'member-1' });
  mockPrisma.attendance.findUnique.mockResolvedValue(null);
  mockPrisma.attendance.create.mockResolvedValue({});
  mockPrisma.user.findUnique.mockResolvedValue({
    id: 'member-1', firstName: 'Jane', lastName: 'Smith', displayPicture: null,
  });
  mockPrisma.streak.findUnique.mockResolvedValue(null);
  mockPrisma.streak.upsert.mockResolvedValue({ currentStreak: 1, longestStreak: 1 });

  await service.checkIn('member-1', { qrCode: 'valid' });

  expect(mockPrisma.entrance.findUnique).not.toHaveBeenCalled();
  expect(mockPrisma.attendance.create).toHaveBeenCalledWith({
    data: expect.objectContaining({ entranceId: undefined }),
  });
});
```

**Step 2: Run tests to verify new tests fail**

Run: `yarn test -- --testPathPattern=attendance`
Expected: New tests FAIL

**Step 3: Update the checkIn method in attendance.service.ts**

Replace the beginning of the `checkIn` method (lines 17-26) with entrance-aware logic:

```typescript
async checkIn(memberId: string, dto: CheckInDto) {
  // 1. Parse QR payload — format: "code" or "code:entranceId"
  let qrCode = dto.qrCode;
  let entranceId: string | undefined;

  const delimiterIndex = qrCode.lastIndexOf(':');
  if (delimiterIndex > 0) {
    qrCode = dto.qrCode.substring(0, delimiterIndex);
    entranceId = dto.qrCode.substring(delimiterIndex + 1);
  }

  // 2. Validate QR code
  const qr = await this.prisma.gymQrCode.findFirst({
    where: {
      code: qrCode,
      isActive: true,
      OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }],
    },
  });
  if (!qr) throw new BadRequestException('Invalid or expired QR code');

  // 3. Validate entrance (if provided)
  if (entranceId) {
    const entrance = await this.prisma.entrance.findUnique({
      where: { id: entranceId },
    });
    if (!entrance || !entrance.isActive) {
      throw new BadRequestException('Invalid or inactive entrance');
    }
  }
```

Then update the `attendance.create` call (around line 100-102) to include `entranceId`:

```typescript
await this.prisma.attendance.create({
  data: { memberId, checkInDate: today, entranceId },
});
```

Then update all three `check_in.result` event emissions to include `entranceId`:

Add `entranceId` to every `this.eventEmitter.emit('check_in.result', { ... })` call — there are 3 of them (no-subscription failure at ~line 45, already-checked-in at ~line 81, success at ~line 125).

**Step 4: Run tests to verify they pass**

Run: `yarn test -- --testPathPattern=attendance`
Expected: All tests PASS (existing + new)

**Step 5: Run lint**

Run: `yarn lint`
Expected: No errors

**Step 6: Commit**

```bash
git add src/attendance/
git commit -m "feat(attendance): parse entrance from QR payload and save on check-in"
```

---

### Task 6: Update AttendanceResponseDto and getTodayAttendance

**Files:**
- Modify: `src/attendance/dto/attendance-response.dto.ts`
- Modify: `src/attendance/attendance.service.ts:200-216` (getTodayAttendance)

**Step 1: Add entranceId to AttendanceResponseDto**

Add to `src/attendance/dto/attendance-response.dto.ts`:

```typescript
@ApiPropertyOptional({ format: 'uuid' })
entranceId?: string;
```

**Step 2: Include entrance relation in getTodayAttendance**

Update `getTodayAttendance` to include the entrance name:

```typescript
async getTodayAttendance() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return this.prisma.attendance.findMany({
    where: { checkInDate: today },
    include: {
      member: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
        },
      },
      entrance: {
        select: { id: true, name: true },
      },
    },
  });
}
```

**Step 3: Run lint and tests**

Run: `yarn lint && yarn test`
Expected: All pass

**Step 4: Commit**

```bash
git add src/attendance/
git commit -m "feat(attendance): include entrance in response DTOs and today query"
```

---

### Task 7: WebSocket Room-based Routing

**Files:**
- Modify: `src/analytics/activity.gateway.ts:20-32` (CheckInResultEvent interface)
- Modify: `src/analytics/activity.gateway.ts:52-86` (handleConnection)
- Modify: `src/analytics/activity.gateway.ts:108-111` (handleCheckInResult)

**Step 1: Update CheckInResultEvent interface**

Add `entranceId` to the interface (line 22-32):

```typescript
export interface CheckInResultEvent {
  type: 'check_in_result';
  member: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    displayPicture: string | null;
  };
  success: boolean;
  message: string;
  entranceId?: string;
  timestamp: string;
}
```

**Step 2: Update handleConnection for entrance room joining**

After the admin role check (line 82), add room joining logic. The entrance screen passes `entranceId` in `client.handshake.query`:

```typescript
async handleConnection(client: Socket) {
  try {
    const token = (client.handshake.auth as Record<string, string>)?.token;
    if (!token) {
      client.disconnect();
      return;
    }

    const authConfig =
      this.configService.get<AuthConfig>(getAuthConfigName())!;
    const payload: { sub: string; role: string; jti: string } =
      await this.jwtService.verifyAsync(token, {
        secret: authConfig.jwtSecret,
      });

    // Check token not invalidated
    const invalidated = await this.prisma.invalidatedToken.findUnique({
      where: { jti: payload.jti },
    });
    if (invalidated) {
      client.disconnect();
      return;
    }

    // Only allow ADMIN and SUPER_ADMIN
    if (!['ADMIN', 'SUPER_ADMIN'].includes(payload.role)) {
      client.disconnect();
      return;
    }

    // Join entrance-specific room if entranceId provided
    const entranceId = client.handshake.query?.entranceId as string | undefined;
    if (entranceId) {
      await client.join(`entrance:${entranceId}`);
      this.logger.log(`Screen joined entrance room: ${entranceId}`);
    }

    this.logger.log(`Admin connected: ${payload.sub}`);
  } catch {
    client.disconnect();
  }
}
```

**Step 3: Update handleCheckInResult for room-based routing**

Replace the `handleCheckInResult` method (lines 108-111):

```typescript
@OnEvent('check_in.result')
handleCheckInResult(payload: CheckInResultEvent) {
  // Always broadcast to all admins
  this.server.emit('check_in_result', payload);

  // Also emit to entrance-specific room
  if (payload.entranceId) {
    this.server.to(`entrance:${payload.entranceId}`).emit('check_in_result_entrance', payload);
  }
}
```

Note: We emit to two channels — `check_in_result` for admin dashboards (existing behavior) and `check_in_result_entrance` for entrance screens. This way entrance screens can listen to `check_in_result_entrance` to only get their own events (via room), while admin dashboards continue receiving all events on `check_in_result`.

**Step 4: Run lint and tests**

Run: `yarn lint && yarn test`
Expected: All pass

**Step 5: Commit**

```bash
git add src/analytics/
git commit -m "feat(gateway): route check_in_result to entrance-specific rooms"
```

---

### Task 8: Final Integration Test and Cleanup

**Step 1: Run full test suite**

Run: `yarn test`
Expected: All tests pass

**Step 2: Run lint**

Run: `yarn lint`
Expected: No errors

**Step 3: Build**

Run: `yarn build`
Expected: Compiles without errors

**Step 4: Verify Swagger**

Run: `yarn start:dev` and check `http://localhost:3000/api/docs`
Expected: New "Entrances" section visible with all 5 endpoints. Attendance DTOs show optional `entranceId`.

**Step 5: Commit any remaining changes**

```bash
git add -A
git commit -m "chore: final cleanup for multi-entrance QR feature"
```
