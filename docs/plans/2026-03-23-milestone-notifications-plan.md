# Milestone Push Notifications Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Send celebratory push notifications when members hit attendance milestones (streak weeks, total check-ins, personal bests, first check-in).

**Architecture:** Event-driven — AttendanceService emits `streak.updated` after each check-in, MilestonesService listens and evaluates milestones asynchronously. Dedup via `MilestoneNotification` table with unique constraint.

**Tech Stack:** NestJS EventEmitter, Prisma, existing NotificationsService for push delivery.

---

### Task 1: Schema Changes

**Files:**
- Modify: `prisma/schema.prisma:66-76` (NotificationType enum)
- Modify: `prisma/schema.prisma:231-241` (Streak model)
- Modify: `prisma/schema.prisma:110-153` (User model — add relation)
- Create: new `MilestoneNotification` model

**Step 1: Add MILESTONE to NotificationType enum**

In `prisma/schema.prisma`, add `MILESTONE` to the `NotificationType` enum (after `EVENT_UPDATE`):

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
}
```

**Step 2: Add bestWeek to Streak model**

In `prisma/schema.prisma`, add `bestWeek` field to the Streak model (after `daysThisWeek`):

```prisma
model Streak {
  id              String    @id @default(uuid())
  memberId        String    @unique
  weeklyStreak    Int       @default(0)
  longestStreak   Int       @default(0)
  daysThisWeek    Int       @default(0)
  bestWeek        Int       @default(0)
  weekStart       DateTime  @db.Date
  lastCheckInDate DateTime? @db.Date

  member User @relation(fields: [memberId], references: [id])
}
```

**Step 3: Add MilestoneNotification model**

Add after the Streak model:

```prisma
model MilestoneNotification {
  id             String   @id @default(uuid())
  memberId       String
  milestoneType  String
  milestoneValue Int
  createdAt      DateTime @default(now())

  member User @relation(fields: [memberId], references: [id])

  @@unique([memberId, milestoneType, milestoneValue])
}
```

**Step 4: Add relation to User model**

In the User model, add after `discountRedemptions`:

```prisma
  milestoneNotifications     MilestoneNotification[]
```

**Step 5: Generate migration and Prisma client**

Run: `npx prisma migrate dev --name add-milestone-notifications`
Expected: Migration created and applied successfully.

**Step 6: Commit**

```bash
git add prisma/
git commit -m "feat: add MilestoneNotification model and bestWeek to Streak"
```

---

### Task 2: Milestone Constants

**Files:**
- Create: `src/milestones/milestones.constants.ts`

**Step 1: Create the constants file**

```typescript
export const STREAK_MILESTONES = [
  { value: 2, title: 'Two weeks strong!', body: "You've checked in consistently for 2 weeks. A great habit is forming!" },
  { value: 4, title: 'One month of consistency!', body: "4 weeks in a row — you're building something real. Keep showing up!" },
  { value: 8, title: 'Two months unstoppable!', body: '8 consecutive weeks! Your dedication is seriously impressive.' },
  { value: 12, title: 'Quarter-year warrior!', body: "12 weeks straight! You're in the top tier of committed members!" },
  { value: 26, title: 'Half a year of greatness!', body: "26 WEEKS! Six months of showing up. You're an absolute machine!" },
  { value: 52, title: 'ONE YEAR STREAK!', body: '52 weeks. 365 days of commitment. You are LEGENDARY!' },
];

export const CHECKIN_MILESTONES = [
  { value: 10, title: 'Double digits!', body: "You've hit 10 check-ins! The journey is well underway." },
  { value: 25, title: '25 and counting!', body: '25 visits to the gym — consistency is your superpower.' },
  { value: 50, title: 'Half century!', body: "50 check-ins! That's serious commitment right there." },
  { value: 100, title: 'The 100 Club!', body: "100 CHECK-INS! You've joined an elite club. Incredible!" },
  { value: 200, title: '200 — Unstoppable!', body: '200 check-ins! Your dedication is on another level entirely!' },
  { value: 500, title: '500 — LEGENDARY!', body: '500 CHECK-INS! You are a gym LEGEND. Absolute respect!' },
];

