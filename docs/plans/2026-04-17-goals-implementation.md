# Goals Feature Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a member-facing Goals module where members create fitness goals and receive AI-generated week-by-week plans, with async generation, push notifications on ready, progress tracking, and a weekly motivation cron.

**Architecture:** NestJS module (`src/goals/`) with Prisma models (Goal, GoalPlanItem, GoalMilestone, GoalProgressLog). `POST /goals` inserts the goal in `GENERATING` status and emits an `EventEmitter2` event. A background listener calls Anthropic's Claude API, validates JSON, persists plan items + milestones, emits `goal.plan.ready`, and triggers a push notification via `NotificationsService`. Feature-gated via `@RequiresFeature('goals')` and a new reusable `ActiveSubscriptionGuard`.

**Tech Stack:** NestJS 11, Prisma 6, PostgreSQL, Anthropic SDK (`@anthropic-ai/sdk`), `@nestjs/event-emitter`, `@nestjs/schedule`, `@nestjs/throttler`, `class-validator`, Jest + `jest-mock-extended`.

**Source design:** `docs/plans/2026-04-17-goals-backend-design.md` (commit `04266a4`)

**Conventions to follow:**

- TDD: write the failing test first, confirm it fails, implement, confirm it passes, commit.
- Run `yarn lint && yarn typecheck && yarn test` before every commit (per memory: "run tests" = lint + types + tests).
- Strip sensitive fields (`rawLlmResponse`, `generationError` except for owner) from every response.
- Update Swagger decorators when endpoints change.
- Africa/Nairobi timezone for all crons.
- Never reference `process.env` in services — always via `ConfigService` with a typed config factory.

---

## Phase 0 — Verify prerequisites

### Task 0.1: Confirm current branch and clean tree

**Step 1:** Run `git status` — must show `dev` branch, clean tree, `1 commit ahead of origin/dev` (the design doc).

**Step 2:** Run `yarn test` once to confirm current baseline passes. Note the number of passing tests. Expected: all pass.

**Step 3:** Run `yarn lint && yarn typecheck`. Both must pass before we start.

No commit needed.

---

## Phase 1 — ActiveSubscriptionGuard (reusable infra)

### Task 1.1: Create `@AllowInactiveSubscription` decorator

**Files:**
- Create: `src/common/decorators/allow-inactive-subscription.decorator.ts`

**Step 1: Write the decorator**

```typescript
import { SetMetadata } from '@nestjs/common';

export const ALLOW_INACTIVE_SUBSCRIPTION_KEY = 'allowInactiveSubscription';
export const AllowInactiveSubscription = () =>
  SetMetadata(ALLOW_INACTIVE_SUBSCRIPTION_KEY, true);
```

**Step 2: Run typecheck**

Run: `yarn typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add src/common/decorators/allow-inactive-subscription.decorator.ts
git commit -m "feat(common): add @AllowInactiveSubscription() metadata decorator"
```

---

### Task 1.2: Write failing tests for `ActiveSubscriptionGuard`

**Files:**
- Create: `src/common/guards/active-subscription.guard.spec.ts`

**Step 1: Write the failing test**

```typescript
import { Test } from '@nestjs/testing';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ActiveSubscriptionGuard } from './active-subscription.guard';
import { SubscriptionsService } from '../../subscriptions/subscriptions.service';

describe('ActiveSubscriptionGuard', () => {
  let guard: ActiveSubscriptionGuard;
  let reflector: Reflector;
  const subscriptionsService = {
    hasActiveSubscription: jest.fn(),
  };

  const buildContext = (user: unknown): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
      getHandler: () => ({}),
      getClass: () => ({}),
    }) as unknown as ExecutionContext;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ActiveSubscriptionGuard,
        Reflector,
        { provide: SubscriptionsService, useValue: subscriptionsService },
      ],
    }).compile();
    guard = moduleRef.get(ActiveSubscriptionGuard);
    reflector = moduleRef.get(Reflector);
    jest.clearAllMocks();
  });

  it('passes when no user is attached (JwtAuthGuard will block)', async () => {
    await expect(guard.canActivate(buildContext(undefined))).resolves.toBe(
      true,
    );
  });

  it('passes when handler is marked with @AllowInactiveSubscription()', async () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValueOnce(true); // allowInactive metadata
    await expect(
      guard.canActivate(buildContext({ id: 'u1', role: 'MEMBER' })),
    ).resolves.toBe(true);
    expect(subscriptionsService.hasActiveSubscription).not.toHaveBeenCalled();
  });

  it('passes for ADMIN role without checking subscription', async () => {
    await expect(
      guard.canActivate(buildContext({ id: 'admin', role: 'ADMIN' })),
    ).resolves.toBe(true);
    expect(subscriptionsService.hasActiveSubscription).not.toHaveBeenCalled();
  });

  it('passes for SUPER_ADMIN and TRAINER too', async () => {
    for (const role of ['SUPER_ADMIN', 'TRAINER']) {
      await expect(
        guard.canActivate(buildContext({ id: 'u', role })),
      ).resolves.toBe(true);
    }
    expect(subscriptionsService.hasActiveSubscription).not.toHaveBeenCalled();
  });

  it('passes for MEMBER with an active subscription', async () => {
    subscriptionsService.hasActiveSubscription.mockResolvedValue(true);
    await expect(
      guard.canActivate(buildContext({ id: 'm1', role: 'MEMBER' })),
    ).resolves.toBe(true);
    expect(subscriptionsService.hasActiveSubscription).toHaveBeenCalledWith(
      'm1',
    );
  });

  it('throws ForbiddenException for MEMBER without an active subscription', async () => {
    subscriptionsService.hasActiveSubscription.mockResolvedValue(false);
    await expect(
      guard.canActivate(buildContext({ id: 'm1', role: 'MEMBER' })),
    ).rejects.toThrow(ForbiddenException);
  });
});
```

**Step 2: Run to confirm it fails**

Run: `yarn test -- --testPathPattern=active-subscription.guard.spec`
Expected: FAIL — `Cannot find module './active-subscription.guard'`.

---

### Task 1.3: Implement `ActiveSubscriptionGuard`

**Files:**
- Create: `src/common/guards/active-subscription.guard.ts`

**Step 1: Implement**

```typescript
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ALLOW_INACTIVE_SUBSCRIPTION_KEY } from '../decorators/allow-inactive-subscription.decorator';
import { SubscriptionsService } from '../../subscriptions/subscriptions.service';

const STAFF_ROLES = new Set(['ADMIN', 'SUPER_ADMIN', 'TRAINER']);

@Injectable()
export class ActiveSubscriptionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      user?: { id: string; role: string };
    }>();
    const user = request.user;

    if (!user) return true;

    const allowInactive = this.reflector.getAllAndOverride<boolean>(
      ALLOW_INACTIVE_SUBSCRIPTION_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (allowInactive) return true;

    if (STAFF_ROLES.has(user.role)) return true;

    const active = await this.subscriptionsService.hasActiveSubscription(
      user.id,
    );
    if (!active) {
      throw new ForbiddenException('Active subscription required');
    }
    return true;
  }
}
```

**Step 2: Run tests**

Run: `yarn test -- --testPathPattern=active-subscription.guard.spec`
Expected: PASS (6 tests).

**Step 3: Lint + typecheck**

Run: `yarn lint && yarn typecheck`
Expected: PASS.

**Step 4: Commit**

```bash
git add src/common/guards/active-subscription.guard.ts src/common/guards/active-subscription.guard.spec.ts
git commit -m "feat(common): add reusable ActiveSubscriptionGuard

Skips for staff roles and for handlers tagged with
@AllowInactiveSubscription(). Delegates to
SubscriptionsService.hasActiveSubscription otherwise."
```

---

## Phase 2 — LLM module + Anthropic SDK

### Task 2.1: Install Anthropic SDK (verify version first)

**Step 1: Verify the version exists**

Run: `npm view @anthropic-ai/sdk versions --json | tail -20`
Pick the latest stable (non-beta) version. At time of writing, likely `0.30.x` or higher. Record the version you picked.

**Step 2: Install**

Run: `yarn add @anthropic-ai/sdk@<picked-version>`

**Step 3: Verify install**

Run: `yarn typecheck`
Expected: PASS (no type errors from the new package).

**Step 4: Commit**

```bash
git add package.json yarn.lock
git commit -m "chore(deps): add @anthropic-ai/sdk for goals AI generation"
```

---

### Task 2.2: Create typed `llm.config.ts`

**Files:**
- Create: `src/common/config/llm.config.ts`
- Modify: `src/common/loaders/config.loader.module.ts`

**Step 1: Write the config factory**

