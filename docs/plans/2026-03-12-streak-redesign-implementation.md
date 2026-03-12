# Streak Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the daily consecutive streak with a weekly consistency model (4+ check-ins per Mon–Sat week).

**Architecture:** Migrate the Prisma `Streak` model to use `weeklyStreak`/`daysThisWeek`/`weekStart` instead of `currentStreak`. Update `updateStreak()` to evaluate weeks lazily on check-in. Update DTOs, seed data, and tests to match.

**Tech Stack:** NestJS 11, Prisma 6, PostgreSQL, Jest

**Design Doc:** `docs/plans/2026-03-12-streak-redesign-design.md`

---

### Task 1: Prisma Schema Migration

**Files:**
- Modify: `prisma/schema.prisma:175-183`

**Step 1: Update the Streak model**

Replace the existing `Streak` model at line 175 with:

```prisma
model Streak {
  id              String    @id @default(uuid())
  memberId        String    @unique
  weeklyStreak    Int       @default(0)
  longestStreak   Int       @default(0)
  daysThisWeek    Int       @default(0)
  weekStart       DateTime  @db.Date
  lastCheckInDate DateTime? @db.Date

  member User @relation(fields: [memberId], references: [id])
}
```

**Step 2: Generate and apply the migration**

Run: `npx prisma migrate dev --name streak-weekly-consistency`

Expected: Migration creates successfully. The `currentStreak` column is removed; `weeklyStreak`, `daysThisWeek`, `weekStart` columns are added. Existing streak rows are dropped (destructive change — acceptable per design).

If Prisma warns about data loss on `currentStreak` removal, accept it — we're intentionally resetting all streaks.

**Step 3: Regenerate Prisma client**

Run: `npx prisma generate`

**Step 4: Commit**

```bash
git add prisma/
git commit -m "feat(attendance): migrate streak schema to weekly consistency model"
```

---

### Task 2: Update `updateStreak()` Logic

**Files:**
- Modify: `src/attendance/attendance.service.ts:176-204`

**Step 1: Write the failing test for weekly streak — same week increments daysThisWeek**

Add to `src/attendance/attendance.service.spec.ts` (after the existing tests, before the closing `});`):

