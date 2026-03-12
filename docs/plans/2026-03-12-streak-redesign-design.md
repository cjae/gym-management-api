# Streak Redesign: Weekly Consistency Model

**Date**: 2026-03-12
**Status**: Approved

## Problem

The current streak system requires consecutive daily check-ins. This punishes members for:

1. **Sundays** — gyms in Kenya don't open on Sundays
2. **Rest days** — fitness best practice is not to train every single day

## Design

Replace the daily streak with a **weekly consistency streak**. A member keeps their streak alive by checking in **4+ days per week** (Mon–Sat). Sundays are excluded from the operating week.

### Data Model

```prisma
model Streak {
  id              String    @id @default(uuid())
  memberId        String    @unique
  weeklyStreak    Int       @default(0)    // consecutive weeks hitting 4+ days
  longestStreak   Int       @default(0)    // best weekly streak ever
  daysThisWeek    Int       @default(0)    // check-ins Mon–Sat of current week
  weekStart       DateTime  @db.Date       // Monday of the current tracking week
  lastCheckInDate DateTime? @db.Date

  member User @relation(fields: [memberId], references: [id])
}
```

Key changes from current model:
- `currentStreak` → `weeklyStreak` (consecutive weeks, not days)
- New `daysThisWeek` — resets every Monday, incremented on check-in
- New `weekStart` — tracks which Mon–Sat window we're counting
- `longestStreak` now tracks best weekly streak (not daily)

### Streak Calculation (on check-in)

1. Compute `currentMonday` = Monday of today's week
2. If `weekStart === currentMonday` → increment `daysThisWeek`
3. If `weekStart !== currentMonday` (new week):
   - Evaluate previous week: `daysThisWeek >= 4` → `weeklyStreak + 1`, else reset to `0`
   - If `currentMonday` is more than 1 week after `weekStart` → reset `weeklyStreak = 0` (skipped entire weeks)
   - Set `daysThisWeek = 1`, `weekStart = currentMonday`
4. Update `longestStreak = max(weeklyStreak, longestStreak)`

No cron job needed — evaluation happens lazily on check-in.

### Check-in Response

```json
{
  "alreadyCheckedIn": false,
  "message": "Check-in successful",
  "weeklyStreak": 5,
  "longestStreak": 12,
  "daysThisWeek": 3,
  "daysRequired": 4
}
```

Mobile app can show progress like "3/4 days this week".

### Leaderboard

Ranks by `weeklyStreak` descending (previously `currentStreak`).

### Edge Cases

- **Mid-week join**: First partial week likely won't hit 4 days. Streak starts from first full qualifying week. No special-casing.
- **Frozen subscription**: Check-in blocked by subscription guard, so `daysThisWeek` won't increment. Full-week freeze resets streak. Acceptable since member chose to freeze.
- **Duplicate check-in**: Already handled by `@@unique([memberId, checkInDate])`. Streak update only runs on first check-in of the day.

### Migration

- Add `weeklyStreak`, `daysThisWeek`, `weekStart` columns
- Remove `currentStreak` column
- Reset all streaks to 0 — old daily streaks aren't meaningfully convertible to weekly streaks