```typescript
import { registerAs } from '@nestjs/config';

export type LlmConfig = {
  apiKey: string;
  model: string;
  maxTokens: number;
  timeoutMs: number;
  enabled: boolean;
};

export const getLlmConfigName = () => 'llm';

export const getLlmConfig = (): LlmConfig => {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? '';
  const model = process.env.LLM_MODEL || 'claude-sonnet-4-6';
  const maxTokens = Number(process.env.LLM_MAX_TOKENS ?? 4096);
  const timeoutMs = Number(process.env.LLM_TIMEOUT_MS ?? 60000);
  return { apiKey, model, maxTokens, timeoutMs, enabled: !!apiKey };
};

export default registerAs(getLlmConfigName(), getLlmConfig);
```

**Step 2: Wire into the config loader**

In `src/common/loaders/config.loader.module.ts`, add the import and include it in the `load` array alongside existing factories.

```typescript
import llmConfig from '../config/llm.config';
// ...
load: [appConfig, authConfig, databaseConfig, mailConfig, paymentConfig, sentryConfig, cloudinaryConfig, licensingConfig, llmConfig],
```

**Step 3: Typecheck**

Run: `yarn typecheck`
Expected: PASS.

**Step 4: Commit**

```bash
git add src/common/config/llm.config.ts src/common/loaders/config.loader.module.ts
git commit -m "feat(config): add typed llm config factory"
```

---

### Task 2.3: Write failing test for `LlmService.generatePlan`

**Files:**
- Create: `src/llm/llm.service.spec.ts`

**Step 1: Write the failing test**

```typescript
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { LlmService } from './llm.service';

describe('LlmService', () => {
  let service: LlmService;
  const mockCreate = jest.fn();

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        LlmService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue({
              apiKey: 'test-key',
              model: 'claude-sonnet-4-6',
              maxTokens: 1024,
              timeoutMs: 30000,
              enabled: true,
            }),
          },
        },
      ],
    }).compile();
    service = moduleRef.get(LlmService);
    // Swap the SDK client for a mock.
    (service as unknown as { client: { messages: { create: jest.Mock } } }).client = {
      messages: { create: mockCreate },
    };
  });

  it('returns parsed JSON from the assistant message', async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            recommendedGymFrequency: 4,
            estimatedWeeks: 12,
            reasoning: 'ok',
            milestones: [],
            plan: [],
          }),
        },
      ],
    });
    const result = await service.generatePlan('prompt');
    expect(result).toMatchObject({ recommendedGymFrequency: 4 });
  });

  it('throws when response has no text content', async () => {
    mockCreate.mockResolvedValue({ content: [] });
    await expect(service.generatePlan('prompt')).rejects.toThrow(
      /empty response/i,
    );
  });

  it('throws when response text is not valid JSON', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'not json' }],
    });
    await expect(service.generatePlan('prompt')).rejects.toThrow(
      /invalid JSON/i,
    );
  });

  it('throws when config is not enabled (no API key)', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        LlmService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue({
              apiKey: '',
              model: 'claude-sonnet-4-6',
              maxTokens: 1024,
              timeoutMs: 30000,
              enabled: false,
            }),
          },
        },
      ],
    }).compile();
    const disabled = moduleRef.get(LlmService);
    await expect(disabled.generatePlan('prompt')).rejects.toThrow(
      /not configured/i,
    );
  });
});
```

**Step 2: Run — confirm fail**

Run: `yarn test -- --testPathPattern=llm.service.spec`
Expected: FAIL — cannot find module.

---

### Task 2.4: Implement `LlmService`

**Files:**
- Create: `src/llm/llm.service.ts`
- Create: `src/llm/llm.module.ts`

**Step 1: Implement the service**

```typescript
// src/llm/llm.service.ts
import Anthropic from '@anthropic-ai/sdk';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getLlmConfigName, LlmConfig } from '../common/config/llm.config';

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly config: LlmConfig;
  private readonly client: Anthropic;

  constructor(configService: ConfigService) {
    this.config = configService.get<LlmConfig>(getLlmConfigName())!;
    this.client = new Anthropic({
      apiKey: this.config.apiKey || 'unset',
      timeout: this.config.timeoutMs,
    });
  }

  async generatePlan(userPrompt: string): Promise<unknown> {
    if (!this.config.enabled) {
      throw new Error('LLM is not configured (ANTHROPIC_API_KEY missing)');
    }

    const response = await this.client.messages.create({
      model: this.config.model,
      max_tokens: this.config.maxTokens,
      system:
        'You are a professional personal trainer and fitness coach. Produce realistic, safe, structured training plans based on the member\'s current fitness data. Return ONLY valid JSON matching the schema given — no prose, no markdown fences.',
      messages: [{ role: 'user', content: userPrompt }],
    });

    const text = response.content.find((block) => block.type === 'text');
    if (!text || text.type !== 'text') {
      throw new Error('LLM returned empty response');
    }

    try {
      return JSON.parse(text.text);
    } catch (err) {
      this.logger.error('LLM returned invalid JSON', err);
      throw new Error('LLM returned invalid JSON');
    }
  }
}
```

**Step 2: Create the module**

```typescript
// src/llm/llm.module.ts
import { Module } from '@nestjs/common';
import { LlmService } from './llm.service';

@Module({
  providers: [LlmService],
  exports: [LlmService],
})
export class LlmModule {}
```

**Step 3: Run tests**

Run: `yarn test -- --testPathPattern=llm.service.spec`
Expected: PASS (4 tests).

**Step 4: Lint + typecheck**

Run: `yarn lint && yarn typecheck`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/llm
git commit -m "feat(llm): add LlmService wrapper around Anthropic SDK"
```

---

## Phase 3 — Attendance: `getAvgDaysPerWeek`

### Task 3.1: Failing test for `getAvgDaysPerWeek`

**Files:**
- Modify: `src/attendance/attendance.service.spec.ts` (append test)

**Step 1: Add failing test**

Append inside the existing `describe('AttendanceService', ...)` block:

```typescript
describe('getAvgDaysPerWeek', () => {
  it('returns average distinct check-in dates per week over the window', async () => {
    const now = new Date('2026-04-17T10:00:00Z');
    jest.useFakeTimers().setSystemTime(now);

    prisma.attendance.findMany.mockResolvedValue(
      // 8 distinct dates over 4 weeks → 2 days/week avg.
      [
        { checkInDate: new Date('2026-04-16') },
        { checkInDate: new Date('2026-04-14') },
        { checkInDate: new Date('2026-04-09') },
        { checkInDate: new Date('2026-04-07') },
        { checkInDate: new Date('2026-04-02') },
        { checkInDate: new Date('2026-03-31') },
        { checkInDate: new Date('2026-03-26') },
        { checkInDate: new Date('2026-03-24') },
      ] as unknown as { checkInDate: Date }[],
    );

    const avg = await service.getAvgDaysPerWeek('m1', 4);
    expect(avg).toBe(2);

    jest.useRealTimers();
  });

  it('returns 0 when there are no attendance records', async () => {
    prisma.attendance.findMany.mockResolvedValue([]);
    const avg = await service.getAvgDaysPerWeek('m1', 4);
    expect(avg).toBe(0);
  });

  it('defaults to 4 weeks when no window supplied', async () => {
    prisma.attendance.findMany.mockResolvedValue([]);
    await service.getAvgDaysPerWeek('m1');
    const args = prisma.attendance.findMany.mock.calls[0][0] as {
      where: { memberId: string; checkInDate: { gte: Date } };
    };
    expect(args.where.memberId).toBe('m1');
    expect(args.where.checkInDate.gte).toBeInstanceOf(Date);
  });
});
```

**Step 2: Confirm fail**

Run: `yarn test -- --testPathPattern=attendance.service.spec`
Expected: FAIL — `service.getAvgDaysPerWeek is not a function`.

---

### Task 3.2: Implement `getAvgDaysPerWeek`

**Files:**
- Modify: `src/attendance/attendance.service.ts` (add method)

**Step 1: Add method**

```typescript
async getAvgDaysPerWeek(memberId: string, weeks = 4): Promise<number> {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - weeks * 7);
  cutoff.setUTCHours(0, 0, 0, 0);

  const rows = await this.prisma.attendance.findMany({
    where: { memberId, checkInDate: { gte: cutoff } },
    select: { checkInDate: true },
  });
  if (rows.length === 0) return 0;

  const distinctDays = new Set(
    rows.map((r) => r.checkInDate.toISOString().slice(0, 10)),
  );
  return Math.round(distinctDays.size / weeks);
}
```

**Step 2: Run tests**

Run: `yarn test -- --testPathPattern=attendance.service.spec`
Expected: PASS.

**Step 3: Lint + typecheck + full test**

Run: `yarn lint && yarn typecheck && yarn test`
Expected: PASS.

**Step 4: Commit**

```bash
git add src/attendance/attendance.service.ts src/attendance/attendance.service.spec.ts
git commit -m "feat(attendance): add getAvgDaysPerWeek utility