```typescript
describe('updateStreak (weekly consistency)', () => {
  it('should increment daysThisWeek when checking in same week', async () => {
    // Wednesday check-in, weekStart is Monday of same week
    const today = new Date('2026-03-11'); // Wednesday
    today.setHours(0, 0, 0, 0);
    const monday = new Date('2026-03-09'); // Monday
    monday.setHours(0, 0, 0, 0);

    mockPrisma.gymQrCode.findFirst.mockResolvedValue({ id: '1', code: 'valid' });
    mockPrisma.subscriptionMember.findFirst.mockResolvedValue({ id: 'sm-1', memberId: 'member-1' });
    mockPrisma.attendance.findUnique.mockResolvedValue(null);
    mockPrisma.attendance.create.mockResolvedValue({});
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'member-1', firstName: 'Jane', lastName: 'Smith', displayPicture: null,
    });
    mockPrisma.streak.findUnique.mockResolvedValue({
      memberId: 'member-1',
      weeklyStreak: 3,
      longestStreak: 5,
      daysThisWeek: 2,
      weekStart: monday,
    });
    mockPrisma.streak.upsert.mockResolvedValue({
      weeklyStreak: 3,
      longestStreak: 5,
      daysThisWeek: 3,
      weekStart: monday,
    });

    const result = await service.checkIn('member-1', { qrCode: 'valid' });

    expect(result.daysThisWeek).toBe(3);
    expect(result.weeklyStreak).toBe(3);
  });

  it('should increment weeklyStreak when new week starts after hitting 4+ days', async () => {
    // Monday of new week, previous week had 4 days
    const today = new Date('2026-03-16'); // Monday
    today.setHours(0, 0, 0, 0);
    const lastMonday = new Date('2026-03-09'); // Previous Monday
    lastMonday.setHours(0, 0, 0, 0);

    mockPrisma.gymQrCode.findFirst.mockResolvedValue({ id: '1', code: 'valid' });
    mockPrisma.subscriptionMember.findFirst.mockResolvedValue({ id: 'sm-1', memberId: 'member-1' });
    mockPrisma.attendance.findUnique.mockResolvedValue(null);
    mockPrisma.attendance.create.mockResolvedValue({});
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'member-1', firstName: 'Jane', lastName: 'Smith', displayPicture: null,
    });
    mockPrisma.streak.findUnique.mockResolvedValue({
      memberId: 'member-1',
      weeklyStreak: 3,
      longestStreak: 5,
      daysThisWeek: 4,
      weekStart: lastMonday,
    });
    mockPrisma.streak.upsert.mockResolvedValue({
      weeklyStreak: 4,
      longestStreak: 5,
      daysThisWeek: 1,
      weekStart: today,
    });

    const result = await service.checkIn('member-1', { qrCode: 'valid' });

    expect(result.weeklyStreak).toBe(4);
    expect(result.daysThisWeek).toBe(1);
  });

  it('should reset weeklyStreak when new week starts after fewer than 4 days', async () => {
    const today = new Date('2026-03-16'); // Monday
    today.setHours(0, 0, 0, 0);
    const lastMonday = new Date('2026-03-09');
    lastMonday.setHours(0, 0, 0, 0);

    mockPrisma.gymQrCode.findFirst.mockResolvedValue({ id: '1', code: 'valid' });
    mockPrisma.subscriptionMember.findFirst.mockResolvedValue({ id: 'sm-1', memberId: 'member-1' });
    mockPrisma.attendance.findUnique.mockResolvedValue(null);
    mockPrisma.attendance.create.mockResolvedValue({});
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'member-1', firstName: 'Jane', lastName: 'Smith', displayPicture: null,
    });
    mockPrisma.streak.findUnique.mockResolvedValue({
      memberId: 'member-1',
      weeklyStreak: 3,
      longestStreak: 5,
      daysThisWeek: 2,
      weekStart: lastMonday,
    });
    mockPrisma.streak.upsert.mockResolvedValue({
      weeklyStreak: 0,
      longestStreak: 5,
      daysThisWeek: 1,
      weekStart: today,
    });

    const result = await service.checkIn('member-1', { qrCode: 'valid' });

    expect(result.weeklyStreak).toBe(0);
    expect(result.daysThisWeek).toBe(1);
  });

  it('should reset weeklyStreak when entire weeks are skipped', async () => {
    const today = new Date('2026-03-23'); // Monday, 2 weeks later
    today.setHours(0, 0, 0, 0);
    const twoWeeksAgo = new Date('2026-03-09');
    twoWeeksAgo.setHours(0, 0, 0, 0);

    mockPrisma.gymQrCode.findFirst.mockResolvedValue({ id: '1', code: 'valid' });
    mockPrisma.subscriptionMember.findFirst.mockResolvedValue({ id: 'sm-1', memberId: 'member-1' });
    mockPrisma.attendance.findUnique.mockResolvedValue(null);
    mockPrisma.attendance.create.mockResolvedValue({});
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'member-1', firstName: 'Jane', lastName: 'Smith', displayPicture: null,
    });
    mockPrisma.streak.findUnique.mockResolvedValue({
      memberId: 'member-1',
      weeklyStreak: 10,
      longestStreak: 10,
      daysThisWeek: 5,
      weekStart: twoWeeksAgo,
    });
    mockPrisma.streak.upsert.mockResolvedValue({
      weeklyStreak: 0,
      longestStreak: 10,
      daysThisWeek: 1,
      weekStart: today,
    });

    const result = await service.checkIn('member-1', { qrCode: 'valid' });

    expect(result.weeklyStreak).toBe(0);
    expect(result.longestStreak).toBe(10);
  });
});
```

**Step 2: Run the tests to verify they fail**

Run: `yarn test -- --testPathPattern=attendance`

Expected: New tests fail because `updateStreak()` still uses old daily logic and returns `currentStreak` instead of `weeklyStreak`.

**Step 3: Implement the new `updateStreak()` and helper**

Replace the `updateStreak` method in `src/attendance/attendance.service.ts:176-204` with:

```typescript
private getMondayOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun, 1=Mon, ...
  const diff = day === 0 ? 6 : day - 1; // days since Monday
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

private async updateStreak(memberId: string, today: Date) {
  const currentMonday = this.getMondayOfWeek(today);
  const existingStreak = await this.prisma.streak.findUnique({
    where: { memberId },
  });

  let weeklyStreak = 0;
  let longestStreak = 0;
  let daysThisWeek = 1;
  let weekStart = currentMonday;

  if (existingStreak) {
    const prevWeekStart = existingStreak.weekStart;
    const isSameWeek = prevWeekStart.getTime() === currentMonday.getTime();

    if (isSameWeek) {
      // Same week — just increment days
      daysThisWeek = existingStreak.daysThisWeek + 1;
      weeklyStreak = existingStreak.weeklyStreak;
    } else {
      // New week — evaluate previous week
      const diffMs = currentMonday.getTime() - prevWeekStart.getTime();
      const diffWeeks = Math.round(diffMs / (7 * 24 * 60 * 60 * 1000));

      if (diffWeeks === 1 && existingStreak.daysThisWeek >= 4) {
        // Consecutive week, hit the goal last week
        weeklyStreak = existingStreak.weeklyStreak + 1;
      } else {
        // Missed goal or skipped weeks
        weeklyStreak = 0;
      }
    }
    longestStreak = Math.max(weeklyStreak, existingStreak.longestStreak);
  }

  return this.prisma.streak.upsert({
    where: { memberId },
    create: { memberId, weeklyStreak, longestStreak, daysThisWeek, weekStart },
    update: { weeklyStreak, longestStreak, daysThisWeek, weekStart, lastCheckInDate: today },
  });
}
```

