# Real-Time QR Attendance Check-In — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add daily auto-rotating QR codes, real-time check-in result broadcasting to the admin entrance screen, and emit events for both successful and failed check-ins.

**Architecture:** Daily cron generates a new QR code and emits a `qr.rotated` event. The attendance check-in service emits `check_in.result` events (success and failure) with member details. The `ActivityGateway` broadcasts both event types to connected admin clients via Socket.IO.

**Tech Stack:** NestJS 11, `@nestjs/schedule` (cron), `@nestjs/event-emitter`, `@nestjs/websockets` + Socket.IO

**Design doc:** `docs/plans/2026-03-10-qr-attendance-realtime-design.md`

---

### Task 1: Add Daily QR Cron Job to QrService

**Files:**
- Modify: `src/qr/qr.service.ts`
- Modify: `src/qr/qr.module.ts`
- Create: `src/qr/qr.service.spec.ts`

**Step 1: Write the failing test**

Create `src/qr/qr.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { QrService } from './qr.service';
import { PrismaService } from '../prisma/prisma.service';

describe('QrService', () => {
  let service: QrService;

  const mockPrisma = {
    gymQrCode: {
      updateMany: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
    },
  };

  const mockEventEmitter = { emit: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QrService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventEmitter2, useValue: mockEventEmitter },
      ],
    }).compile();
    service = module.get<QrService>(QrService);
    jest.clearAllMocks();
  });

  describe('generateCode', () => {
    it('should deactivate old codes and create a new one', async () => {
      const newCode = { id: '1', code: 'abc', isActive: true };
      mockPrisma.gymQrCode.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.gymQrCode.create.mockResolvedValue(newCode);

      const result = await service.generateCode();

      expect(mockPrisma.gymQrCode.updateMany).toHaveBeenCalledWith({
        where: { isActive: true },
        data: { isActive: false },
      });
      expect(result).toEqual(newCode);
    });
  });

  describe('rotateDailyCode', () => {
    it('should generate a new code and emit qr.rotated event', async () => {
      const newCode = { id: '1', code: 'abc', isActive: true };
      mockPrisma.gymQrCode.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.gymQrCode.create.mockResolvedValue(newCode);

      await service.rotateDailyCode();

      expect(mockPrisma.gymQrCode.create).toHaveBeenCalled();
      expect(mockEventEmitter.emit).toHaveBeenCalledWith('qr.rotated', {
        type: 'qr_rotated',
        timestamp: expect.any(String),
      });
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `yarn test -- --testPathPattern=qr.service`
Expected: FAIL — `QrService` constructor expects `EventEmitter2` but doesn't have it yet, and `rotateDailyCode` doesn't exist.

**Step 3: Implement the changes**

Update `src/qr/qr.service.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import * as crypto from 'crypto';

@Injectable()
export class QrService {
  private readonly logger = new Logger(QrService.name);