Returns avg distinct check-in days per week over the last N weeks
(default 4). Used by goals module to snapshot currentGymFrequency
at goal creation time."
```

---

## Phase 4 — Prisma schema + migration

### Task 4.1: Add enums + models to `prisma/schema.prisma`

**Files:**
- Modify: `prisma/schema.prisma`

**Step 1: Add enums after the existing enum block**

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

**Step 2: Extend `NotificationType` enum with three new values**

Find the existing `enum NotificationType` in `prisma/schema.prisma` and append:

```prisma
GOAL_PLAN_READY
GOAL_PLAN_FAILED
GOAL_WEEKLY_PULSE
```

**Step 3: Extend `GymSettings` with `maxActiveGoalsPerMember`**

Inside the `model GymSettings` block, after `loyalStreakWeeks`:

```prisma
maxActiveGoalsPerMember Int @default(3)
```

**Step 4: Add relation field to `User`**

Inside `model User`, after the last `@relation` line (next to `memberTags`):

```prisma
goals Goal[] @relation("UserGoals")
```

**Step 5: Add the four goal models at the end of the schema**

```prisma
model Goal {
  id                      String               @id @default(uuid())
  memberId                String
  member                  User                 @relation("UserGoals", fields: [memberId], references: [id], onDelete: Cascade)
  title                   String
  category                GoalCategory
  metric                  GoalMetric
  currentValue            Decimal              @db.Decimal(10, 2)
  targetValue             Decimal              @db.Decimal(10, 2)
  currentGymFrequency     Int
  recommendedGymFrequency Int?
  aiEstimatedDeadline     DateTime?
  userDeadline            DateTime?
  aiReasoning             String?
  rawLlmResponse          Json?
  generationStatus        GoalGenerationStatus @default(GENERATING)
  generationError         String?
  generationStartedAt     DateTime             @default(now())
  status                  GoalStatus           @default(ACTIVE)
  createdAt               DateTime             @default(now())
  updatedAt               DateTime             @updatedAt

  planItems    GoalPlanItem[]
  milestones   GoalMilestone[]
  progressLogs GoalProgressLog[]

  @@index([memberId, status])
}

model GoalPlanItem {
  id          String    @id @default(uuid())
  goalId      String
  goal        Goal      @relation(fields: [goalId], references: [id], onDelete: Cascade)
  weekNumber  Int
  dayLabel    String
  description String
  sets        Int?
  reps        Int?
  weight      Decimal?  @db.Decimal(10, 2)
  duration    Int?
  completed   Boolean   @default(false)
  completedAt DateTime?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  @@index([goalId, weekNumber])
}

model GoalMilestone {
  id          String    @id @default(uuid())
  goalId      String
  goal        Goal      @relation(fields: [goalId], references: [id], onDelete: Cascade)
  weekNumber  Int
  description String
  targetValue Decimal?  @db.Decimal(10, 2)
  completed   Boolean   @default(false)
  completedAt DateTime?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  @@index([goalId, weekNumber])
}

model GoalProgressLog {
  id        String   @id @default(uuid())
  goalId    String
  goal      Goal     @relation(fields: [goalId], references: [id], onDelete: Cascade)
  value     Decimal  @db.Decimal(10, 2)
  note      String?
  loggedAt  DateTime @default(now())
  createdAt DateTime @default(now())

  @@index([goalId, loggedAt])
}
```

**Step 6: Format the schema**

Run: `npx prisma format`
Expected: schema rewrites to canonical form, no errors.

---

### Task 4.2: Create and apply the migration

**Step 1: Create the migration**

Run: `npx prisma migrate dev --name add_goals_module`
Expected: Prisma creates a new migration in `prisma/migrations/<ts>_add_goals_module/` and applies it. Client regenerates.

**Step 2: Inspect the migration SQL**

Open the newly generated `migration.sql` and confirm it:
- Creates enums `GoalCategory`, `GoalStatus`, `GoalGenerationStatus`, `GoalMetric`.
- Alters `NotificationType` enum with the three new values.
- Adds `maxActiveGoalsPerMember` column to `GymSettings`.
- Creates four `Goal*` tables with the expected indexes and cascading FKs.

**Step 3: Run typecheck**

Run: `yarn typecheck`
Expected: PASS — Prisma client types are now available for `prisma.goal`, `prisma.goalPlanItem`, etc.

**Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(prisma): add goals module schema

New models: Goal, GoalPlanItem, GoalMilestone, GoalProgressLog.
New enums: GoalCategory, GoalStatus, GoalGenerationStatus, GoalMetric.
Extends NotificationType with GOAL_PLAN_READY, GOAL_PLAN_FAILED,
GOAL_WEEKLY_PULSE. Adds GymSettings.maxActiveGoalsPerMember (default 3)."
```

---

## Phase 5 — Goals CRUD skeleton

### Task 5.1: DTOs — request shapes

**Files:**
- Create: `src/goals/dto/create-goal.dto.ts`
- Create: `src/goals/dto/update-goal.dto.ts`
- Create: `src/goals/dto/create-progress-log.dto.ts`
- Create: `src/goals/dto/upsert-plan-item.dto.ts` (used by create + patch)
- Create: `src/goals/dto/upsert-milestone.dto.ts`
- Create: `src/goals/dto/list-goals-query.dto.ts`

**Step 1: `create-goal.dto.ts`**

```typescript
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { GoalCategory, GoalMetric } from '@prisma/client';

export class CreateGoalDto {
  @ApiProperty({ maxLength: 120 })
  @IsString()
  @MaxLength(120)
  title: string;

  @ApiProperty({ enum: GoalCategory })
  @IsEnum(GoalCategory)
  category: GoalCategory;

  @ApiProperty({ enum: GoalMetric })
  @IsEnum(GoalMetric)
  metric: GoalMetric;

  @ApiProperty({ minimum: 0 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  currentValue: number;

  @ApiProperty({ minimum: 0 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  targetValue: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 7 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(7)
  requestedFrequency?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  userDeadline?: Date;
}
```

**Step 2: `update-goal.dto.ts`**

```typescript
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsOptional } from 'class-validator';
import { GoalStatus } from '@prisma/client';

export class UpdateGoalDto {
  @ApiPropertyOptional({ enum: GoalStatus })
  @IsOptional()
  @IsEnum(GoalStatus)
  status?: GoalStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  userDeadline?: Date;
}
```

**Step 3: `create-progress-log.dto.ts`**

```typescript
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreateProgressLogDto {
  @ApiProperty({ minimum: 0 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  value: number;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
```

**Step 4: `upsert-plan-item.dto.ts`**

```typescript
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreatePlanItemDto {
  @ApiProperty({ minimum: 1 })
  @Type(() => Number) @IsInt() @Min(1)
  weekNumber: number;

  @ApiProperty({ maxLength: 20 })
  @IsString() @MaxLength(20)
  dayLabel: string;

  @ApiProperty({ maxLength: 200 })
  @IsString() @MaxLength(200)
  description: string;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(99)
  sets?: number;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(999)
  reps?: number;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(2000)
  weight?: number;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(600)
  duration?: number;
}

export class UpdatePlanItemDto extends PartialType(CreatePlanItemDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  completed?: boolean;
}
```

**Step 5: `upsert-milestone.dto.ts`**

```typescript
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateMilestoneDto {
  @ApiProperty({ minimum: 1 })
  @Type(() => Number) @IsInt() @Min(1)
  weekNumber: number;

  @ApiProperty({ maxLength: 200 })
  @IsString() @MaxLength(200)
  description: string;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0)
  targetValue?: number;
}

export class UpdateMilestoneDto extends PartialType(CreateMilestoneDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  completed?: boolean;
}
```

**Step 6: `list-goals-query.dto.ts`**

```typescript
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { GoalStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class ListGoalsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: GoalStatus })
  @IsOptional()
  @IsEnum(GoalStatus)
  status?: GoalStatus;
}
```

**Step 7: Typecheck + commit**

Run: `yarn typecheck`
Expected: PASS.

```bash
git add src/goals/dto
git commit -m "feat(goals): add DTOs for goals module"
```

---

### Task 5.2: Response DTOs + sanitizer

**Files:**
- Create: `src/goals/dto/goal-response.dto.ts`
- Create: `src/goals/goals.sanitizer.ts`

**Step 1: Response DTOs**