**Step 4: Update check-in response fields**

In `src/attendance/attendance.service.ts`, update the two return blocks in `checkIn()`:

For the already-checked-in case (~line 122-126), change:
```typescript
return {
  alreadyCheckedIn: true,
  message: 'Already checked in today',
  streak: streak?.currentStreak ?? 0,
};
```
to:
```typescript
return {
  alreadyCheckedIn: true,
  message: 'Already checked in today',
  weeklyStreak: streak?.weeklyStreak ?? 0,
  daysThisWeek: streak?.daysThisWeek ?? 0,
  daysRequired: 4,
};
```

For the success case (~line 168-173), change:
```typescript
return {
  alreadyCheckedIn: false,
  message: 'Check-in successful',
  streak: streak.currentStreak,
  longestStreak: streak.longestStreak,
};
```
to:
```typescript
return {
  alreadyCheckedIn: false,
  message: 'Check-in successful',
  weeklyStreak: streak.weeklyStreak,
  longestStreak: streak.longestStreak,
  daysThisWeek: streak.daysThisWeek,
  daysRequired: 4,
};
```

**Step 5: Run tests to verify they pass**

Run: `yarn test -- --testPathPattern=attendance`

Expected: All new weekly streak tests pass. Some existing tests may fail due to old field names — fix in Task 3.

**Step 6: Commit**

```bash
git add src/attendance/attendance.service.ts src/attendance/attendance.service.spec.ts
git commit -m "feat(attendance): implement weekly consistency streak logic"
```

---

### Task 3: Update Existing Tests for New Field Names

**Files:**
- Modify: `src/attendance/attendance.service.spec.ts`

**Step 1: Fix mock return values and assertions**

In all existing tests that reference `currentStreak`, update to use the new schema:

1. The `streak.upsert` mock return values: change `currentStreak` → `weeklyStreak` and add `daysThisWeek`, `weekStart`.

2. The `streak.findUnique` mock return values: change `currentStreak` → `weeklyStreak` and add `daysThisWeek`, `weekStart`.

3. Assertions on `result.streak` → change to `result.weeklyStreak`.

Specifically:

- Line 89-92: `mockPrisma.streak.upsert.mockResolvedValue` — change `{ currentStreak: 1, longestStreak: 1 }` to `{ weeklyStreak: 0, longestStreak: 0, daysThisWeek: 1, weekStart: new Date() }`

- Line 125-128: `mockPrisma.streak.findUnique.mockResolvedValue` — change `{ currentStreak: 5 }` to `{ weeklyStreak: 5, daysThisWeek: 3, weekStart: new Date() }`

- Line 139: `expect(result.streak).toBe(5)` → `expect(result.weeklyStreak).toBe(5)`

- Line 179-182: `mockPrisma.streak.upsert.mockResolvedValue` — change `{ currentStreak: 1, longestStreak: 1 }` to `{ weeklyStreak: 0, longestStreak: 0, daysThisWeek: 1, weekStart: new Date() }`

- Line 243-246: same change as above.

**Step 2: Run all tests**

Run: `yarn test -- --testPathPattern=attendance`

Expected: All tests pass (existing + new weekly streak tests).

**Step 3: Commit**

```bash
git add src/attendance/attendance.service.spec.ts
git commit -m "test(attendance): update existing tests for weekly streak fields"
```

---

### Task 4: Update DTOs and Swagger Docs

**Files:**
- Modify: `src/attendance/dto/check-in-response.dto.ts`
- Modify: `src/attendance/dto/streak-response.dto.ts`
- Modify: `src/attendance/dto/leaderboard-entry-response.dto.ts`

**Step 1: Update CheckInResponseDto**

Replace `src/attendance/dto/check-in-response.dto.ts` with:

