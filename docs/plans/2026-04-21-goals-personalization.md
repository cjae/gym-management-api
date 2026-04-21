# Goals Personalization Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Raise the quality of AI-generated goal plans by feeding the LLM richer per-member context — both new onboarding fields collected from the member and existing signals derived from the database. After this change the prompt should reflect who the member actually is (experience, body, schedule, sleep, motivation, injuries) and what the system already knows about them (recent attendance, subscription constraints, prior goal history).

**Architecture:** Additive — extends `User` with personalization columns, adds an onboarding endpoint under `auth/`, enriches `buildGoalPrompt` inputs, and widens the `GoalGenerationListener` to gather derived context. No breaking changes; existing goals keep working and existing members back-fill via an onboarding flow on next app open.

**Tech Stack:** NestJS 11, Prisma 6, PostgreSQL, `class-validator`, Jest + `jest-mock-extended`.

**Source discussion:** conversation on 2026-04-21 (scope pivoted from prior `always kg` fix to full personalization).

**Conventions to follow:**

- TDD: write the failing test first, confirm it fails, implement, confirm it passes, commit.
- Run `yarn lint && yarn typecheck && yarn test` before every commit.
- Strip sensitive fields from responses; update Swagger decorators when endpoints change.
- Africa/Nairobi timezone for anything date-derived.
- Never reference `process.env` in services — always via typed `ConfigService` factories.
- `metric` and `birthday` remain immutable post-creation; everything else here is editable via profile update.

**Open product decision (resolved in-plan):** Members with a `TrainerAssignment` keep AI goal generation — the prompt is told "member has a personal trainer assigned" so the LLM can word the plan as complementary guidance rather than a prescription. No gating.

---

## Phase 0 — Baseline

### Task 0.1: Confirm clean tree and passing tests

**Step 1:** `git status` — branch `dev`, clean tree.
**Step 2:** `yarn lint && yarn typecheck && yarn test` — all pass. Record baseline test count.

No commit.

---

## Phase 1 — Schema: personalization columns on `User`

### Task 1.1: Add enums and columns to `prisma/schema.prisma`

**Files:**
- Edit: `prisma/schema.prisma`

**Step 1:** Add two new enums near the other User-related enums:

```prisma
enum ExperienceLevel {
  BEGINNER
  INTERMEDIATE
  ADVANCED
}

enum PrimaryMotivation {
  APPEARANCE
  STRENGTH
  HEALTH
  SPORT_PERFORMANCE
  EVENT_SPECIFIC
  OTHER
}
```

**Step 2:** Extend `model User` with (all nullable for back-fill):

```prisma
  experienceLevel       ExperienceLevel?
  bodyweightKg          Decimal?           @db.Decimal(5, 2)
  heightCm              Int?
  sessionMinutes        Int?
  preferredTrainingDays String[]           @default([])
  sleepHoursAvg         Decimal?           @db.Decimal(3, 1)
  primaryMotivation     PrimaryMotivation?
  injuryNotes           String?            @db.VarChar(500)
  onboardingCompletedAt DateTime?
```

`preferredTrainingDays` stores uppercase weekday codes (`MON`, `TUE`, …, `SUN`) — we will enforce the vocabulary in the DTO validator.

**Step 3:** Generate the migration:

```bash
npx prisma migrate dev --name add-user-personalization
npx prisma generate
```

**Step 4:** `yarn typecheck` — must pass.

**Step 5:** Commit:

```
feat(users): add personalization columns for AI goal generation
```

---

## Phase 2 — DTOs & onboarding endpoint

### Task 2.1: Write failing test for `OnboardingDto` validator

**Files:**
- Create: `src/auth/dto/onboarding.dto.spec.ts`

Test cases:
- Rejects when any required core field missing (`experienceLevel`, `bodyweightKg`, `heightCm`, `sessionMinutes`, `preferredTrainingDays`, `sleepHoursAvg`, `primaryMotivation`).
- Rejects `preferredTrainingDays` with an unknown code (`"FUNDAY"`).
- Rejects `bodyweightKg` < 20 or > 400, `heightCm` < 100 or > 250, `sessionMinutes` < 15 or > 240, `sleepHoursAvg` < 0 or > 24.
- Accepts `injuryNotes` up to 500 chars; rejects over.
- Accepts valid payload.

