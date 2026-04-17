# Goals Feature — Backend Design

**Date:** 2026-04-17
**Repo:** gym-management (API)
**Audience:** Backend implementation agent
**Supersedes:** `2026-04-16-goals-backend-design.md` in the gym-mobile repo

---

## Overview

Members can set any gym-related goal (strength, weight loss, muscle gain, consistency, endurance, body composition, other). On creation, the backend asynchronously calls Claude to generate a structured week-by-week plan tailored to the goal and the member's real attendance data. The plan is stored as checkable `GoalPlanItem`s and `GoalMilestone`s. A weekly cron sends a single summary push notification per member summarising progress across all active goals.

The feature is **license-gated** (`goals` feature key) and requires an **active subscription** to access — no subscription, no goals. One Claude call per goal; no user-initiated regeneration (members edit plan items manually if they want changes).

---

## Scope & non-goals

**In scope (MVP):**

- Member-scoped CRUD on goals, plan items, milestones, progress logs.
- Async AI plan generation with push notification on ready/failed.
- Weekly motivation cron.
- Cap on concurrent non-terminal goals per member (configurable via `GymSettings`).
- `ActiveSubscriptionGuard` as reusable infrastructure.

**Explicitly out of scope for MVP:**

- Trainer or admin visibility into member goals (deferred — re-evaluate after launch).
- AI regeneration of plans once successfully generated (members edit manually).
- Goal auto-completion on target hit (member closes the goal explicitly).
- Per-plan-item coaching notes.
- Goal templates / sharing between members.
- Analytics dashboards on goals.

---

## Data Model

Four new models, all with `@default(uuid())` ids, `createdAt`/`updatedAt` timestamps, and `onDelete: Cascade` on `goalId` relations.

### Enums

```prisma
enum GoalCategory {
  STRENGTH
  WEIGHT_LOSS
  MUSCLE_GAIN
  CONSISTENCY
  ENDURANCE
  BODY_COMPOSITION
  OTHER
}

enum GoalStatus {
  ACTIVE
  COMPLETED
  PAUSED
  ABANDONED
}

enum GoalGenerationStatus {
  GENERATING
  READY
  FAILED
}

enum GoalMetric {
  KG
  LBS
  REPS
  CM
  PERCENT
  DAYS_PER_WEEK
  MINUTES
}
```

### `Goal`

```prisma
model Goal {
  id                      String   @id @default(uuid())
  memberId                String
  member                  User     @relation(fields: [memberId], references: [id], onDelete: Cascade)
  title                   String                        // max 120
  category                GoalCategory
  metric                  GoalMetric
  currentValue            Decimal  @db.Decimal(10, 2)
  targetValue             Decimal  @db.Decimal(10, 2)
  currentGymFrequency     Int                           // snapshot at creation
  recommendedGymFrequency Int?                          // filled by AI
  aiEstimatedDeadline     DateTime?                     // filled by AI
  userDeadline            DateTime?
  aiReasoning             String?  @db.Text
  rawLlmResponse          Json?                         // debug only, stripped from API
  generationStatus        GoalGenerationStatus @default(GENERATING)
  generationError         String?  @db.Text
  generationStartedAt     DateTime @default(now())
  status                  GoalStatus @default(ACTIVE)
  createdAt               DateTime @default(now())
  updatedAt               DateTime @updatedAt

  planItems    GoalPlanItem[]
  milestones   GoalMilestone[]
  progressLogs GoalProgressLog[]

  @@index([memberId, status])
}
```

Rename `Milestone` → `GoalMilestone` in this feature to avoid collision with the existing `src/milestones/` module (attendance-streak milestones).

### `GoalPlanItem`

```prisma
model GoalPlanItem {
  id          String    @id @default(uuid())
  goalId      String
  goal        Goal      @relation(fields: [goalId], references: [id], onDelete: Cascade)
  weekNumber  Int
  dayLabel    String                                   // max 20
  description String                                   // max 200
  sets        Int?
  reps        Int?
  weight      Decimal?  @db.Decimal(10, 2)
  duration    Int?                                     // minutes
  completed   Boolean   @default(false)
  completedAt DateTime?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  @@index([goalId, weekNumber])
}
```

### `GoalMilestone`

```prisma
model GoalMilestone {
  id          String    @id @default(uuid())
  goalId      String
  goal        Goal      @relation(fields: [goalId], references: [id], onDelete: Cascade)
  weekNumber  Int
  description String                                   // max 200
  targetValue Decimal?  @db.Decimal(10, 2)
  completed   Boolean   @default(false)
  completedAt DateTime?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  @@index([goalId, weekNumber])
}
```