```typescript
// src/goals/dto/goal-response.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  GoalCategory,
  GoalGenerationStatus,
  GoalMetric,
  GoalStatus,
} from '@prisma/client';

export class GoalPlanItemResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() weekNumber: number;
  @ApiProperty() dayLabel: string;
  @ApiProperty() description: string;
  @ApiPropertyOptional() sets: number | null;
  @ApiPropertyOptional() reps: number | null;
  @ApiPropertyOptional() weight: number | null;
  @ApiPropertyOptional() duration: number | null;
  @ApiProperty() completed: boolean;
  @ApiPropertyOptional() completedAt: Date | null;
}

export class GoalMilestoneResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() weekNumber: number;
  @ApiProperty() description: string;
  @ApiPropertyOptional() targetValue: number | null;
  @ApiProperty() completed: boolean;
  @ApiPropertyOptional() completedAt: Date | null;
}

export class GoalProgressLogResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() value: number;
  @ApiPropertyOptional() note: string | null;
  @ApiProperty() loggedAt: Date;
}

export class GoalResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() memberId: string;
  @ApiProperty() title: string;
  @ApiProperty({ enum: GoalCategory }) category: GoalCategory;
  @ApiProperty({ enum: GoalMetric }) metric: GoalMetric;
  @ApiProperty() currentValue: number;
  @ApiProperty() targetValue: number;
  @ApiProperty() currentGymFrequency: number;
  @ApiPropertyOptional() recommendedGymFrequency: number | null;
  @ApiPropertyOptional() aiEstimatedDeadline: Date | null;
  @ApiPropertyOptional() userDeadline: Date | null;
  @ApiPropertyOptional() aiReasoning: string | null;
  @ApiProperty({ enum: GoalGenerationStatus }) generationStatus: GoalGenerationStatus;
  @ApiPropertyOptional() generationError: string | null;
  @ApiProperty({ enum: GoalStatus }) status: GoalStatus;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
  @ApiPropertyOptional({ type: [GoalPlanItemResponseDto] }) planItems?: GoalPlanItemResponseDto[];
  @ApiPropertyOptional({ type: [GoalMilestoneResponseDto] }) milestones?: GoalMilestoneResponseDto[];
  @ApiPropertyOptional({ type: [GoalProgressLogResponseDto] }) progressLogs?: GoalProgressLogResponseDto[];
}

export class PaginatedGoalsResponseDto {
  @ApiProperty({ type: [GoalResponseDto] }) data: GoalResponseDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
  @ApiProperty() activeCount: number;
  @ApiProperty() cap: number;
}
```

**Step 2: Sanitizer (strips `rawLlmResponse` and coerces decimals)**

```typescript
// src/goals/goals.sanitizer.ts
import {
  Goal,
  GoalMilestone,
  GoalPlanItem,
  GoalProgressLog,
} from '@prisma/client';
import { GoalResponseDto } from './dto/goal-response.dto';

type FullGoal = Goal & {
  planItems?: GoalPlanItem[];
  milestones?: GoalMilestone[];
  progressLogs?: GoalProgressLog[];
};

const toNumber = (v: unknown) => (v == null ? null : Number(v));

export function sanitizeGoal(
  goal: FullGoal,
  options: { includeError?: boolean } = {},
): GoalResponseDto {
  const { rawLlmResponse: _raw, generationError, ...rest } = goal;
  return {
    ...rest,
    currentValue: Number(goal.currentValue),
    targetValue: Number(goal.targetValue),
    generationError: options.includeError ? generationError : null,
    planItems: goal.planItems?.map((p) => ({
      ...p,
      weight: toNumber(p.weight),
    })) as GoalResponseDto['planItems'],
    milestones: goal.milestones?.map((m) => ({
      ...m,
      targetValue: toNumber(m.targetValue),
    })) as GoalResponseDto['milestones'],
    progressLogs: goal.progressLogs?.map((l) => ({
      ...l,
      value: Number(l.value),
    })) as GoalResponseDto['progressLogs'],
  } as GoalResponseDto;
}
```

**Step 3: Typecheck + commit**

Run: `yarn typecheck`
Expected: PASS.

```bash
git add src/goals/dto/goal-response.dto.ts src/goals/goals.sanitizer.ts
git commit -m "feat(goals): add response DTOs and sanitizer that strips rawLlmResponse"
```

---

### Task 5.3: Failing test for `GoalsService.create` (cap + snapshot)

**Files:**
- Create: `src/goals/goals.service.spec.ts`

**Step 1: Write failing test**

```typescript
import { Test } from '@nestjs/testing';
import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BadRequestException } from '@nestjs/common';
import { GoalCategory, GoalMetric, GoalStatus, PrismaClient } from '@prisma/client';
import { GoalsService } from './goals.service';
import { PrismaService } from '../prisma/prisma.service';
import { AttendanceService } from '../attendance/attendance.service';
import { GymSettingsService } from '../gym-settings/gym-settings.service';

describe('GoalsService.create', () => {
  let service: GoalsService;
  let prisma: DeepMockProxy<PrismaClient>;
  const emitter = { emit: jest.fn() };
  const attendance = { getAvgDaysPerWeek: jest.fn() };
  const settings = {
    getCachedSettings: jest.fn().mockResolvedValue({ maxActiveGoalsPerMember: 3 }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        GoalsService,
        { provide: PrismaService, useValue: mockDeep<PrismaClient>() },
        { provide: EventEmitter2, useValue: emitter },
        { provide: AttendanceService, useValue: attendance },
        { provide: GymSettingsService, useValue: settings },
      ],
    }).compile();
    service = moduleRef.get(GoalsService);
    prisma = moduleRef.get(PrismaService);
    attendance.getAvgDaysPerWeek.mockResolvedValue(3);
  });

  const dto = {
    title: 'Bench 120kg',
    category: GoalCategory.STRENGTH,
    metric: GoalMetric.KG,
    currentValue: 80,
    targetValue: 120,
  };

  it('snapshots currentGymFrequency and inserts in GENERATING status', async () => {
    prisma.goal.count.mockResolvedValue(0);
    prisma.goal.create.mockResolvedValue({ id: 'g1' } as never);

    await service.create('m1', dto);

    expect(prisma.goal.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        memberId: 'm1',
        currentGymFrequency: 3,
        generationStatus: 'GENERATING',
        status: 'ACTIVE',
      }),
    });
    expect(emitter.emit).toHaveBeenCalledWith(
      'goal.generation.requested',
      expect.objectContaining({ goalId: 'g1' }),
    );
  });

  it('throws 400 when member is at the concurrent-goals cap', async () => {
    prisma.goal.count.mockResolvedValue(3);
    await expect(service.create('m1', dto)).rejects.toThrow(BadRequestException);
    expect(prisma.goal.create).not.toHaveBeenCalled();
  });

  it('counts only ACTIVE and PAUSED toward the cap', async () => {
    prisma.goal.count.mockResolvedValue(0);
    prisma.goal.create.mockResolvedValue({ id: 'g1' } as never);
    await service.create('m1', dto);
    expect(prisma.goal.count).toHaveBeenCalledWith({
      where: {
        memberId: 'm1',
        status: { in: [GoalStatus.ACTIVE, GoalStatus.PAUSED] },
      },
    });
  });
});
```

**Step 2: Confirm fail**

Run: `yarn test -- --testPathPattern=goals.service.spec`
Expected: FAIL — cannot find module.

---

### Task 5.4: Implement `GoalsService.create` + `list` + `findOne`

**Files:**
- Create: `src/goals/goals.service.ts`

**Step 1: Implement**