Run — fails (file doesn't exist).

### Task 2.2: Implement `OnboardingDto`

**Files:**
- Create: `src/auth/dto/onboarding.dto.ts`

Decorators: `@IsEnum`, `@IsNumber`, `@Min`, `@Max`, `@IsArray`, `@ArrayUnique`, `@IsIn`, `@IsString`, `@MaxLength`, `@IsOptional`. Use `@Type(() => Number)` on numeric fields for transform compatibility.

Run — tests pass. Commit:

```
feat(auth): add OnboardingDto for member personalization capture
```

### Task 2.3: Extend `UpdateMeDto` with the same fields (all optional)

**Files:**
- Edit: `src/auth/dto/update-me.dto.ts` (or equivalent — locate the existing `PATCH /auth/me` DTO first)
- Edit: spec file — add test that each new field validates with the same bounds as `OnboardingDto`

Commit:

```
feat(auth): allow profile updates to modify personalization fields
```

### Task 2.4: Write failing test for `AuthService.completeOnboarding`

**Files:**
- Edit: `src/auth/auth.service.spec.ts`

Test cases:
- Stamps `onboardingCompletedAt = now` and persists all fields.
- Rejects (BadRequest) when `onboardingCompletedAt` is already set — call `updateMe` instead.
- Sanitizes `injuryNotes` (newlines/tabs collapsed to spaces — reuse pattern from `goal-prompt.builder.ts::sanitizeText` or extract to `src/common/utils/sanitize-text.ts`).

### Task 2.5: Implement `completeOnboarding`

**Files:**
- Edit: `src/auth/auth.service.ts`
- Edit: `src/auth/auth.controller.ts` — add `POST /auth/me/onboarding` guarded by `JwtAuthGuard` only (no role/feature gate; any authenticated user).
- Add `@ApiTags('Auth')`, `@ApiBearerAuth()`, `@ApiOperation`, `@ApiResponse` decorators.

Also: extend `GET /auth/me` response to include the personalization fields plus a computed `onboardingCompleted: boolean` (true iff `onboardingCompletedAt` is set). Update the matching response DTO (`AuthMeResponseDto` or equivalent) with `@ApiProperty`/`@ApiPropertyOptional`.

Run — tests pass. Commit:

```
feat(auth): POST /auth/me/onboarding captures personalization data
```

### Task 2.6: Extract shared `sanitizeText` utility

**Files:**
- Create: `src/common/utils/sanitize-text.ts` — moves the regex from `goal-prompt.builder.ts`.
- Edit: `src/goals/goal-prompt.builder.ts` — import the shared util.
- Edit: `src/auth/auth.service.ts` — use it on `injuryNotes` before persist.
- Add: `sanitize-text.spec.ts` with round-trip tests (strips `\r`, `\n`, `\t`; trims; preserves regular spacing).

Commit:

```
refactor(common): extract sanitizeText util for shared use
```

---

## Phase 3 — Gate first-goal creation on onboarding

### Task 3.1: Write failing test in `goals.service.spec.ts`

Test case: `createGoal` throws `BadRequestException('Complete onboarding before creating a goal')` when the acting member has `onboardingCompletedAt === null`.

### Task 3.2: Implement the gate

**Files:**
- Edit: `src/goals/goals.service.ts` — in `createGoal`, after loading the member, check `onboardingCompletedAt`. Throw `BadRequestException` if null.
- Edit: `src/goals/goals.controller.ts` — add `@ApiResponse({ status: 400, description: 'Onboarding not completed' })`.

Also update the existing `CreateGoalDto` Swagger description to mention the prerequisite.

Run — tests pass. Commit:

```
feat(goals): require onboarding completion before creating a goal
```

---

## Phase 4 — Prompt builder: accept onboarding fields

### Task 4.1: Extend `GoalPromptInput` type

**Files:**
- Edit: `src/goals/goal-prompt.builder.ts`

Add to the input type (all optional-with-fallback so partial data still produces a valid prompt):

```ts
experienceLevel: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED' | null;
bodyweightKg: number | null;
heightCm: number | null;
sessionMinutes: number | null;
preferredTrainingDays: string[]; // empty array when unset
sleepHoursAvg: number | null;
primaryMotivation: string | null;
injuryNotes: string | null;
ageYears: number | null;         // derived from birthday in listener
sex: string | null;              // derived from gender in listener
memberTenureMonths: number | null; // derived from createdAt in listener
hasPersonalTrainer: boolean;
```

### Task 4.2: Update the prompt body

Render a **Member profile** block above the existing goal block, with `not specified` fallbacks so missing fields never break the prompt:

```
Member profile:
- Age: 28 years
- Sex: FEMALE
- Experience: INTERMEDIATE
- Bodyweight: 64 kg
- Height: 168 cm
- Typical session length: 45 minutes
- Preferred training days: TUE, THU, SAT
- Average sleep: 7.0 hours/night
- Primary motivation: HEALTH
- Injury notes: mild lower-back pain, avoid heavy deadlifts
- Member for: 14 months
- Working with a personal trainer: yes (plans should complement trainer guidance, not replace it)
```

Add corresponding rules:

- `Schedule training days on the member's preferred days when provided. Distribute across the week; don't cluster 3 days back-to-back.`
- `Scale starting loads to bodyweight when BEGINNER (e.g. squat 0.5-0.8x BW, bench 0.4-0.6x BW). Adjust for INTERMEDIATE/ADVANCED using historical progression.`
- `If injury notes mention a specific region or movement, substitute safer variants and note the reason in that exercise's notes field.`
- `Cap daily session duration at the member's sessionMinutes. Reduce exercise count or trim rest if needed.`
- `If primary motivation is APPEARANCE/BODY_COMPOSITION, bias toward hypertrophy rep ranges (8-12). If STRENGTH, bias toward 3-6. If HEALTH, mix modalities. If SPORT_PERFORMANCE, include power and conditioning. If EVENT_SPECIFIC, tighten timeline and increase specificity.`
- `If the member has a personal trainer, write the reasoning field so the plan reads as a complement — e.g. "discuss with your trainer before adjusting."`

### Task 4.3: Update builder tests

**Files:**
- Edit: `src/goals/goal-prompt.builder.spec.ts`

Extend `base` with default null/empty values for every new field. Add focused tests for each signal:

- Age rendered when `ageYears` provided; `not specified` when null.
- `BEGINNER` + `bodyweightKg` triggers bodyweight-scaling language.
- `preferredTrainingDays` list appears verbatim and uppercase.
- `injuryNotes` rendered and pre-sanitized (no raw `\n`).
- `hasPersonalTrainer: true` injects complementary-guidance note; `false` omits it entirely.

Run — passes. Commit:

```
feat(goals): inject member personalization profile into LLM prompt
```

---

## Phase 5 — Prompt builder: derived context (no schema change)

### Task 5.1: Add derived inputs to `GoalPromptInput`

```ts
actualAttendanceLast4Weeks: number; // integer days over the trailing 28 days
subscriptionPlanName: string | null;
isOffPeakPlan: boolean;
priorGoalsCompleted: number;
priorGoalsAbandoned: number;
```

### Task 5.2: Render a **System context** block

Append below the member profile block:

```
System context:
- Recent attendance: 10 days over the last 4 weeks (~2.5/week actual)
- Subscription plan: Premium Monthly (off-peak: no)
- Prior goal history: 2 completed, 1 abandoned
```

Corresponding rules:

- `Use actual attendance as the honest baseline; currentGymFrequency is self-reported and may overstate reality. If actual is lower than requestedFrequency, flag the jump in reasoning.`
- `If subscription is off-peak, explicitly note training must occur during off-peak hours (the gym restricts check-in outside that window).`
- `If priorGoalsAbandoned > priorGoalsCompleted, acknowledge in reasoning that past plans may have been too aggressive and set a more conservative pace.`

### Task 5.3: Extend builder tests for every new signal

Run — passes. Commit:

```
feat(goals): add derived system context (attendance, plan, tags, history) to prompt
```

---

## Phase 6 — Listener: gather data and wire it through

### Task 6.1: Write failing tests in `goal-generation.listener.spec.ts`

Cases (each mocks the minimum Prisma return to drive one assertion):

- Passes onboarding fields from `goal.member` into the prompt.
- Computes `ageYears` correctly from `birthday` (e.g. birthday 1990-01-01, `goal.createdAt` 2026-04-21 → 36).
- Counts attendance rows within `[goal.createdAt - 28d, goal.createdAt]` as `actualAttendanceLast4Weeks`.
- Passes subscription plan name and `isOffPeak` flag for member's most recent active subscription (returns `null` + `false` when none).
- Counts member's prior goals by status: COMPLETED vs ABANDONED.
- Sets `hasPersonalTrainer: true` when `trainerAssignmentsAsMember` has any active row.

### Task 6.2: Implement in `goal-generation.listener.ts`

Expand the `findUniqueOrThrow` include chain to load the extra relations needed:

```ts
include: {
  member: {
    include: {
      streak: true,
      subscriptionsOwned: {
        where: { status: 'ACTIVE' },
        include: { plan: { select: { name: true, isOffPeak: true } } },
        orderBy: { endDate: 'desc' },
        take: 1,
      },
      attendances: {
        where: {
          checkInDate: {
            gte: /* createdAt - 28d */,
            lte: /* createdAt */,
          },
        },
        select: { id: true },
      },
      trainerAssignmentsAsMember: {
        where: { status: 'ACTIVE' },
        select: { id: true },
        take: 1,
      },
      goals: {
        where: { id: { not: goalId }, status: { in: ['COMPLETED', 'ABANDONED'] } },
        select: { status: true },
      },
    },
  },
},
```

Compute age:

```ts
const ageYears = member.birthday
  ? Math.floor(
      (goal.createdAt.getTime() - member.birthday.getTime()) /
        (365.25 * 24 * 60 * 60 * 1000),
    )
  : null;
```

Tenure in months:

```ts
const memberTenureMonths = Math.floor(
  (goal.createdAt.getTime() - member.createdAt.getTime()) /
    (30 * 24 * 60 * 60 * 1000),
);
```

Pass all of it into `buildGoalPrompt`.

Run — tests pass. Commit:

```
feat(goals): enrich listener with derived member context for LLM prompt
```

---

## Phase 7 — Documentation & final verification

### Task 7.1: Update module docstrings / README references

**Files:**
- Edit: `CLAUDE.md` — update the `goals/` module description to mention onboarding prerequisite and the expanded personalization inputs.
- Edit: `src/goals/goals.module.ts` or the nearest module-level comment — short note that plan quality depends on `User.onboardingCompletedAt`.

### Task 7.2: Swagger sanity check

- `GET /auth/me` response includes every new field + `onboardingCompleted`.
- `POST /auth/me/onboarding` is present with full request/response schema.
- `POST /goals` documents the 400 case.
- `GoalPlanItemResponseDto.weight` description still correct (not affected by this plan but verify).

### Task 7.3: Full test pass

```
yarn lint && yarn typecheck && yarn test
```

All pass. Record new test count vs baseline.

### Task 7.4: Seed script (optional but recommended)

**Files:**
- Edit: `prisma/seed.ts` — populate personalization fields for existing seeded members so local dev produces realistic LLM outputs. Set `onboardingCompletedAt` for those members.

Commit:

```
chore(seed): populate personalization fields for dev members
```

---

## Deliverables checklist

- [ ] Schema migration applied; `User` has nine new columns.
- [ ] Two new enums: `ExperienceLevel`, `PrimaryMotivation`.
- [ ] `POST /auth/me/onboarding` captures all core fields; idempotent guard prevents double-use.
- [ ] `PATCH /auth/me` accepts the same fields for later edits.
- [ ] `GET /auth/me` returns `onboardingCompleted` + all fields.
- [ ] `POST /goals` rejects with 400 when onboarding incomplete.
- [ ] Prompt includes member profile block (9 fields) and system context block (6 fields) when present.
- [ ] Prompt has rules for bodyweight scaling, preferred days, injury substitution, off-peak, trainer complement, prior-history realism.
- [ ] Listener loads and passes all derived context; prior-goal counts exclude the current goal.
- [ ] Swagger docs updated end-to-end.
- [ ] All tests pass; lint + typecheck clean.

---

## Out of scope (flagged for future)

- Medical conditions / medications (PHI review required; defer).
- Body fat % / waist circumference on `BODY_COMPOSITION` goals (belongs on `Goal`, not `User`).
- Training time-of-day preference (low signal per effort).
- Diet/nutrition tracking (separate module).
- Few-shot example per category in the prompt (prompt engineering win, no data change — tackle once personalization is in and we have generation samples to evaluate).
- Automatic bodyweight updates from a smart scale or periodic re-ask flow.