  constructor(
    private prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async generateCode() {
    await this.prisma.gymQrCode.updateMany({
      where: { isActive: true },
      data: { isActive: false },
    });
    const code = crypto.randomBytes(32).toString('hex');
    return this.prisma.gymQrCode.create({ data: { code, isActive: true } });
  }

  async getActiveCode() {
    return this.prisma.gymQrCode.findFirst({ where: { isActive: true } });
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async rotateDailyCode() {
    this.logger.log('Rotating daily QR code');
    await this.generateCode();
    this.eventEmitter.emit('qr.rotated', {
      type: 'qr_rotated',
      timestamp: new Date().toISOString(),
    });
  }
}
```

No changes needed to `src/qr/qr.module.ts` — `ScheduleModule` and `EventEmitterModule` are already loaded globally in `AppModule`.

**Step 4: Run test to verify it passes**

Run: `yarn test -- --testPathPattern=qr.service`
Expected: PASS (2 tests)

**Step 5: Commit**

```bash
git add src/qr/qr.service.ts src/qr/qr.service.spec.ts
git commit -m "feat(qr): add daily midnight QR code rotation with cron"
```

---

### Task 2: Emit check_in.result Event on Successful Check-In

**Files:**
- Modify: `src/attendance/attendance.service.ts`
- Modify: `src/attendance/attendance.service.spec.ts`

**Step 1: Write the failing test**

Add to `src/attendance/attendance.service.spec.ts`, inside the `describe` block:

```typescript
it('should emit check_in.result event on successful check-in', async () => {
  const memberId = 'member-1';
  mockPrisma.gymQrCode.findFirst.mockResolvedValue({ id: '1', code: 'valid' });
  mockPrisma.subscriptionMember.findFirst.mockResolvedValue({ id: 'sub-1' });
  mockPrisma.attendance.findUnique.mockResolvedValue(null);
  mockPrisma.attendance.create.mockResolvedValue({});
  mockPrisma.user.findUnique.mockResolvedValue({
    firstName: 'Jane',
    lastName: 'Doe',
    displayPicture: 'https://example.com/photo.jpg',
  });
  mockPrisma.streak.findUnique.mockResolvedValue(null);
  mockPrisma.streak.upsert.mockResolvedValue({
    currentStreak: 1,
    longestStreak: 1,
  });

  await service.checkIn(memberId, { qrCode: 'valid' });

  expect(mockEventEmitter.emit).toHaveBeenCalledWith('check_in.result', {
    type: 'check_in_result',
    member: {
      id: memberId,
      firstName: 'Jane',
      lastName: 'Doe',
      displayPicture: 'https://example.com/photo.jpg',
    },
    success: true,
    message: 'Check-in successful',
    timestamp: expect.any(String),
  });
});
```

**Step 2: Run test to verify it fails**

Run: `yarn test -- --testPathPattern=attendance.service`
Expected: FAIL — `check_in.result` event is not emitted yet.

**Step 3: Implement the change**

In `src/attendance/attendance.service.ts`, modify the `checkIn` method. After the user query on line 62, update the `select` to include `displayPicture`, and add the `check_in.result` emit after the streak update (before the return on line 79):

1. Change the user select (line 63-64) to include `id` and `displayPicture`:
```typescript
    const member = await this.prisma.user.findUnique({
      where: { id: memberId },
      select: { id: true, firstName: true, lastName: true, displayPicture: true },
    });
```

2. After the streak update (line 75) and before the return, add:
```typescript
    // Emit check-in result for entrance screen
    this.eventEmitter.emit('check_in.result', {
      type: 'check_in_result',
      member: {
        id: memberId,
        firstName: member?.firstName,
        lastName: member?.lastName,
        displayPicture: member?.displayPicture ?? null,
      },
      success: true,
      message: 'Check-in successful',
      timestamp: new Date().toISOString(),
    });
```

**Step 4: Run test to verify it passes**

Run: `yarn test -- --testPathPattern=attendance.service`
Expected: PASS (3 tests)

**Step 5: Commit**

```bash
git add src/attendance/attendance.service.ts src/attendance/attendance.service.spec.ts
git commit -m "feat(attendance): emit check_in.result event on successful check-in"
```

---

### Task 3: Emit check_in.result Event on Failed Subscription Check

**Files:**
- Modify: `src/attendance/attendance.service.ts`
- Modify: `src/attendance/attendance.service.spec.ts`

**Step 1: Write the failing test**

Add to `src/attendance/attendance.service.spec.ts`:

```typescript
it('should emit check_in.result with success:false when subscription inactive', async () => {
  const memberId = 'member-1';
  mockPrisma.gymQrCode.findFirst.mockResolvedValue({ id: '1', code: 'valid' });
  mockPrisma.subscriptionMember.findFirst.mockResolvedValue(null);
  mockPrisma.user.findUnique.mockResolvedValue({
    firstName: 'John',
    lastName: 'Smith',
    displayPicture: null,
  });

  await expect(
    service.checkIn(memberId, { qrCode: 'valid' }),
  ).rejects.toThrow(ForbiddenException);

  expect(mockEventEmitter.emit).toHaveBeenCalledWith('check_in.result', {
    type: 'check_in_result',
    member: {
      id: memberId,
      firstName: 'John',
      lastName: 'Smith',
      displayPicture: null,
    },
    success: false,
    message: 'No active subscription',
    timestamp: expect.any(String),
  });
});
```

**Step 2: Run test to verify it fails**

Run: `yarn test -- --testPathPattern=attendance.service`
Expected: FAIL — no event emitted on subscription failure.

**Step 3: Implement the change**

In `src/attendance/attendance.service.ts`, modify the subscription check block (lines 29-36). Before throwing the `ForbiddenException`, look up the member and emit the failure event:

Replace:
```typescript
    if (!activeMembership)
      throw new ForbiddenException('No active subscription');
```

With:
```typescript
    if (!activeMembership) {
      const failedMember = await this.prisma.user.findUnique({
        where: { id: memberId },
        select: { id: true, firstName: true, lastName: true, displayPicture: true },
      });
      this.eventEmitter.emit('check_in.result', {
        type: 'check_in_result',
        member: {
          id: memberId,
          firstName: failedMember?.firstName,
          lastName: failedMember?.lastName,
          displayPicture: failedMember?.displayPicture ?? null,
        },
        success: false,
        message: 'No active subscription',
        timestamp: new Date().toISOString(),
      });
      throw new ForbiddenException('No active subscription');
    }
```

**Step 4: Run test to verify it passes**

Run: `yarn test -- --testPathPattern=attendance.service`
Expected: PASS (4 tests)

**Step 5: Commit**

```bash
git add src/attendance/attendance.service.ts src/attendance/attendance.service.spec.ts
git commit -m "feat(attendance): emit check_in.result on failed subscription check"
```

---

### Task 4: Add Gateway Handlers for New Events

**Files:**
- Modify: `src/analytics/activity.gateway.ts`

**Step 1: Define the CheckInResultEvent interface**

Add to `src/analytics/activity.gateway.ts`, below the existing `ActivityEvent` interface:

```typescript
export interface CheckInResultEvent {
  type: 'check_in_result';
  member: {
    id: string;
    firstName: string;
    lastName: string;
    displayPicture: string | null;
  };
  success: boolean;
  message: string;
  timestamp: string;
}

export interface QrRotatedEvent {
  type: 'qr_rotated';
  timestamp: string;
}
```

**Step 2: Add the event handlers**

Add two new methods to the `ActivityGateway` class:

```typescript
  @OnEvent('check_in.result')
  handleCheckInResult(payload: CheckInResultEvent) {
    this.server.emit('check_in_result', payload);
  }

  @OnEvent('qr.rotated')
  handleQrRotated(payload: QrRotatedEvent) {
    this.server.emit('qr_rotated', payload);
  }
```

**Step 3: Run all tests to verify nothing is broken**

Run: `yarn test`
Expected: All tests PASS

**Step 4: Commit**

```bash
git add src/analytics/activity.gateway.ts
git commit -m "feat(analytics): add WebSocket handlers for check_in_result and qr_rotated events"
```

---

### Task 5: Emit check_in.result on Already-Checked-In (Idempotent Success)

**Files:**
- Modify: `src/attendance/attendance.service.ts`
- Modify: `src/attendance/attendance.service.spec.ts`

**Step 1: Write the failing test**

Add to `src/attendance/attendance.service.spec.ts`:

```typescript
it('should emit check_in.result with success:true when already checked in', async () => {
  const memberId = 'member-1';
  mockPrisma.gymQrCode.findFirst.mockResolvedValue({ id: '1', code: 'valid' });
  mockPrisma.subscriptionMember.findFirst.mockResolvedValue({ id: 'sub-1' });
  mockPrisma.attendance.findUnique.mockResolvedValue({ id: 'att-1' });
  mockPrisma.streak.findUnique.mockResolvedValue({
    currentStreak: 3,
    longestStreak: 5,
  });
  mockPrisma.user.findUnique.mockResolvedValue({
    firstName: 'Jane',
    lastName: 'Doe',
    displayPicture: null,
  });

  await service.checkIn(memberId, { qrCode: 'valid' });

  expect(mockEventEmitter.emit).toHaveBeenCalledWith('check_in.result', {
    type: 'check_in_result',
    member: {
      id: memberId,
      firstName: 'Jane',
      lastName: 'Doe',
      displayPicture: null,
    },
    success: true,
    message: 'Already checked in today',
    timestamp: expect.any(String),
  });
});
```

**Step 2: Run test to verify it fails**

Run: `yarn test -- --testPathPattern=attendance.service`
Expected: FAIL — no event emitted in the `alreadyCheckedIn` branch.

**Step 3: Implement the change**

In `src/attendance/attendance.service.ts`, modify the `existing` check block (lines 46-55). Before the return, look up the member and emit the event:

Replace:
```typescript
    if (existing) {
      const streak = await this.prisma.streak.findUnique({
        where: { memberId },
      });
      return {
        alreadyCheckedIn: true,
        message: 'Already checked in today',
        streak: streak?.currentStreak ?? 0,
      };
    }
```

With:
```typescript
    if (existing) {
      const streak = await this.prisma.streak.findUnique({
        where: { memberId },
      });
      const existingMember = await this.prisma.user.findUnique({
        where: { id: memberId },
        select: { id: true, firstName: true, lastName: true, displayPicture: true },
      });
      this.eventEmitter.emit('check_in.result', {
        type: 'check_in_result',
        member: {
          id: memberId,
          firstName: existingMember?.firstName,
          lastName: existingMember?.lastName,
          displayPicture: existingMember?.displayPicture ?? null,
        },
        success: true,
        message: 'Already checked in today',
        timestamp: new Date().toISOString(),
      });
      return {
        alreadyCheckedIn: true,
        message: 'Already checked in today',
        streak: streak?.currentStreak ?? 0,
      };
    }
```

**Step 4: Run test to verify it passes**

Run: `yarn test -- --testPathPattern=attendance.service`
Expected: PASS (5 tests)

**Step 5: Commit**

```bash
git add src/attendance/attendance.service.ts src/attendance/attendance.service.spec.ts
git commit -m "feat(attendance): emit check_in.result for idempotent re-scans"
```

---

### Task 6: Run Full Test Suite and Final Verification

**Step 1: Run all tests**

Run: `yarn test`
Expected: All tests PASS

**Step 2: Run linter**

Run: `yarn lint`
Expected: No errors

**Step 3: Run build**

Run: `yarn build`
Expected: Build succeeds

**Step 4: Final commit (if any lint fixes)**

```bash
git add -A
git commit -m "chore: lint fixes"
```

---

## Summary of Changes

| File | Change |
|------|--------|
| `src/qr/qr.service.ts` | Add `EventEmitter2` injection, `rotateDailyCode()` cron method |
| `src/qr/qr.service.spec.ts` | New file — tests for `generateCode` and `rotateDailyCode` |
| `src/attendance/attendance.service.ts` | Emit `check_in.result` in 3 code paths: success, already-checked-in, inactive subscription |
| `src/attendance/attendance.service.spec.ts` | 3 new tests for `check_in.result` emission |
| `src/analytics/activity.gateway.ts` | Add `CheckInResultEvent`/`QrRotatedEvent` interfaces, 2 new `@OnEvent` handlers |

## Task Dependency Graph

```
Task 1 (QR cron) ─────────────────────────┐
Task 2 (success event) ──────────────────┐ │
Task 3 (failure event) ──────────────────┤ │
Task 5 (already-checked-in event) ───────┤ │
                                         ├─┴─► Task 4 (gateway handlers)
                                         └───► Task 6 (full verification)
```

Tasks 1, 2, 3, and 5 are independent and can run in parallel. Task 4 depends on knowing the event shapes (but not the emitters). Task 6 is final verification.