### `GoalProgressLog`

```prisma
model GoalProgressLog {
  id        String   @id @default(uuid())
  goalId    String
  goal      Goal     @relation(fields: [goalId], references: [id], onDelete: Cascade)
  value     Decimal  @db.Decimal(10, 2)
  note      String?                                     // max 500
  loggedAt  DateTime @default(now())
  createdAt DateTime @default(now())

  @@index([goalId, loggedAt])
}
```

### `GymSettings` additions

Add a new nullable int column `maxActiveGoalsPerMember` (default `3` via app-level fallback, same convention as other tunables).

### Validation bounds

- `title`: 1–120 chars.
- `dayLabel`: 1–20 chars.
- `description` (plan items, milestones): 1–200 chars.
- `note`: ≤ 500 chars.
- `sets`: 0–99.
- `reps`: 0–999.
- `weight`: 0–2000 (decimal).
- `duration`: 0–600 minutes.
- `requestedFrequency` (POST body): 1–7.
- `currentValue`, `targetValue`: >= 0.

### Security — fields stripped from API responses

Every service method must strip before returning:

- `rawLlmResponse` (debug only).
- `generationError` except on the owner's own `GET /goals/:id` (so they can see "why did this fail?").

---

## API Endpoints

All endpoints live under `/api/v1/goals` and are mounted on `GoalsController`. Controller-level guards: `JwtAuthGuard`, `ActiveSubscriptionGuard`, `RolesGuard`. Controller-level decorator: `@RequiresFeature('goals')`. All endpoints scope rows by `memberId === currentUser.id` — no cross-member access.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/goals` | Create goal; async AI generation begins. Returns 202. |
| `GET` | `/goals` | Paginated list of the member's goals (summary only). |
| `GET` | `/goals/:id` | Full goal detail including plan items, milestones, recent progress logs. |
| `PATCH` | `/goals/:id` | Update `status` and/or `userDeadline`. |
| `DELETE` | `/goals/:id` | Hard delete (cascades). |
| `POST` | `/goals/:id/retry-generation` | Retry Claude call when `generationStatus=FAILED` (one-shot). |
| `POST` | `/goals/:id/progress` | Append a `GoalProgressLog`; auto-completes matching milestones. |
| `DELETE` | `/goals/:id/progress/:logId` | Remove a mistakenly-entered log. |
| `POST` | `/goals/:id/plan-items` | Create a custom plan item. |
| `PATCH` | `/goals/:id/plan-items/:itemId` | Update (`description`, `sets`, `reps`, `weight`, `duration`, `completed`). |
| `DELETE` | `/goals/:id/plan-items/:itemId` | Remove a plan item. |
| `POST` | `/goals/:id/milestones` | Create a custom milestone. |
| `PATCH` | `/goals/:id/milestones/:milestoneId` | Update (`description`, `targetValue`, `completed`). |
| `DELETE` | `/goals/:id/milestones/:milestoneId` | Remove a milestone. |

### Request / Response contracts

**`POST /goals` body:**

```json
{
  "title": "Bench 120kg",
  "category": "STRENGTH",
  "metric": "KG",
  "currentValue": 80,
  "targetValue": 120,
  "userDeadline": "2026-09-01",
  "requestedFrequency": 5
}
```

`userDeadline` and `requestedFrequency` are optional. Returns `202 Accepted` with the newly created Goal row (in `GENERATING` status, no plan items / milestones yet).

**`GET /goals` response envelope:**

```json
{
  "data": [ /* GoalSummary */ ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 3,
    "activeCount": 2,
    "cap": 3
  }
}
```

`activeCount` is the member's count of `ACTIVE + PAUSED` goals; `cap` is `GymSettings.maxActiveGoalsPerMember`. Mobile uses these to disable the "Create Goal" button when at cap.

**`GET /goals/:id` response:** full `Goal` including `planItems` (ordered by `weekNumber` then `dayLabel`), `milestones` (ordered by `weekNumber`), and `progressLogs` (last 50, ordered `loggedAt desc`). `rawLlmResponse` is always stripped.

**`PATCH /goals/:id` body:** `{ "status": "PAUSED" }` or `{ "userDeadline": "2026-10-01" }`.

**`POST /goals/:id/progress` body:** `{ "value": 95, "note": "felt strong" }`.

**`PATCH /goals/:id/plan-items/:itemId` body:** any subset of `description`, `sets`, `reps`, `weight`, `duration`, `completed`. Setting `completed=true` sets `completedAt=now()`; `completed=false` nulls `completedAt`.

### Allowed `status` transitions

- `ACTIVE ↔ PAUSED`
- `ACTIVE → ABANDONED`
- `ACTIVE → COMPLETED`
- Terminal: `COMPLETED` and `ABANDONED` cannot be reopened (forces the member to create a new goal).

### Throttling

- `POST /goals`: 5/hour/member (prevents LLM abuse on top of the cap).
- All others: inherit global throttler (30/min).

### Concurrent goals cap

Before calling Claude in `POST /goals`:

```
count = goals where memberId = current AND status IN ('ACTIVE','PAUSED')
if count >= GymSettings.maxActiveGoalsPerMember (default 3):
  throw 400 "You have {count} active goals. Complete or abandon one to create another."