export const FIRST_CHECKIN = {
  title: 'Welcome to the gym!',
  body: "Your fitness journey starts today. We're glad you're here!",
};

export type MilestoneType =
  | 'WEEKLY_STREAK'
  | 'TOTAL_CHECKINS'
  | 'FIRST_CHECKIN'
  | 'BEST_WEEK'
  | 'LONGEST_STREAK';

export interface StreakUpdatedPayload {
  memberId: string;
  weeklyStreak: number;
  longestStreak: number;
  previousLongestStreak: number;
  daysThisWeek: number;
  previousBestWeek: number;
  totalCheckIns: number;
  isFirstCheckIn: boolean;
}
```

**Step 2: Commit**

```bash
git add src/milestones/
git commit -m "feat: add milestone constants and types"
```

---

### Task 3: MilestonesService with Tests (TDD)

**Files:**
- Create: `src/milestones/milestones.service.ts`
- Create: `src/milestones/milestones.service.spec.ts`

**Step 1: Write the failing tests**

Create `src/milestones/milestones.service.spec.ts`:

```typescript
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Test, TestingModule } from '@nestjs/testing';
import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaClient, NotificationType } from '@prisma/client';
import { MilestonesService } from './milestones.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StreakUpdatedPayload } from './milestones.constants';

describe('MilestonesService', () => {
  let service: MilestonesService;
  let prisma: DeepMockProxy<PrismaClient>;
  let notificationsService: { create: jest.Mock };

  beforeEach(async () => {
    notificationsService = { create: jest.fn().mockResolvedValue({}) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MilestonesService,
        { provide: PrismaService, useValue: mockDeep<PrismaClient>() },
        { provide: NotificationsService, useValue: notificationsService },
      ],
    }).compile();

    service = module.get<MilestonesService>(MilestonesService);
    prisma = module.get(PrismaService);
    jest.clearAllMocks();
  });

  const basePayload: StreakUpdatedPayload = {
    memberId: 'member-1',
    weeklyStreak: 0,
    longestStreak: 0,
    previousLongestStreak: 0,
    daysThisWeek: 1,
    previousBestWeek: 0,
    totalCheckIns: 1,
    isFirstCheckIn: false,
  };

  describe('first check-in', () => {
    it('should send first check-in notification', async () => {
      const payload = { ...basePayload, isFirstCheckIn: true, totalCheckIns: 1 };
      prisma.milestoneNotification.create.mockResolvedValue({} as any);

      await service.handleStreakUpdated(payload);

      expect(prisma.milestoneNotification.create).toHaveBeenCalledWith({
        data: {
          memberId: 'member-1',
          milestoneType: 'FIRST_CHECKIN',
          milestoneValue: 1,
        },
      });
      expect(notificationsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'member-1',
          title: 'Welcome to the gym!',
          type: NotificationType.MILESTONE,
        }),
      );
    });
  });

  describe('weekly streak milestones', () => {
    it('should send notification at 4-week streak', async () => {
      const payload = { ...basePayload, weeklyStreak: 4 };
      prisma.milestoneNotification.create.mockResolvedValue({} as any);

      await service.handleStreakUpdated(payload);

      expect(notificationsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'One month of consistency!',
          type: NotificationType.MILESTONE,
        }),
      );
    });

    it('should not send notification for non-milestone streak', async () => {
      const payload = { ...basePayload, weeklyStreak: 3 };

      await service.handleStreakUpdated(payload);

      expect(notificationsService.create).not.toHaveBeenCalled();
    });
  });

  describe('total check-in milestones', () => {
    it('should send notification at 50 total check-ins', async () => {
      const payload = { ...basePayload, totalCheckIns: 50 };
      prisma.milestoneNotification.create.mockResolvedValue({} as any);

      await service.handleStreakUpdated(payload);

      expect(notificationsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Half century!',
          type: NotificationType.MILESTONE,
        }),
      );
    });
  });

  describe('longest streak broken', () => {
    it('should send notification when longestStreak exceeds previous', async () => {
      const payload = {
        ...basePayload,
        weeklyStreak: 5,
        longestStreak: 5,
        previousLongestStreak: 4,
      };
      prisma.milestoneNotification.create.mockResolvedValue({} as any);

      await service.handleStreakUpdated(payload);

      expect(notificationsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'New streak record!',
          type: NotificationType.MILESTONE,
        }),
      );
    });

    it('should not send when longestStreak equals previous', async () => {
      const payload = {
        ...basePayload,
        weeklyStreak: 5,
        longestStreak: 5,
        previousLongestStreak: 5,
      };

      await service.handleStreakUpdated(payload);

      expect(notificationsService.create).not.toHaveBeenCalled();
    });
  });

  describe('best week', () => {
    it('should send notification when daysThisWeek exceeds previousBestWeek', async () => {
      const payload = {
        ...basePayload,
        daysThisWeek: 5,
        previousBestWeek: 4,
      };
      prisma.milestoneNotification.create.mockResolvedValue({} as any);

      await service.handleStreakUpdated(payload);

      expect(notificationsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Personal best week!',
          type: NotificationType.MILESTONE,
        }),
      );
    });
  });

  describe('dedup', () => {
    it('should skip notification when milestone already recorded', async () => {
      const payload = { ...basePayload, weeklyStreak: 4 };
      prisma.milestoneNotification.create.mockRejectedValue({
        code: 'P2002',
      });

      await service.handleStreakUpdated(payload);

      expect(notificationsService.create).not.toHaveBeenCalled();
    });
  });

  describe('multiple milestones', () => {
    it('should send multiple notifications when multiple milestones hit', async () => {
      const payload = {
        ...basePayload,
        weeklyStreak: 4,
        totalCheckIns: 25,
        longestStreak: 4,
        previousLongestStreak: 3,
      };
      prisma.milestoneNotification.create.mockResolvedValue({} as any);

      await service.handleStreakUpdated(payload);

      // streak milestone + checkin milestone + longest streak = 3
      expect(notificationsService.create).toHaveBeenCalledTimes(3);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `yarn test -- --testPathPattern=milestones`
Expected: FAIL — cannot find `./milestones.service`

**Step 3: Write the service implementation**

Create `src/milestones/milestones.service.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  STREAK_MILESTONES,
  CHECKIN_MILESTONES,
  FIRST_CHECKIN,
  StreakUpdatedPayload,
  MilestoneType,
} from './milestones.constants';

@Injectable()
export class MilestonesService {
  private readonly logger = new Logger(MilestonesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  @OnEvent('streak.updated', { async: true })
  async handleStreakUpdated(payload: StreakUpdatedPayload) {
    try {
      const milestones = this.evaluateMilestones(payload);

      for (const milestone of milestones) {
        await this.recordAndNotify(
          payload.memberId,
          milestone.type,
          milestone.value,
          milestone.title,
          milestone.body,
        );
      }
    } catch (err) {
      this.logger.error('Failed to process milestones', err);
    }
  }

  private evaluateMilestones(payload: StreakUpdatedPayload) {
    const milestones: {
      type: MilestoneType;
      value: number;
      title: string;
      body: string;
    }[] = [];

    // First check-in
    if (payload.isFirstCheckIn) {
      milestones.push({
        type: 'FIRST_CHECKIN',
        value: 1,
        title: FIRST_CHECKIN.title,
        body: FIRST_CHECKIN.body,
      });
    }

    // Weekly streak milestones
    const streakMilestone = STREAK_MILESTONES.find(
      (m) => m.value === payload.weeklyStreak,
    );
    if (streakMilestone) {
      milestones.push({
        type: 'WEEKLY_STREAK',
        value: streakMilestone.value,
        title: streakMilestone.title,
        body: streakMilestone.body,
      });
    }

    // Total check-in milestones
    const checkinMilestone = CHECKIN_MILESTONES.find(
      (m) => m.value === payload.totalCheckIns,
    );
    if (checkinMilestone) {
      milestones.push({
        type: 'TOTAL_CHECKINS',
        value: checkinMilestone.value,
        title: checkinMilestone.title,
        body: checkinMilestone.body,
      });
    }

    // Longest streak broken
    if (payload.longestStreak > payload.previousLongestStreak) {
      milestones.push({
        type: 'LONGEST_STREAK',
        value: payload.longestStreak,
        title: 'New streak record!',
        body: `You just beat your longest streak! ${payload.longestStreak} weeks and counting — new personal best!`,
      });
    }

    // Best week
    if (payload.daysThisWeek > payload.previousBestWeek && payload.previousBestWeek > 0) {
      milestones.push({
        type: 'BEST_WEEK',
        value: payload.daysThisWeek,
        title: 'Personal best week!',
        body: `You checked in ${payload.daysThisWeek} times this week — that's your best ever! Amazing effort!`,
      });
    }

    return milestones;
  }

  private async recordAndNotify(
    memberId: string,
    milestoneType: MilestoneType,
    milestoneValue: number,
    title: string,
    body: string,
  ) {
    try {
      await this.prisma.milestoneNotification.create({
        data: { memberId, milestoneType, milestoneValue },
      });
    } catch (err: any) {
      if (err?.code === 'P2002') return; // Already recorded — skip
      throw err;
    }

    await this.notificationsService.create({
      userId: memberId,
      title,
      body,
      type: NotificationType.MILESTONE,
      metadata: { milestoneType, milestoneValue },
    });
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `yarn test -- --testPathPattern=milestones`
Expected: All 8 tests PASS.

**Step 5: Commit**

```bash
git add src/milestones/
git commit -m "feat: add MilestonesService with event-driven milestone detection"
```

---

### Task 4: MilestonesModule

**Files:**
- Create: `src/milestones/milestones.module.ts`
- Modify: `src/app.module.ts:40-97`

**Step 1: Create the module**

Create `src/milestones/milestones.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { MilestonesService } from './milestones.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  providers: [MilestonesService],
})
export class MilestonesModule {}
```

**Step 2: Register in AppModule**

In `src/app.module.ts`, add import statement:

```typescript
import { MilestonesModule } from './milestones/milestones.module';
```

Add `MilestonesModule` to the `imports` array (after `DiscountCodesModule`).

**Step 3: Commit**

```bash
git add src/milestones/milestones.module.ts src/app.module.ts
git commit -m "feat: register MilestonesModule in AppModule"
```

---

### Task 5: Modify AttendanceService to Emit streak.updated

**Files:**
- Modify: `src/attendance/attendance.service.ts:169-209` (checkIn — emit event after updateStreak)
- Modify: `src/attendance/attendance.service.ts:316-368` (updateStreak — return previous values, track bestWeek)

**Step 1: Modify updateStreak to return previous values and track bestWeek**

Replace the `updateStreak` method (`src/attendance/attendance.service.ts:316-368`) with:

```typescript
  private async updateStreak(memberId: string, today: Date) {
    const currentMonday = this.getMondayOfWeek(today);
    const existingStreak = await this.prisma.streak.findUnique({
      where: { memberId },
    });

    const previousLongestStreak = existingStreak?.longestStreak ?? 0;
    const previousBestWeek = existingStreak?.bestWeek ?? 0;

    let weeklyStreak = 0;
    let longestStreak = 0;
    let daysThisWeek = 1;
    const weekStart = currentMonday;

    if (existingStreak) {
      const prevWeekStart = existingStreak.weekStart;
      const isSameWeek = prevWeekStart.getTime() === currentMonday.getTime();

      if (isSameWeek) {
        daysThisWeek = existingStreak.daysThisWeek + 1;
        weeklyStreak = existingStreak.weeklyStreak;
      } else {
        const diffMs = currentMonday.getTime() - prevWeekStart.getTime();
        const diffWeeks = Math.round(diffMs / (7 * 24 * 60 * 60 * 1000));

        if (
          diffWeeks === 1 &&
          existingStreak.daysThisWeek >= this.DAYS_REQUIRED_PER_WEEK
        ) {
          weeklyStreak = existingStreak.weeklyStreak + 1;
        } else {
          weeklyStreak = 0;
        }
      }
      longestStreak = Math.max(weeklyStreak, existingStreak.longestStreak);
    }

    const bestWeek = Math.max(daysThisWeek, previousBestWeek);

    const streak = await this.prisma.streak.upsert({
      where: { memberId },
      create: {
        memberId,
        weeklyStreak,
        longestStreak,
        daysThisWeek,
        bestWeek,
        weekStart,
        lastCheckInDate: today,
      },
      update: {
        weeklyStreak,
        longestStreak,
        daysThisWeek,
        bestWeek,
        weekStart,
        lastCheckInDate: today,
      },
    });

    return { ...streak, previousLongestStreak, previousBestWeek };
  }
```

**Step 2: Add streak.updated event emission in checkIn**

After the streak nudge block in `checkIn` (after line 186), add the following code before the `check_in.result` emission (before line 188):

```typescript
    // 6. Emit streak update for milestone evaluation (async, non-blocking)
    const totalCheckIns = await this.prisma.attendance.count({
      where: { memberId },
    });
    const isFirstCheckIn = totalCheckIns === 1;

    this.eventEmitter.emit('streak.updated', {
      memberId,
      weeklyStreak: streak.weeklyStreak,
      longestStreak: streak.longestStreak,
      previousLongestStreak: streak.previousLongestStreak,
      daysThisWeek: streak.daysThisWeek,
      previousBestWeek: streak.previousBestWeek,
      totalCheckIns,
      isFirstCheckIn,
    });
```

**Step 3: Run existing attendance tests**

Run: `yarn test -- --testPathPattern=attendance`
Expected: All existing tests PASS. The `streak.upsert` mock may need `bestWeek` added to its return values in the test file — update mocks if needed.

**Step 4: Commit**

```bash
git add src/attendance/attendance.service.ts
git commit -m "feat: emit streak.updated event with milestone data from checkIn"
```

---

### Task 6: Update Attendance Tests

**Files:**
- Modify: `src/attendance/attendance.service.spec.ts`

**Step 1: Read the full test file to identify all streak.upsert mocks**

Read `src/attendance/attendance.service.spec.ts` and find every `prisma.streak.upsert.mockResolvedValue` call.

**Step 2: Add bestWeek and previousLongestStreak/previousBestWeek to mock return values**

Every streak upsert mock needs `bestWeek` in its return value. Add `bestWeek: <appropriate value>` to each mock.

Also verify the `eventEmitter.emit` mock is called with the `streak.updated` event where check-ins succeed (not already-checked-in or no-subscription paths).

Add a test that verifies `streak.updated` is emitted:

```typescript
  it('should emit streak.updated event on successful check-in', async () => {
    prisma.gymQrCode.findFirst.mockResolvedValue({ id: '1', code: 'valid', isActive: true, expiresAt: null, createdAt: new Date() });
    prisma.subscriptionMember.findFirst.mockResolvedValue({
      memberId: 'member-1',
      subscription: { status: 'ACTIVE', endDate: new Date(Date.now() + 86400000), plan: { isOffPeak: false } },
    } as any);
    prisma.attendance.findUnique.mockResolvedValue(null);
    prisma.attendance.create.mockResolvedValue({} as any);
    prisma.user.findUnique.mockResolvedValue({
      id: 'member-1', firstName: 'John', lastName: 'Doe', displayPicture: null,
    } as any);
    prisma.streak.findUnique.mockResolvedValue(null);
    prisma.streak.upsert.mockResolvedValue({
      id: 's1', memberId: 'member-1', weeklyStreak: 0, longestStreak: 0,
      daysThisWeek: 1, bestWeek: 1, weekStart: currentMonday, lastCheckInDate: today,
    } as any);
    prisma.attendance.count.mockResolvedValue(1);

    await service.checkIn('member-1', { qrCode: 'valid' });

    expect(mockEventEmitter.emit).toHaveBeenCalledWith(
      'streak.updated',
      expect.objectContaining({
        memberId: 'member-1',
        isFirstCheckIn: true,
        totalCheckIns: 1,
      }),
    );
  });
```

**Step 3: Run tests**

Run: `yarn test -- --testPathPattern=attendance`
Expected: All tests PASS.

**Step 4: Commit**

```bash
git add src/attendance/attendance.service.spec.ts
git commit -m "test: update attendance tests for streak.updated event and bestWeek"
```

---

### Task 7: Lint and Full Test Suite

**Files:** None (verification only)

**Step 1: Run linter**

Run: `yarn lint`
Expected: No errors.

**Step 2: Run full test suite**

Run: `yarn test`
Expected: All tests pass, including new milestone tests.

**Step 3: Commit any lint fixes if needed**

```bash
git add -A
git commit -m "fix: lint fixes for milestone notifications"
```
