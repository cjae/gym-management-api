# Milestone Push Notifications Design

## Overview

Gamify attendance by sending celebratory push notifications when members hit major milestones. Milestones are detected asynchronously via EventEmitter to avoid adding latency to the check-in flow.

## Milestone Types

### Weekly Streak Milestones (warm → hype escalation)

| Weeks | Title | Body |
|-------|-------|------|
| 2 | "Two weeks strong!" | "You've checked in consistently for 2 weeks. A great habit is forming!" |
| 4 | "One month of consistency!" | "4 weeks in a row — you're building something real. Keep showing up!" |
| 8 | "Two months unstoppable!" | "8 consecutive weeks! Your dedication is seriously impressive." |
| 12 | "Quarter-year warrior!" | "12 weeks straight! You're in the top tier of committed members!" |
| 26 | "Half a year of greatness!" | "26 WEEKS! Six months of showing up. You're an absolute machine!" |
| 52 | "ONE YEAR STREAK!" | "52 weeks. 365 days of commitment. You are LEGENDARY!" |

### Total Check-In Milestones

| Count | Title | Body |
|-------|-------|------|
| 10 | "Double digits!" | "You've hit 10 check-ins! The journey is well underway." |
| 25 | "25 and counting!" | "25 visits to the gym — consistency is your superpower." |
| 50 | "Half century!" | "50 check-ins! That's serious commitment right there." |
| 100 | "The 100 Club!" | "100 CHECK-INS! You've joined an elite club. Incredible!" |
| 200 | "200 — Unstoppable!" | "200 check-ins! Your dedication is on another level entirely!" |
| 500 | "500 — LEGENDARY!" | "500 CHECK-INS! You are a gym LEGEND. Absolute respect!" |

### Highlight Milestones

| Type | Title | Body |
|------|-------|------|
| First check-in | "Welcome to the gym!" | "Your fitness journey starts today. We're glad you're here!" |
| Best week | "Personal best week!" | "You checked in {days} times this week — that's your best ever! Amazing effort!" |
| Longest streak broken | "New streak record!" | "You just beat your longest streak! {weeks} weeks and counting — new personal best!" |

## Data Model

### New Model: MilestoneNotification

```prisma
model MilestoneNotification {
  id             String   @id @default(uuid())
  memberId       String
  milestoneType  String   // WEEKLY_STREAK, TOTAL_CHECKINS, FIRST_CHECKIN, BEST_WEEK, LONGEST_STREAK
  milestoneValue Int      // The value that triggered it (e.g., 12 for 12-week streak)
  createdAt      DateTime @default(now())

  member User @relation(fields: [memberId], references: [id])

  @@unique([memberId, milestoneType, milestoneValue])
}
```

### Schema Changes

- Add `MILESTONE` to `NotificationType` enum
- Add `bestWeek Int @default(0)` field to `Streak` model

## Architecture

### Event-Driven Flow

```
CheckIn (AttendanceService)
  -> updateStreak() — returns { previousLongestStreak, previousBestWeek }
  -> emit 'streak.updated' event with payload
  -> return check-in response (no latency added)

MilestoneService @OnEvent('streak.updated')
  -> evaluateMilestones(payload)
  -> for each milestone hit:
      1. Try insert MilestoneNotification (unique violation = already sent, skip)
      2. If inserted, call notificationsService.create() with MILESTONE type
  -> fire-and-forget, errors logged but never thrown
```

### Event Payload: streak.updated

```typescript
{
  memberId: string;
  weeklyStreak: number;
  longestStreak: number;
  previousLongestStreak: number;
  previousBestWeek: number;
  daysThisWeek: number;
  totalCheckIns: number;
  isFirstCheckIn: boolean;
}
```

### updateStreak() Changes

Modify `updateStreak()` to return `{ previousLongestStreak, previousBestWeek }` — it already reads the existing Streak record internally, so no extra DB call needed. Also update `bestWeek` in the upsert logic.

### Key Design Decisions

- **Hardcoded milestones** — thresholds and messages defined in `milestones.constants.ts`
- **Dedup via MilestoneNotification table** — `@@unique([memberId, milestoneType, milestoneValue])` prevents duplicate notifications; insert catches unique violation and skips
- **Async via EventEmitter** — `@OnEvent('streak.updated')` runs after check-in response is returned, zero latency impact
- **Multiple milestones per check-in** — all applicable milestones fire (e.g., 100th check-in + 12-week streak)
- **Messages escalate** — warm/encouraging for early milestones, hype/energetic for major ones
- **No API endpoints** — milestones surface as regular MILESTONE-type notifications

## Module Structure

```
src/milestones/
  milestones.module.ts
  milestones.service.ts
  milestones.service.spec.ts
  milestones.constants.ts
```

### Dependencies

- `MilestonesModule` imports `PrismaModule`, `NotificationsModule`
- `AttendanceModule` does NOT import `MilestonesModule` — decoupled via EventEmitter
- `MilestonesModule` registered in `AppModule`