```

Cap counts `ACTIVE + PAUSED` so pausing everything doesn't bypass the limit. `COMPLETED` and `ABANDONED` do not count.

---

## AI Plan Generation

### Dependency

- Add `@anthropic-ai/sdk` to `package.json` (run `npm view @anthropic-ai/sdk versions` first to pick a real version).
- New `LlmModule` with `LlmService` provider — wraps the Anthropic client; returns typed results.
- New config factory `src/common/config/llm.config.ts`: `ANTHROPIC_API_KEY` (required when `goals` feature is licensed), `LLM_MODEL` (default `claude-sonnet-4-6`), `LLM_MAX_TOKENS` (default 4096), `LLM_TIMEOUT_MS` (default 60000).
- Never reference `process.env` from services — always via `ConfigService` with a typed config.

### Create sequence (`POST /goals`)

1. Guards pass (`JwtAuthGuard`, `ActiveSubscriptionGuard`, `FeatureGuard('goals')`).
2. Enforce concurrent-goals cap.
3. Compute snapshot: `attendanceService.getAvgDaysPerWeek(memberId, 4)`, plus `currentWeeklyStreak` and `longestStreak` from `Streak` (already in schema at `prisma/schema.prisma:264`).
4. Insert `Goal` with `generationStatus=GENERATING`, `generationStartedAt=now()`, no children.
5. Emit `goal.generation.requested` via `EventEmitter2` with `{ goalId }`.
6. Return `202` with the Goal row.

### Background listener (`GoalGenerationListener`)

Lives in `src/goals/listeners/goal-generation.listener.ts`. Listens for `goal.generation.requested` (async handler, so it runs off the request thread).

1. Re-read the Goal (concurrency-safe) including the member's snapshot fields.
2. Build the Claude prompt (template in "Prompt" section below).
3. Call `LlmService.generatePlan(prompt, { timeoutMs })`.
4. Validate JSON response shape with a `class-validator` DTO (`LlmPlanResponseDto`) — structure mirrors the prompt's expected output.
5. On success (inside a single Prisma transaction):
   - Insert `GoalPlanItem[]` from `plan`.
   - Insert `GoalMilestone[]` from `milestones`.
   - Update Goal: `recommendedGymFrequency`, `aiReasoning`, `rawLlmResponse`, `aiEstimatedDeadline = createdAt + estimatedWeeks * 7d`, `generationStatus = READY`.
6. Emit `goal.plan.ready` with `{ goalId, memberId, title }`.
7. On any failure (Anthropic error, timeout, JSON parse error, validation error):
   - Update Goal: `generationError = <stringified error>`, `generationStatus = FAILED`.
   - Emit `goal.plan.failed` with the same payload.
   - Log to Sentry with goal id, member id, error.
8. Listener never throws — all errors handled internally so the event bus doesn't swallow them silently.

### Retry (`POST /goals/:id/retry-generation`)

Guard: only callable when `generationStatus = FAILED`. Updates the goal back to `GENERATING`, bumps `generationStartedAt=now()`, nulls `generationError`, re-emits `goal.generation.requested`. Single retry per goal — track via a boolean `retriedOnce` field if we want to cap it (else rely on the member redeleting + recreating).

For MVP, allow unlimited retries on `FAILED` — the failure ceiling is implicit (each retry still costs a token budget; member will delete and move on eventually). Revisit if we see abuse.

### Prompt template

System prompt (constant):

> You are a professional personal trainer and fitness coach. Produce realistic, safe, structured training plans based on the member's current fitness data. Return ONLY valid JSON matching the schema given — no prose, no markdown fences.

User message (populated per call):

```
A gym member wants to achieve the following goal:
- Goal: {title}
- Category: {category}
- Metric: {metric}
- Current value: {currentValue} {metric}
- Target value: {targetValue} {metric}
- Current gym attendance: {currentGymFrequency} days/week
- Current weekly streak: {weeklyStreak} weeks
- Longest streak ever: {longestStreak} weeks
- Desired frequency: {requestedFrequency or "not specified — recommend one"}