```typescript
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { GoalStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AttendanceService } from '../attendance/attendance.service';
import { GymSettingsService } from '../gym-settings/gym-settings.service';
import { CreateGoalDto } from './dto/create-goal.dto';
import { ListGoalsQueryDto } from './dto/list-goals-query.dto';
import { sanitizeGoal } from './goals.sanitizer';
import { UpdateGoalDto } from './dto/update-goal.dto';

const NON_TERMINAL = [GoalStatus.ACTIVE, GoalStatus.PAUSED];

const ALLOWED_TRANSITIONS: Record<GoalStatus, GoalStatus[]> = {
  ACTIVE: [GoalStatus.PAUSED, GoalStatus.ABANDONED, GoalStatus.COMPLETED],
  PAUSED: [GoalStatus.ACTIVE],
  COMPLETED: [],
  ABANDONED: [],
};

@Injectable()
export class GoalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly attendance: AttendanceService,
    private readonly settings: GymSettingsService,
  ) {}

  async create(memberId: string, dto: CreateGoalDto) {
    const settings = await this.settings.getCachedSettings();
    const cap = settings.maxActiveGoalsPerMember ?? 3;

    const active = await this.prisma.goal.count({
      where: { memberId, status: { in: NON_TERMINAL } },
    });
    if (active >= cap) {
      throw new BadRequestException(
        `You have ${active} active goals. Complete or abandon one to create another.`,
      );
    }

    const currentGymFrequency = await this.attendance.getAvgDaysPerWeek(
      memberId,
      4,
    );

    const goal = await this.prisma.goal.create({
      data: {
        memberId,
        title: dto.title,
        category: dto.category,
        metric: dto.metric,
        currentValue: new Prisma.Decimal(dto.currentValue),
        targetValue: new Prisma.Decimal(dto.targetValue),
        currentGymFrequency,
        userDeadline: dto.userDeadline ?? null,
        recommendedGymFrequency: dto.requestedFrequency ?? null,
        status: GoalStatus.ACTIVE,
        generationStatus: 'GENERATING',
      },
    });

    this.eventEmitter.emit('goal.generation.requested', {
      goalId: goal.id,
      memberId,
      requestedFrequency: dto.requestedFrequency ?? null,
    });

    return sanitizeGoal(goal);
  }

  async list(memberId: string, query: ListGoalsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.GoalWhereInput = {
      memberId,
      ...(query.status ? { status: query.status } : {}),
    };
    const [rows, total, activeCount, settings] = await Promise.all([
      this.prisma.goal.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.goal.count({ where }),
      this.prisma.goal.count({
        where: { memberId, status: { in: NON_TERMINAL } },
      }),
      this.settings.getCachedSettings(),
    ]);
    return {
      data: rows.map((g) => sanitizeGoal(g)),
      total,
      page,
      limit,
      activeCount,
      cap: settings.maxActiveGoalsPerMember ?? 3,
    };
  }

  async findOne(memberId: string, goalId: string) {
    const goal = await this.prisma.goal.findFirst({
      where: { id: goalId, memberId },
      include: {
        planItems: { orderBy: [{ weekNumber: 'asc' }, { dayLabel: 'asc' }] },
        milestones: { orderBy: { weekNumber: 'asc' } },
        progressLogs: { orderBy: { loggedAt: 'desc' }, take: 50 },
      },
    });
    if (!goal) throw new NotFoundException('Goal not found');
    return sanitizeGoal(goal, { includeError: true });
  }

  async update(memberId: string, goalId: string, dto: UpdateGoalDto) {
    const goal = await this.prisma.goal.findFirst({
      where: { id: goalId, memberId },
    });
    if (!goal) throw new NotFoundException('Goal not found');

    if (dto.status && dto.status !== goal.status) {
      const allowed = ALLOWED_TRANSITIONS[goal.status];
      if (!allowed.includes(dto.status)) {
        throw new BadRequestException(
          `Cannot transition from ${goal.status} to ${dto.status}`,
        );
      }
    }

    const updated = await this.prisma.goal.update({
      where: { id: goalId },
      data: { ...dto },
    });
    return sanitizeGoal(updated);
  }

  async remove(memberId: string, goalId: string) {
    const { count } = await this.prisma.goal.deleteMany({
      where: { id: goalId, memberId },
    });
    if (count === 0) throw new NotFoundException('Goal not found');
    return { deleted: true };
  }

  async assertOwnership(memberId: string, goalId: string) {
    const goal = await this.prisma.goal.findFirst({
      where: { id: goalId, memberId },
      select: { id: true },
    });
    if (!goal) throw new ForbiddenException('Access denied');
  }
}
```

**Step 2: Run the create tests**

Run: `yarn test -- --testPathPattern=goals.service.spec`
Expected: PASS (3 tests).

**Step 3: Commit**

```bash
git add src/goals/goals.service.ts src/goals/goals.service.spec.ts
git commit -m "feat(goals): add GoalsService with create, list, findOne, update, remove"
```

---

### Task 5.5: Extend spec — list/findOne/update/remove edge cases

**Files:**
- Modify: `src/goals/goals.service.spec.ts`

**Step 1: Append specs**

```typescript
describe('GoalsService.update', () => {
  // rejects COMPLETED → ACTIVE
  // rejects ABANDONED → ACTIVE
  // allows ACTIVE → PAUSED, PAUSED → ACTIVE, ACTIVE → ABANDONED, ACTIVE → COMPLETED
  // throws NotFound when goal not owned by user
});

describe('GoalsService.findOne', () => {
  // returns goal with planItems/milestones/progressLogs
  // strips rawLlmResponse
  // exposes generationError when includeError is true (owner only)
  // throws NotFound for another member's goal
});

describe('GoalsService.remove', () => {
  // deletes via deleteMany scoped by memberId (no cross-member delete)
});
```

Flesh each block with concrete assertions matching the service behavior. At minimum 8 additional tests.

**Step 2: Confirm pass**

Run: `yarn test -- --testPathPattern=goals.service.spec`
Expected: PASS.

**Step 3: Commit**

```bash
git add src/goals/goals.service.spec.ts
git commit -m "test(goals): cover list/findOne/update/remove edge cases"
```

---

### Task 5.6: `GoalsController` — core CRUD endpoints

**Files:**
- Create: `src/goals/goals.controller.ts`
- Create: `src/goals/goals.module.ts`
- Modify: `src/app.module.ts` (register module)

**Step 1: Controller**

```typescript
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ActiveSubscriptionGuard } from '../common/guards/active-subscription.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequiresFeature } from '../licensing/decorators/requires-feature.decorator';
import { GoalsService } from './goals.service';
import { CreateGoalDto } from './dto/create-goal.dto';
import { UpdateGoalDto } from './dto/update-goal.dto';
import { ListGoalsQueryDto } from './dto/list-goals-query.dto';
import {
  GoalResponseDto,
  PaginatedGoalsResponseDto,
} from './dto/goal-response.dto';

@ApiTags('goals')
@ApiBearerAuth()
@RequiresFeature('goals')
@UseGuards(JwtAuthGuard, ActiveSubscriptionGuard, RolesGuard)
@Controller('goals')
export class GoalsController {
  constructor(private readonly goals: GoalsService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 5, ttl: 60 * 60 * 1000 } })
  @ApiCreatedResponse({ type: GoalResponseDto })
  create(
    @CurrentUser() user: { id: string },
    @Body() dto: CreateGoalDto,
  ) {
    return this.goals.create(user.id, dto);
  }

  @Get()
  @ApiOkResponse({ type: PaginatedGoalsResponseDto })
  list(
    @CurrentUser() user: { id: string },
    @Query() query: ListGoalsQueryDto,
  ) {
    return this.goals.list(user.id, query);
  }

  @Get(':id')
  @ApiOkResponse({ type: GoalResponseDto })
  findOne(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
  ) {
    return this.goals.findOne(user.id, id);
  }

  @Patch(':id')
  @ApiOkResponse({ type: GoalResponseDto })
  update(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() dto: UpdateGoalDto,
  ) {
    return this.goals.update(user.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
  ) {
    return this.goals.remove(user.id, id);
  }
}
```

**Step 2: Module**

```typescript
// src/goals/goals.module.ts
import { Module } from '@nestjs/common';
import { GoalsService } from './goals.service';
import { GoalsController } from './goals.controller';
import { AttendanceModule } from '../attendance/attendance.module';
import { GymSettingsModule } from '../gym-settings/gym-settings.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { LlmModule } from '../llm/llm.module';

@Module({
  imports: [
    AttendanceModule,
    GymSettingsModule,
    SubscriptionsModule,
    NotificationsModule,
    LlmModule,
  ],
  controllers: [GoalsController],
  providers: [GoalsService],
  exports: [GoalsService],
})
export class GoalsModule {}
```

If `AttendanceModule` / `GymSettingsModule` / `SubscriptionsModule` / `NotificationsModule` do not already export the required service, **update those module files to add the service to `exports`** before continuing.

**Step 3: Register in AppModule**

In `src/app.module.ts`, add `GoalsModule` to the `imports` array alongside the other feature modules.

**Step 4: Full test + lint + typecheck**

Run: `yarn lint && yarn typecheck && yarn test`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/goals/goals.controller.ts src/goals/goals.module.ts src/app.module.ts
git commit -m "feat(goals): add GoalsController and GoalsModule with core CRUD"
```

---

## Phase 6 — Progress logs, plan items, milestones sub-endpoints

### Task 6.1: Service methods for progress logs (+ auto-complete milestones)

**Files:**
- Modify: `src/goals/goals.service.ts` (add methods)
- Modify: `src/goals/goals.service.spec.ts` (add tests)

**Step 1: Write failing tests**

Tests for `addProgressLog`, `removeProgressLog`. Cover:

- Persists log with `value`, `note`, `loggedAt`.
- Auto-completes incomplete milestones for growth goals when `value >= targetValue`.
- Auto-completes incomplete milestones for `WEIGHT_LOSS` when `value <= targetValue`.
- Does not re-complete already-complete milestones.
- `removeProgressLog` only removes logs owned by the member + goal.

**Step 2: Implement**

```typescript
// in GoalsService