```typescript
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CheckInResponseDto {
  @ApiProperty({ example: false })
  alreadyCheckedIn: boolean;

  @ApiProperty({ example: 'Check-in successful!' })
  message: string;

  @ApiPropertyOptional({ example: 5, description: 'Consecutive weeks with 4+ check-ins' })
  weeklyStreak?: number;

  @ApiPropertyOptional({ example: 10, description: 'Best weekly streak ever' })
  longestStreak?: number;

  @ApiPropertyOptional({ example: 3, description: 'Check-ins so far this week (Mon-Sat)' })
  daysThisWeek?: number;

  @ApiPropertyOptional({ example: 4, description: 'Check-ins required per week' })
  daysRequired?: number;
}
```

**Step 2: Update StreakResponseDto**

Replace `src/attendance/dto/streak-response.dto.ts` with:

```typescript
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class StreakResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  memberId: string;

  @ApiProperty({ example: 5, description: 'Consecutive weeks with 4+ check-ins' })
  weeklyStreak: number;

  @ApiProperty({ example: 10, description: 'Best weekly streak ever' })
  longestStreak: number;

  @ApiProperty({ example: 3, description: 'Check-ins so far this week (Mon-Sat)' })
  daysThisWeek: number;

  @ApiProperty({ description: 'Monday of the current tracking week' })
  weekStart: Date;

  @ApiPropertyOptional()
  lastCheckInDate?: Date;
}
```

**Step 3: Update LeaderboardEntryResponseDto**

Replace `src/attendance/dto/leaderboard-entry-response.dto.ts` with:

```typescript
import { ApiProperty } from '@nestjs/swagger';
import { LeaderboardMemberDto } from './leaderboard-member.dto';

export class LeaderboardEntryResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  memberId: string;

  @ApiProperty({ example: 15, description: 'Consecutive weeks with 4+ check-ins' })
  weeklyStreak: number;

  @ApiProperty({ example: 20, description: 'Best weekly streak ever' })
  longestStreak: number;

  @ApiProperty({ type: LeaderboardMemberDto })
  member: LeaderboardMemberDto;
}
```

**Step 4: Commit**

```bash
git add src/attendance/dto/
git commit -m "docs(attendance): update DTOs and Swagger for weekly streak model"
```

---

### Task 5: Update Leaderboard Ordering

**Files:**
- Modify: `src/attendance/attendance.service.ts:218-233`

**Step 1: Update leaderboard query**

In `getLeaderboard()`, change `orderBy: { currentStreak: 'desc' }` to `orderBy: { weeklyStreak: 'desc' }`.

**Step 2: Run tests**

Run: `yarn test -- --testPathPattern=attendance`

Expected: All pass.

**Step 3: Commit**

```bash
git add src/attendance/attendance.service.ts
git commit -m "feat(attendance): rank leaderboard by weeklyStreak"
```

---

### Task 6: Update Seed Data

**Files:**
- Modify: `prisma/seed.ts:272-281`

**Step 1: Update streak seed entries**

Replace the streak creation block with:

```typescript
// Streaks for active members (weekly consistency model)
const monday = new Date();
const day = monday.getDay();
const diff = day === 0 ? 6 : day - 1;
monday.setDate(monday.getDate() - diff);
monday.setHours(0, 0, 0, 0);

await prisma.streak.create({
  data: { memberId: members[0].id, weeklyStreak: 12, longestStreak: 18, daysThisWeek: 3, weekStart: monday, lastCheckInDate: new Date(new Date().setHours(0,0,0,0)) },
});
await prisma.streak.create({
  data: { memberId: members[1].id, weeklyStreak: 5, longestStreak: 10, daysThisWeek: 2, weekStart: monday, lastCheckInDate: new Date(new Date().setHours(0,0,0,0)) },
});
await prisma.streak.create({
  data: { memberId: members[3].id, weeklyStreak: 8, longestStreak: 15, daysThisWeek: 4, weekStart: monday, lastCheckInDate: new Date(new Date().setHours(0,0,0,0)) },
});
```

**Step 2: Verify seed runs**

Run: `npx prisma db seed`

Expected: Seed completes without errors.

**Step 3: Commit**

```bash
git add prisma/seed.ts
git commit -m "chore: update seed data for weekly streak model"
```

---

### Task 7: Final Verification

**Step 1: Run full test suite**

Run: `yarn test`

Expected: All tests pass.

**Step 2: Run linter**

Run: `yarn lint`

Expected: No errors.

**Step 3: Run dev server smoke test**

Run: `yarn build`

Expected: Builds without errors.

**Step 4: Commit any remaining fixes**

If any issues found, fix and commit with appropriate message.