Return ONLY valid JSON in this shape:
{
  "recommendedGymFrequency": <integer 1-7>,
  "estimatedWeeks": <integer 1-52>,
  "reasoning": "<2-3 sentences explaining timeline and frequency based on member's current habits>",
  "milestones": [
    { "weekNumber": <integer>, "description": "<string>", "targetValue": <number or null> }
  ],
  "plan": [
    {
      "weekNumber": <integer>,
      "dayLabel": "<e.g. Monday or Day 1>",
      "description": "<exercise or activity>",
      "sets": <integer or null>,
      "reps": <integer or null>,
      "weight": <number or null>,
      "duration": <integer minutes or null>
    }
  ]
}

Rules:
- Plan items must cover weeks 1 through estimatedWeeks.
- Each week should have exactly recommendedGymFrequency plan items.
- Milestones appear every 2-4 weeks as checkpoints.
- Use progressive overload for strength goals.
- For CONSISTENCY goals with metric DAYS_PER_WEEK, plan items are general gym sessions.
- Keep descriptions concise and actionable.
- If requestedFrequency is specified, use it as recommendedGymFrequency.
```

### Notifications

`NotificationsService.recordAndNotify` is called from event listeners for:

- `goal.plan.ready` → type `GOAL_PLAN_READY`, title "Your plan is ready", body "Your {title} plan is ready — open to view". Metadata: `{ goalId }`.
- `goal.plan.failed` → type `GOAL_PLAN_FAILED`, title "Plan generation failed", body "We couldn't generate your plan. Tap to retry." Metadata: `{ goalId }`.

No push notifications for plan-item check-off, progress log entry, or goal completion — these are in-app only (avoid push fatigue).

---

## Guards

### `ActiveSubscriptionGuard` (new, reusable)

Lives in `src/common/guards/active-subscription.guard.ts`. Not registered globally; opted into per-controller via `@UseGuards(JwtAuthGuard, ActiveSubscriptionGuard, ...)`.

Logic:

1. If `request.user` missing, skip (JwtAuthGuard will have blocked).
2. If `@AllowInactiveSubscription()` metadata present on handler/class, pass.
3. If `request.user.role` is `ADMIN`, `SUPER_ADMIN`, or `TRAINER`, pass (staff never need a subscription).
4. Delegate to `SubscriptionsService.hasActiveSubscription(userId)` (already exists at `src/subscriptions/subscriptions.service.ts:445`).
5. Throw `ForbiddenException('Active subscription required')` (HTTP 403) when false.

`@AllowInactiveSubscription()` is a no-arg metadata decorator for endpoints that the member still needs to access without a subscription (e.g., their own `GET /auth/me`). It is NOT used on `GoalsController` — the whole module requires an active sub.

### `FeatureGuard('goals')`

Controller-level. Add `goals` to the license feature registry in `src/licensing/` (matching how `events`, `member-tags`, etc. are registered). Dev mode (no license key) allows all features. Update CLAUDE.md "Gated modules" list.

---

## Cron Jobs

All crons use `Africa/Nairobi` timezone. Live in `src/goals/goals.cron.ts`.

### 1. Stale generation sweeper

- Schedule: `*/5 * * * *` (every 5 minutes).
- Query: goals where `generationStatus = GENERATING` AND `generationStartedAt < now() - 10 min`.
- Action: update each to `generationStatus = FAILED`, `generationError = 'Generation timed out'`. Emit `goal.plan.failed` per row.

### 2. Weekly motivation push

- Schedule: `0 9 * * 1` (Monday 09:00 Nairobi).
- Logic: group active goals (`status = ACTIVE`) by `memberId`. Skip members without push tokens.
- For each member, build one summary push:
  - Compute per-goal tone based on latest progress log vs nearest upcoming `GoalMilestone.targetValue`:
    - No progress this week → "no-progress"
    - Progress logged, behind milestone → "behind"
    - Progress logged, meeting or ahead of milestone → "on-track"
    - Most recent milestone completed this week → "celebrating"
  - Pick the lead line from the most attention-worthy goal (priority: celebrating > behind > no-progress > on-track).
  - Body: "{lead message}. {n-1} other goal(s) want your attention — tap to review."
  - If only one goal, omit the "other goals" tail.
- Send via `NotificationsService.recordAndNotify` with type `GOAL_WEEKLY_PULSE`, metadata `{ goalIds: [...] }`.
- In-app notifications may still be one-per-goal for readability in the notifications feed (cheap, no push noise).

### 3. Abandoned goal cleanup

- Schedule: `0 3 * * 0` (Sunday 03:00 Nairobi).
- Action: hard-delete goals where `status = ABANDONED` AND `updatedAt < now() - 90 days`. Cascade removes plan items, milestones, progress logs.
- `COMPLETED` goals are retained indefinitely (member history).

---

## Testing

Follow existing module conventions (`events`, `member-tags`). Mock `PrismaService` using `jest-mock-extended`.

### New spec files

- `src/goals/goals.service.spec.ts`
  - CRUD happy paths
  - Ownership scoping (rejects cross-member access)
  - Concurrent-goal cap enforcement
  - Status transition whitelist
  - Progress log auto-completes matching milestones (both `>=` for growth goals and `<=` for `WEIGHT_LOSS`)
  - Strips `rawLlmResponse` from responses

- `src/goals/listeners/goal-generation.listener.spec.ts`
  - Success path writes plan items + milestones in one transaction
  - JSON validation failure → `FAILED` status with `generationError`
  - Anthropic error → `FAILED`
  - Timeout → `FAILED`
  - Idempotent when the event fires twice (no duplicate plan items)

- `src/goals/goals.cron.spec.ts`
  - Stale sweeper flips only rows older than 10 min
  - Weekly push groups per member and produces a single push per member
  - Abandoned cleanup deletes only goals >90 days ABANDONED

- `src/common/guards/active-subscription.guard.spec.ts`
  - Allows active subscriber
  - Blocks expired subscriber
  - Skips ADMIN/SUPER_ADMIN/TRAINER
  - Respects `@AllowInactiveSubscription()`

- `src/attendance/attendance.service.spec.ts` — add test for new `getAvgDaysPerWeek(memberId, weeks)` utility.

- `src/licensing/licensing.service.spec.ts` — add `goals` feature key test.

### Manual / e2e

With a real `ANTHROPIC_API_KEY` in dev:

1. `POST /goals` — observe `202` with `generationStatus=GENERATING`.
2. Wait ~10–30s.
3. `GET /goals/:id` — confirm `status=READY`, plan items and milestones populated, `aiEstimatedDeadline` set.
4. Confirm `GOAL_PLAN_READY` push fired (check notifications table + Expo logs).
5. Simulate failure by setting an invalid model id in config — observe `FAILED` and `GOAL_PLAN_FAILED` push.
6. `POST /goals/:id/retry-generation` — observe fresh attempt.
7. Create 3 goals, attempt a 4th — confirm `400` with cap message.

---

## Environment & configuration additions

Add to `.env.example`:

```
ANTHROPIC_API_KEY=
LLM_MODEL=claude-sonnet-4-6
LLM_MAX_TOKENS=4096
LLM_TIMEOUT_MS=60000
```

Update `src/common/config/` with `llm.config.ts` factory.

Update CLAUDE.md:

- Add `goals/` to the Modules list with one-paragraph summary.
- Add `goals` to the "Gated modules" line in the licensing section.
- Add `maxActiveGoalsPerMember` to the `gym-settings/` module description.

---

## Rollout

1. Prisma migration: create four tables, four enums, add `maxActiveGoalsPerMember` to `GymSettings`.
2. Implementation order (each phase tested and passes lint + typecheck + tests):
   - Phase 1: `ActiveSubscriptionGuard` + `AllowInactiveSubscription` decorator (independent; usable elsewhere).
   - Phase 2: `LlmModule` + `LlmService` + config.
   - Phase 3: `AttendanceService.getAvgDaysPerWeek` utility.
   - Phase 4: Goals Prisma models + migration.
   - Phase 5: Goals CRUD service + controller + DTOs + Swagger.
   - Phase 6: Async generation listener + retry endpoint.
   - Phase 7: Crons (stale sweeper, weekly push, abandoned cleanup).
   - Phase 8: Feature key registration, CLAUDE.md updates, env example.
3. License tier update: add `goals` feature key to dev-mode allow-all and to the default tier definitions.
4. Mobile ready-to-consume contract: `GET /goals` envelope with `activeCount` + `cap`; `GET /goals/:id` polling on `generationStatus` not required (push notification drives refresh), but mobile should still refresh on pull-to-refresh and on app foreground.