async addProgressLog(memberId: string, goalId: string, dto: CreateProgressLogDto) {
  const goal = await this.prisma.goal.findFirst({
    where: { id: goalId, memberId },
    select: { id: true, category: true },
  });
  if (!goal) throw new NotFoundException('Goal not found');

  const log = await this.prisma.$transaction(async (tx) => {
    const created = await tx.goalProgressLog.create({
      data: {
        goalId,
        value: new Prisma.Decimal(dto.value),
        note: dto.note ?? null,
      },
    });

    const milestones = await tx.goalMilestone.findMany({
      where: { goalId, completed: false, targetValue: { not: null } },
    });
    const weightLoss = goal.category === 'WEIGHT_LOSS';
    const toComplete = milestones.filter((m) =>
      weightLoss
        ? Number(m.targetValue) >= dto.value
        : Number(m.targetValue) <= dto.value,
    );
    if (toComplete.length > 0) {
      await tx.goalMilestone.updateMany({
        where: { id: { in: toComplete.map((m) => m.id) } },
        data: { completed: true, completedAt: new Date() },
      });
    }

    return created;
  });

  return {
    id: log.id,
    value: Number(log.value),
    note: log.note,
    loggedAt: log.loggedAt,
  };
}

async removeProgressLog(memberId: string, goalId: string, logId: string) {
  await this.assertOwnership(memberId, goalId);
  const { count } = await this.prisma.goalProgressLog.deleteMany({
    where: { id: logId, goalId },
  });
  if (count === 0) throw new NotFoundException('Progress log not found');
  return { deleted: true };
}
```

**Step 3: Run tests, commit**

Run: `yarn test -- --testPathPattern=goals.service.spec`
Expected: PASS.

```bash
git add src/goals
git commit -m "feat(goals): add progress logs with auto-completing milestones"
```

---

### Task 6.2: Service methods for plan items + milestones CRUD

**Files:**
- Modify: `src/goals/goals.service.ts` (add CRUD for plan items and milestones)
- Modify: `src/goals/goals.service.spec.ts` (add tests)

**Step 1: Write failing tests**

Test coverage:

- `addPlanItem` — creates row scoped to goal owned by member.
- `updatePlanItem` — sets `completedAt=now()` when `completed=true`, nulls when `false`, updates other fields.
- `removePlanItem` — deletes scoped by goal+member.
- Same three for milestones.
- All throw `NotFound` when goal is not owned.

**Step 2: Implement** (repetitive pattern — see design doc section 2 for shape).

Key: always call `this.assertOwnership(memberId, goalId)` first, then scope the child write by `goalId`.

**Step 3: Run tests, commit**

```bash
git add src/goals
git commit -m "feat(goals): add plan item and milestone CRUD"
```

---

### Task 6.3: Extend controller with sub-resource endpoints

**Files:**
- Modify: `src/goals/goals.controller.ts`

Add:

- `POST /goals/:id/progress`
- `DELETE /goals/:id/progress/:logId`
- `POST /goals/:id/plan-items`
- `PATCH /goals/:id/plan-items/:itemId`
- `DELETE /goals/:id/plan-items/:itemId`
- `POST /goals/:id/milestones`
- `PATCH /goals/:id/milestones/:milestoneId`
- `DELETE /goals/:id/milestones/:milestoneId`

Each delegates to the service method. Use correct DTOs + `@ApiOkResponse`/`@ApiCreatedResponse`.

**Step 1: Add endpoints.**
**Step 2: Lint + typecheck + test.**
**Step 3: Commit.**

```bash
git add src/goals/goals.controller.ts
git commit -m "feat(goals): expose progress/plan-item/milestone sub-endpoints"
```

---

## Phase 7 — Async AI generation

### Task 7.1: LLM response validation DTO

**Files:**
- Create: `src/goals/dto/llm-plan-response.dto.ts`

**Step 1: Implement**

```typescript
import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class LlmMilestoneDto {
  @IsInt() @Min(1) weekNumber: number;
  @IsString() @MaxLength(200) description: string;
  @IsOptional() @IsNumber() @Min(0) targetValue?: number | null;
}

export class LlmPlanItemDto {
  @IsInt() @Min(1) weekNumber: number;
  @IsString() @MaxLength(20) dayLabel: string;
  @IsString() @MaxLength(200) description: string;
  @IsOptional() @IsInt() @Min(0) @Max(99) sets?: number | null;
  @IsOptional() @IsInt() @Min(0) @Max(999) reps?: number | null;
  @IsOptional() @IsNumber() @Min(0) @Max(2000) weight?: number | null;
  @IsOptional() @IsInt() @Min(0) @Max(600) duration?: number | null;
}

export class LlmPlanResponseDto {
  @IsInt() @Min(1) @Max(7) recommendedGymFrequency: number;
  @IsInt() @Min(1) @Max(52) estimatedWeeks: number;
  @IsString() @MaxLength(2000) reasoning: string;

  @IsArray() @ValidateNested({ each: true }) @Type(() => LlmMilestoneDto)
  milestones: LlmMilestoneDto[];

  @IsArray() @ValidateNested({ each: true }) @Type(() => LlmPlanItemDto)
  plan: LlmPlanItemDto[];
}
```

**Step 2: Commit**

```bash
git add src/goals/dto/llm-plan-response.dto.ts
git commit -m "feat(goals): add LLM response validation DTO"
```

---

### Task 7.2: Prompt builder

**Files:**
- Create: `src/goals/goal-prompt.builder.ts`
- Create: `src/goals/goal-prompt.builder.spec.ts`

**Step 1: Failing test**

```typescript
import { buildGoalPrompt } from './goal-prompt.builder';

describe('buildGoalPrompt', () => {
  const base = {
    title: 'Bench 120kg',
    category: 'STRENGTH' as const,
    metric: 'KG' as const,
    currentValue: 80,
    targetValue: 120,
    currentGymFrequency: 3,
    weeklyStreak: 2,
    longestStreak: 6,
  };

  it('includes all member context fields', () => {
    const out = buildGoalPrompt({ ...base, requestedFrequency: null });
    expect(out).toContain('Bench 120kg');
    expect(out).toContain('STRENGTH');
    expect(out).toContain('80 KG');
    expect(out).toContain('120 KG');
    expect(out).toContain('3 days/week');
    expect(out).toContain('2 weeks');
    expect(out).toContain('6 weeks');
    expect(out).toContain('not specified');
  });

  it('inlines the requested frequency when provided', () => {
    const out = buildGoalPrompt({ ...base, requestedFrequency: 5 });
    expect(out).toContain('Desired frequency: 5');
  });
});
```

**Step 2: Implement**

```typescript
// src/goals/goal-prompt.builder.ts
export type GoalPromptInput = {
  title: string;
  category: string;
  metric: string;
  currentValue: number;
  targetValue: number;
  currentGymFrequency: number;
  weeklyStreak: number;
  longestStreak: number;
  requestedFrequency: number | null;
};

export const buildGoalPrompt = (input: GoalPromptInput): string => `
A gym member wants to achieve the following goal:
- Goal: ${input.title}
- Category: ${input.category}
- Metric: ${input.metric}
- Current value: ${input.currentValue} ${input.metric}
- Target value: ${input.targetValue} ${input.metric}
- Current gym attendance: ${input.currentGymFrequency} days/week
- Current weekly streak: ${input.weeklyStreak} weeks
- Longest streak ever: ${input.longestStreak} weeks
- Desired frequency: ${input.requestedFrequency ?? 'not specified — recommend one'}

Return ONLY valid JSON in this shape:
{
  "recommendedGymFrequency": <integer 1-7>,
  "estimatedWeeks": <integer 1-52>,
  "reasoning": "<2-3 sentences explaining timeline and frequency>",
  "milestones": [
    { "weekNumber": <integer>, "description": "<string>", "targetValue": <number or null> }
  ],
  "plan": [
    {
      "weekNumber": <integer>,
      "dayLabel": "<e.g. Monday>",
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
- Each week has exactly recommendedGymFrequency plan items.
- Milestones every 2-4 weeks as checkpoints.
- Progressive overload for strength goals.
- For CONSISTENCY with metric DAYS_PER_WEEK, plan items are general gym sessions.
- Keep descriptions concise and actionable.
- If requestedFrequency is specified, use it as recommendedGymFrequency.
`.trim();
```

**Step 3: Run tests + commit**

Run: `yarn test -- --testPathPattern=goal-prompt.builder`
Expected: PASS.

```bash
git add src/goals/goal-prompt.builder.ts src/goals/goal-prompt.builder.spec.ts
git commit -m "feat(goals): add prompt builder for LLM plan generation"
```

---

### Task 7.3: Background listener — success path

**Files:**
- Create: `src/goals/listeners/goal-generation.listener.ts`
- Create: `src/goals/listeners/goal-generation.listener.spec.ts`
- Modify: `src/goals/goals.module.ts` (register listener)

**Step 1: Failing test — success path**

Assert:

- On `goal.generation.requested`, fetches the goal + member's `Streak`.
- Calls `LlmService.generatePlan` with the built prompt.
- Validates the response against `LlmPlanResponseDto`.
- Transactionally creates `planItems` + `milestones`, updates the goal to `READY` with `aiReasoning`, `recommendedGymFrequency`, `aiEstimatedDeadline`, `rawLlmResponse`.
- Emits `goal.plan.ready` with `{ goalId, memberId, title }`.

**Step 2: Implement**

```typescript
// src/goals/listeners/goal-generation.listener.ts
import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LlmService } from '../../llm/llm.service';
import { buildGoalPrompt } from '../goal-prompt.builder';
import { LlmPlanResponseDto } from '../dto/llm-plan-response.dto';

