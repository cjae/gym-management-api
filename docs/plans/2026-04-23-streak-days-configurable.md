# Configurable Streak Days Required Per Week

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move the hardcoded `DAYS_REQUIRED_PER_WEEK = 4` in `AttendanceService` to `GymSettings` so gym admins can configure it.

**Architecture:** Add `streakDaysRequiredPerWeek Int @default(4)` to the `GymSettings` Prisma model. Expose it via the existing upsert/response DTOs. In `AttendanceService`, read the value from `getCachedSettings()` (already called for timezone — the cache means no extra DB hit) and pass it down to `updateStreak` and `handleAlreadyCheckedIn` instead of using the hardcoded class constant.

**Tech Stack:** NestJS 11, Prisma 6, PostgreSQL, Jest / jest-mock-extended

---

### Task 1: Add field to Prisma schema and migrate

**Files:**
- Modify: `prisma/schema.prisma` (GymSettings model, ~line 601)

**Step 1: Add field to GymSettings model**

In `prisma/schema.prisma`, inside the `GymSettings` model, add after `maxActiveGoalsPerMember`:

```prisma
streakDaysRequiredPerWeek Int      @default(4)
```

**Step 2: Run migration**

```bash
npx prisma migrate dev --name add-streak-days-required-per-week
npx prisma generate
```

Expected: migration file created, Prisma client regenerated with no errors.

---

### Task 2: Update GymSettings DTOs

**Files:**
- Modify: `src/gym-settings/dto/upsert-gym-settings.dto.ts`
- Modify: `src/gym-settings/dto/gym-settings-response.dto.ts`

**Step 1: Add to UpsertGymSettingsDto**

In `upsert-gym-settings.dto.ts`, add after the `loyalStreakWeeks` field:

```typescript
@ApiPropertyOptional({
  example: 4,
  description: 'Days per week required to maintain a weekly streak',
})
@IsOptional()
@IsInt()
@Min(1)
@Max(7)
streakDaysRequiredPerWeek?: number;
```

**Step 2: Add to GymSettingsResponseDto**

In `gym-settings-response.dto.ts`, add after `loyalStreakWeeks`:

```typescript
@ApiProperty({ example: 4, description: 'Days per week required for streak' })
streakDaysRequiredPerWeek: number;
```

---

### Task 3: Update GymSettingsService upsert

**Files:**
- Modify: `src/gym-settings/gym-settings.service.ts`

**Step 1: Add field to both `create` and `update` blocks in `upsert()`**

In `gym-settings.service.ts`, inside the `create` spread object, add after the `loyalStreakWeeks` block:

```typescript
...(dto.streakDaysRequiredPerWeek !== undefined && {
  streakDaysRequiredPerWeek: dto.streakDaysRequiredPerWeek,
}),
```

Add the same spread to the `update` object as well.

---

### Task 4: Update AttendanceService to use the setting

**Files:**
- Modify: `src/attendance/attendance.service.ts`

**Step 1: Remove the hardcoded constant**

Remove this line:
```typescript
private readonly DAYS_REQUIRED_PER_WEEK = 4;
```

**Step 2: Add a private helper to read the setting**

Add a private method after `getTimezone()`:

```typescript
private async getDaysRequired(): Promise<number> {
  const settings = await this.gymSettingsService.getCachedSettings();
  return settings?.streakDaysRequiredPerWeek ?? 4;
}
```

**Step 3: Read it in `checkIn` and thread it through**

In `checkIn`, after the line that reads `timezone`, read daysRequired:

```typescript
const timezone = await this.getTimezone();
const daysRequired = await this.getDaysRequired();
```

**Step 4: Update `updateStreak` signature to accept daysRequired**

Change the signature from:
```typescript
private async updateStreak(
  memberId: string,
  today: Date,
  tx: TxClient = this.prisma,
)
```
to:
```typescript
private async updateStreak(
  memberId: string,
  today: Date,
  daysRequired: number,
  tx: TxClient = this.prisma,
)
```

Inside `updateStreak`, replace `this.DAYS_REQUIRED_PER_WEEK` with `daysRequired`.

**Step 5: Update all call sites**

In `checkIn`, update the call:
```typescript
const txStreak = await this.updateStreak(memberId, today, daysRequired, tx);
```

For the streak nudge notification, replace `this.DAYS_REQUIRED_PER_WEEK`:
```typescript
if (
  streak.daysThisWeek === daysRequired - 1 &&
  streak.weeklyStreak > 0
) {
```

Update the nudge notification body to use `daysRequired`:
```typescript
body: `One more day this week to keep your ${streak.weeklyStreak}-week streak going!`,
```
(body is fine as-is, no change needed there)

Update the return value at end of `checkIn`:
```typescript
daysRequired,
```

**Step 6: Update `handleAlreadyCheckedIn` to accept and return daysRequired**

Change signature:
```typescript
private async handleAlreadyCheckedIn(memberId: string, entranceId?: string)
```
to:
```typescript
private async handleAlreadyCheckedIn(memberId: string, daysRequired: number, entranceId?: string)
```

Update the return inside `handleAlreadyCheckedIn`:
```typescript
daysRequired,
```

Update the call in `checkIn` where P2002 is caught:
```typescript
return this.handleAlreadyCheckedIn(memberId, daysRequired, entranceId);
```

---

### Task 5: Update attendance service tests

**Files:**
- Modify: `src/attendance/attendance.service.spec.ts`

**Step 1: Add `streakDaysRequiredPerWeek` to the default GymSettings mock**

In the `beforeEach`, update the `getCachedSettings` mock from:
```typescript
getCachedSettings: jest
  .fn()
  .mockResolvedValue({ timezone: 'Africa/Nairobi' }),
```
to:
```typescript
getCachedSettings: jest
  .fn()
  .mockResolvedValue({ timezone: 'Africa/Nairobi', streakDaysRequiredPerWeek: 4 }),
```

**Step 2: Update the off-peak test overrides**

The two off-peak tests (`should reject off-peak member checking in during peak hours` and `should allow off-peak member checking in during off-peak hours`) override `gymSettingsService` directly with their own mock. Add `streakDaysRequiredPerWeek: 4` to both of those mock return values:

```typescript
getCachedSettings: jest.fn().mockResolvedValue({
  timezone: 'Africa/Nairobi',
  streakDaysRequiredPerWeek: 4,
  offPeakWindows: [
    { dayOfWeek: null, startTime: '06:00', endTime: '10:00' },
  ],
}),
```

**Step 3: Run tests and verify passing**

```bash
yarn test -- --testPathPattern=attendance
```

Expected: all tests pass.

---

### Task 6: Run full quality checks and commit

**Step 1: Run lint, typecheck, and all tests**

```bash
yarn lint && yarn tsc --noEmit && yarn test
```

Expected: all pass with no errors.

**Step 2: Commit**

```bash
git add prisma/schema.prisma \
  prisma/migrations \
  src/gym-settings/dto/upsert-gym-settings.dto.ts \
  src/gym-settings/dto/gym-settings-response.dto.ts \
  src/gym-settings/gym-settings.service.ts \
  src/attendance/attendance.service.ts \
  src/attendance/attendance.service.spec.ts
git commit -m "feat(attendance): make streak days-per-week target configurable via GymSettings"
```