type Payload = {
  goalId: string;
  memberId: string;
  requestedFrequency: number | null;
};

@Injectable()
export class GoalGenerationListener {
  private readonly logger = new Logger(GoalGenerationListener.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @OnEvent('goal.generation.requested', { async: true })
  async handle(payload: Payload) {
    try {
      await this.generate(payload);
    } catch (err) {
      this.logger.error(
        `Goal generation failed for ${payload.goalId}`,
        err as Error,
      );
      await this.markFailed(payload.goalId, err as Error);
      this.eventEmitter.emit('goal.plan.failed', payload);
    }
  }

  private async generate(payload: Payload) {
    const goal = await this.prisma.goal.findUniqueOrThrow({
      where: { id: payload.goalId },
      include: { member: { include: { streak: true } } },
    });

    const prompt = buildGoalPrompt({
      title: goal.title,
      category: goal.category,
      metric: goal.metric,
      currentValue: Number(goal.currentValue),
      targetValue: Number(goal.targetValue),
      currentGymFrequency: goal.currentGymFrequency,
      weeklyStreak: goal.member.streak?.weeklyStreak ?? 0,
      longestStreak: goal.member.streak?.longestStreak ?? 0,
      requestedFrequency: payload.requestedFrequency,
    });

    const raw = await this.llm.generatePlan(prompt);

    const dto = plainToInstance(LlmPlanResponseDto, raw, {
      enableImplicitConversion: true,
    });
    const errors = await validate(dto, { whitelist: true });
    if (errors.length > 0) {
      throw new Error(`LLM response failed validation: ${JSON.stringify(errors)}`);
    }

    const deadline = new Date(goal.createdAt);
    deadline.setUTCDate(deadline.getUTCDate() + dto.estimatedWeeks * 7);

    await this.prisma.$transaction(async (tx) => {
      if (dto.plan.length > 0) {
        await tx.goalPlanItem.createMany({
          data: dto.plan.map((p) => ({
            goalId: goal.id,
            weekNumber: p.weekNumber,
            dayLabel: p.dayLabel,
            description: p.description,
            sets: p.sets ?? null,
            reps: p.reps ?? null,
            weight: p.weight != null ? new Prisma.Decimal(p.weight) : null,
            duration: p.duration ?? null,
          })),
        });
      }
      if (dto.milestones.length > 0) {
        await tx.goalMilestone.createMany({
          data: dto.milestones.map((m) => ({
            goalId: goal.id,
            weekNumber: m.weekNumber,
            description: m.description,
            targetValue:
              m.targetValue != null ? new Prisma.Decimal(m.targetValue) : null,
          })),
        });
      }
      await tx.goal.update({
        where: { id: goal.id },
        data: {
          recommendedGymFrequency: dto.recommendedGymFrequency,
          aiReasoning: dto.reasoning,
          aiEstimatedDeadline: deadline,
          rawLlmResponse: raw as Prisma.InputJsonValue,
          generationStatus: 'READY',
          generationError: null,
        },
      });
    });

    this.eventEmitter.emit('goal.plan.ready', {
      goalId: goal.id,
      memberId: goal.memberId,
      title: goal.title,
    });
  }

  private async markFailed(goalId: string, err: Error) {
    await this.prisma.goal.update({
      where: { id: goalId },
      data: {
        generationStatus: 'FAILED',
        generationError: err.message.slice(0, 1000),
      },
    });
  }
}
```

**Step 3: Register in module**

In `src/goals/goals.module.ts`, add the listener to `providers`.

**Step 4: Failing test — failure path**

Extend the spec to cover:

- LLM throws → goal goes to `FAILED` with `generationError` set, `goal.plan.failed` emitted.
- Validation error → same.
- No duplicate plan items if event fires twice (idempotency).

For idempotency: add a unique index or check-before-insert — simplest is to reject replays when `generationStatus !== 'GENERATING'` at the top of `generate`.

Add guard:

```typescript
if (goal.generationStatus !== 'GENERATING') {
  this.logger.warn(`Ignoring duplicate generation request for ${goal.id}`);
  return;
}
```

**Step 5: Run tests, commit**

```bash
git add src/goals
git commit -m "feat(goals): add background listener for async plan generation"
```

---

### Task 7.4: Push notifications for `ready` and `failed`

**Files:**
- Create: `src/goals/listeners/goal-notifications.listener.ts`
- Create: `src/goals/listeners/goal-notifications.listener.spec.ts`
- Modify: `src/goals/goals.module.ts`

**Step 1: Failing test**

Listener should call `NotificationsService.create` with the right shape for each of the three events: `goal.plan.ready`, `goal.plan.failed`, and `goal.weekly.pulse` (weekly cron emits this — covered in phase 8).

**Step 2: Implement**

```typescript
import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationType } from '@prisma/client';
import { NotificationsService } from '../../notifications/notifications.service';

@Injectable()
export class GoalNotificationsListener {
  constructor(private readonly notifications: NotificationsService) {}

  @OnEvent('goal.plan.ready', { async: true })
  async handleReady(payload: { memberId: string; goalId: string; title: string }) {
    await this.notifications.create({
      userId: payload.memberId,
      title: 'Your plan is ready',
      body: `Your ${payload.title} plan is ready — open to view.`,
      type: NotificationType.GOAL_PLAN_READY,
      metadata: { goalId: payload.goalId },
    });
  }

  @OnEvent('goal.plan.failed', { async: true })
  async handleFailed(payload: { memberId: string; goalId: string }) {
    await this.notifications.create({
      userId: payload.memberId,
      title: 'Plan generation failed',
      body: `We couldn't generate your plan. Tap to retry.`,
      type: NotificationType.GOAL_PLAN_FAILED,
      metadata: { goalId: payload.goalId },
    });
  }
}
```

**Step 3: Register listener, run tests, commit**

```bash
git add src/goals
git commit -m "feat(goals): push notifications on plan ready and failed"
```

---

### Task 7.5: Retry endpoint

**Files:**
- Modify: `src/goals/goals.service.ts`
- Modify: `src/goals/goals.controller.ts`
- Modify: `src/goals/goals.service.spec.ts`

**Step 1: Failing test**

- Retry allowed only when `generationStatus = FAILED`.
- Sets status back to `GENERATING`, nulls `generationError`, bumps `generationStartedAt`.
- Re-emits `goal.generation.requested` with the same payload shape.
- Throws `BadRequest` otherwise.

**Step 2: Service method**

```typescript
async retryGeneration(memberId: string, goalId: string) {
  const goal = await this.prisma.goal.findFirst({
    where: { id: goalId, memberId },
  });
  if (!goal) throw new NotFoundException('Goal not found');
  if (goal.generationStatus !== 'FAILED') {
    throw new BadRequestException('Only FAILED goals can be retried');
  }
  const updated = await this.prisma.goal.update({
    where: { id: goal.id },
    data: {
      generationStatus: 'GENERATING',
      generationError: null,
      generationStartedAt: new Date(),
    },
  });
  this.eventEmitter.emit('goal.generation.requested', {
    goalId: goal.id,
    memberId,
    requestedFrequency: goal.recommendedGymFrequency ?? null,
  });
  return sanitizeGoal(updated, { includeError: true });
}
```

**Step 3: Controller route**

```typescript
@Post(':id/retry-generation')
@HttpCode(HttpStatus.ACCEPTED)
@Throttle({ default: { limit: 5, ttl: 60 * 60 * 1000 } })
retry(@CurrentUser() user: { id: string }, @Param('id') id: string) {
  return this.goals.retryGeneration(user.id, id);
}
```

**Step 4: Lint + typecheck + test + commit**

```bash
git add src/goals
git commit -m "feat(goals): add retry-generation endpoint for FAILED goals"
```

---

## Phase 8 — Crons

### Task 8.1: Stale generation sweeper

**Files:**
- Create: `src/goals/goals.cron.ts`
- Create: `src/goals/goals.cron.spec.ts`
- Modify: `src/goals/goals.module.ts` (register cron class)

**Step 1: Failing test**

```typescript
describe('GoalsCron.sweepStaleGenerations', () => {
  it('flips GENERATING goals older than 10 min to FAILED and emits event', async () => {
    prisma.goal.findMany.mockResolvedValue([{ id: 'g1', memberId: 'm1' }] as never);
    prisma.goal.updateMany.mockResolvedValue({ count: 1 } as never);
    await cron.sweepStaleGenerations();
    expect(prisma.goal.findMany).toHaveBeenCalledWith({
      where: {
        generationStatus: 'GENERATING',
        generationStartedAt: { lt: expect.any(Date) },
      },
      select: { id: true, memberId: true },
    });
    expect(emitter.emit).toHaveBeenCalledWith('goal.plan.failed', {
      goalId: 'g1',
      memberId: 'm1',
    });
  });
});
```

**Step 2: Implement**

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '@prisma/client';

@Injectable()
export class GoalsCron {
  private readonly logger = new Logger(GoalsCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES, { timeZone: 'Africa/Nairobi' })
  async sweepStaleGenerations() {
    const cutoff = new Date(Date.now() - 10 * 60 * 1000);
    const stale = await this.prisma.goal.findMany({
      where: {
        generationStatus: 'GENERATING',
        generationStartedAt: { lt: cutoff },
      },
      select: { id: true, memberId: true },
    });
    if (stale.length === 0) return;

    await this.prisma.goal.updateMany({
      where: { id: { in: stale.map((g) => g.id) } },
      data: {
        generationStatus: 'FAILED',
        generationError: 'Generation timed out',
      },
    });

    for (const g of stale) {
      this.eventEmitter.emit('goal.plan.failed', {
        goalId: g.id,
        memberId: g.memberId,
      });
    }
    this.logger.log(`Swept ${stale.length} stale goal generations`);
  }
}
```

**Step 3: Register + tests + commit**

```bash
git add src/goals/goals.cron.ts src/goals/goals.cron.spec.ts src/goals/goals.module.ts
git commit -m "feat(goals): add stale generation sweeper cron"
```

---

### Task 8.2: Weekly motivation push

**Files:**
- Modify: `src/goals/goals.cron.ts`
- Modify: `src/goals/goals.cron.spec.ts`

**Step 1: Failing test**

- Fetches active goals grouped by memberId.
- For a member with 3 active goals, sends exactly 1 push.
- Push type is `GOAL_WEEKLY_PULSE`, metadata includes array of goal ids.
- Member with 1 goal gets body without "other goals" tail.

**Step 2: Implement (abbreviated — flesh out per design doc § Crons.2)**

```typescript
@Cron('0 9 * * 1', { timeZone: 'Africa/Nairobi' })
async sendWeeklyMotivation() {
  const activeGoals = await this.prisma.goal.findMany({
    where: { status: 'ACTIVE', generationStatus: 'READY' },
    include: {
      milestones: { where: { completed: false }, orderBy: { weekNumber: 'asc' }, take: 1 },
      progressLogs: { orderBy: { loggedAt: 'desc' }, take: 1 },
    },
  });
  const byMember = new Map<string, typeof activeGoals>();
  for (const g of activeGoals) {
    if (!byMember.has(g.memberId)) byMember.set(g.memberId, []);
    byMember.get(g.memberId)!.push(g);
  }

  for (const [memberId, goals] of byMember) {
    const { title, body, goalIds } = this.buildWeeklySummary(goals);
    await this.notifications.create({
      userId: memberId,
      title,
      body,
      type: NotificationType.GOAL_WEEKLY_PULSE,
      metadata: { goalIds },
    });
  }
  this.logger.log(`Sent weekly pulse to ${byMember.size} members`);
}

private buildWeeklySummary(goals: /* inferred */ any[]) {
  // Pick a "lead" goal based on priority: celebrating > behind > no-progress > on-track.
  // Compose `body` as "{lead line}. N other goal(s) want your attention."
  // Return title, body, goalIds.
  // Concrete implementation — see design doc § Crons.2 for tone tiers.
}
```

**Step 3: Commit**

```bash
git add src/goals/goals.cron.ts src/goals/goals.cron.spec.ts
git commit -m "feat(goals): add weekly motivation push cron"
```

---

### Task 8.3: Abandoned goal cleanup

**Files:**
- Modify: `src/goals/goals.cron.ts`
- Modify: `src/goals/goals.cron.spec.ts`

**Step 1: Failing test**

Cron deletes goals where `status=ABANDONED` AND `updatedAt < now() - 90 days`. Does not delete `COMPLETED` or recently abandoned goals.

**Step 2: Implement**

```typescript
@Cron('0 3 * * 0', { timeZone: 'Africa/Nairobi' })
async cleanupAbandoned() {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - 90);
  const { count } = await this.prisma.goal.deleteMany({
    where: { status: 'ABANDONED', updatedAt: { lt: cutoff } },
  });
  this.logger.log(`Deleted ${count} abandoned goals older than 90 days`);
}
```

**Step 3: Commit**

```bash
git add src/goals/goals.cron.ts src/goals/goals.cron.spec.ts
git commit -m "feat(goals): add abandoned-goal cleanup cron"
```

---

## Phase 9 — Integration & docs

### Task 9.1: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Add a new bullet to the "Modules" list** describing `goals/` (1 paragraph, matching the existing style). Place between `member-tags/` and the closing modules block.

**Step 2: Extend the "Gated modules" line** (`CLAUDE.md:56`) — add `goals` to the comma-separated list.

**Step 3: Add env vars to the Environment Variables list:**

```text
- `ANTHROPIC_API_KEY` — Anthropic API key for Claude (required when `goals` feature is licensed)
- `LLM_MODEL` — Model id (defaults to `claude-sonnet-4-6`)
- `LLM_MAX_TOKENS` — Max tokens (defaults to 4096)
- `LLM_TIMEOUT_MS` — Request timeout (defaults to 60000)
```

**Step 4: Add a new line to GymSettings description** mentioning `maxActiveGoalsPerMember`.

**Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude-md): document goals module"
```

---

### Task 9.2: Seed sample goal data for dev/manual testing

**Files:**
- Modify: `prisma/seed.ts`

**Step 1:** Add to the seed script: after the super-admin is created, also create a member user + active subscription + 4 weeks of attendance records so a developer can hit `POST /goals` end-to-end in dev.

**Step 2:** Run `npx prisma db seed` to verify it works locally.

**Step 3:** Commit.

```bash
git add prisma/seed.ts
git commit -m "chore(seed): add sample member + subscription + attendance for goals testing"
```

---

### Task 9.3: Manual e2e smoke

**Step 1:** With `ANTHROPIC_API_KEY` set in `.env`, run `yarn start:dev`.

**Step 2:** Obtain a JWT for the seeded member via `POST /api/v1/auth/login`.

**Step 3:** `POST /api/v1/goals` with a sample body — confirm 202 + `generationStatus: GENERATING`.

**Step 4:** Wait 10-30s. `GET /api/v1/goals/:id` — confirm `generationStatus: READY`, plan items and milestones populated, `aiEstimatedDeadline` set, `rawLlmResponse` NOT in response.

**Step 5:** Verify `Notification` row created with type `GOAL_PLAN_READY` (query DB directly).

**Step 6:** Set invalid model id, repeat — expect `FAILED` and a `GOAL_PLAN_FAILED` notification. Hit `POST /api/v1/goals/:id/retry-generation` — confirm retry.

**Step 7:** Try creating a 4th goal — expect 400 with cap message.

**Step 8:** Cancel the member's subscription via DB update, retry `POST /goals` — expect 403 `"Active subscription required"`.

No commit — this is a verification gate.

---

### Task 9.4: Final test + lint + typecheck sweep

**Step 1:** Run `yarn lint && yarn typecheck && yarn test`. Everything must pass. New test count should be at least `+25` from baseline.

**Step 2:** If anything fails, fix and commit separately (do not amend).

---

### Task 9.5: Push + open PR

**Step 1:** `git push origin dev` (or a dedicated `feat/goals` branch if preferred — ask the user first).

**Step 2:** Open a PR against `main` with the summary from the design doc and a test-plan checklist that mirrors the manual e2e in Task 9.3.

---

## Risks / things to watch during execution

- **Prisma migration against NotificationType enum**: extending a Postgres enum is generally safe but requires `ALTER TYPE … ADD VALUE`. Prisma handles it, but double-check the generated SQL.
- **Decimal arithmetic**: comparing `Prisma.Decimal` to JS numbers is lossy. Always wrap values with `Number()` before comparison or use `.eq()` / `.lte()` / `.gte()` helpers.
- **LLM cost**: every `POST /goals` is one real Claude call in dev. Use a test key with spend limits. Don't leave the stale-generation sweeper at `*/5` while iterating on listener logic — it will mark your in-flight runs FAILED and waste tokens. Temporarily bump the window or disable it.
- **Circular imports**: `GoalsModule` imports `SubscriptionsModule` (for `ActiveSubscriptionGuard`). `SubscriptionsModule` should not import `GoalsModule`. If it already imports something that pulls `GoalsModule`, break the cycle with `forwardRef`.
- **EventEmitter2 async listeners**: remember `@OnEvent(..., { async: true })`. Without it, errors inside the listener can crash the request thread.
