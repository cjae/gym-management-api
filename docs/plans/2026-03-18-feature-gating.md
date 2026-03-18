# Feature Gating Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Gate gym API endpoints behind license feature keys so the license server controls which modules each gym can access.

**Architecture:** The license server returns a `features` string array in the validate response. The gym API caches it in `LicenseCache.features` (JSON column). A `@RequiresFeature()` decorator + global `FeatureGuard` blocks requests to gated endpoints when the feature isn't in the cached list. In dev mode (no license configured), all features are enabled.

**Tech Stack:** NestJS guards, decorators, Reflector, Prisma JSON field, Jest + jest-mock-extended

---

### Task 1: Add `features` column to `LicenseCache`

**Files:**
- Modify: `prisma/schema.prisma:401-414`

**Step 1: Add the column**

In `prisma/schema.prisma`, add `features` to the `LicenseCache` model after the `rawResponse` field:

```prisma
model LicenseCache {
  id            String        @id @default("singleton")
  licenseKey    String
  status        LicenseStatus @default(ACTIVE)
  gymName       String?
  tierName      String?
  maxMembers    Int?
  features      Json?
  expiresAt     DateTime?
  lastCheckedAt DateTime?
  lastSuccessAt DateTime?
  rawResponse   Json?
  createdAt     DateTime      @default(now())
  updatedAt     DateTime      @updatedAt
}
```

**Step 2: Create migration**

Run: `npx prisma migrate dev --name add_license_features`
Expected: Migration created and applied.

**Step 3: Commit**

```bash
git add prisma/
git commit -m "feat(licensing): add features JSON column to LicenseCache"
```

---

### Task 2: Update `LicenseResponseDto` and `LicensingService`

**Files:**
- Modify: `src/licensing/dto/license-response.dto.ts`
- Modify: `src/licensing/licensing.service.ts:51-102` (validateLicense upsert)
- Modify: `src/licensing/licensing.service.ts:134-139` (add hasFeature/getFeatures after getMemberLimit)

**Step 1: Update the DTO**

In `src/licensing/dto/license-response.dto.ts`:

```typescript
export class LicenseResponseDto {
  status: 'ACTIVE' | 'SUSPENDED' | 'EXPIRED';
  gymName?: string;
  tierName?: string;
  maxMembers?: number;
  expiresAt?: string;
  features?: string[];
}
```

**Step 2: Update `validateLicense()` to cache features**

In `src/licensing/licensing.service.ts`, update both `update` and `create` objects in the success-path `upsert` (around line 77-102) to include `features`:

```typescript
update: {
  licenseKey: this.licenseKey,
  status: data.status,
  gymName: data.gymName,
  tierName: data.tierName,
  maxMembers: data.maxMembers,
  features: data.features ?? [],
  expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
  lastCheckedAt: now,
  lastSuccessAt: now,
  rawResponse: data as unknown as Prisma.InputJsonValue,
},
create: {
  id: 'singleton',
  licenseKey: this.licenseKey,
  status: data.status,
  gymName: data.gymName,
  tierName: data.tierName,
  maxMembers: data.maxMembers,
  features: data.features ?? [],
  expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
  lastCheckedAt: now,
  lastSuccessAt: now,
  rawResponse: data as unknown as Prisma.InputJsonValue,
},
```

**Step 3: Add `hasFeature()` and `getFeatures()` methods**

Add these after the `getMemberLimit()` method in `src/licensing/licensing.service.ts`:

```typescript
async getFeatures(): Promise<string[]> {
  const cache = await this.prisma.licenseCache.findUnique({
    where: { id: 'singleton' },
  });
  if (!cache?.features) return [];
  return cache.features as string[];
}

async hasFeature(key: string): Promise<boolean> {
  if (!this.isConfigured()) return true;

  const features = await this.getFeatures();
  return features.includes(key);
}
```

**Step 4: Run existing tests to verify nothing is broken**

Run: `yarn test -- --testPathPattern=licensing`
Expected: All existing tests pass.

**Step 5: Commit**

```bash
git add src/licensing/dto/license-response.dto.ts src/licensing/licensing.service.ts
git commit -m "feat(licensing): cache features from license response and add hasFeature/getFeatures"
```

---

### Task 3: Write tests for `hasFeature()` and `getFeatures()`

**Files:**
- Modify: `src/licensing/licensing.service.spec.ts`

**Step 1: Add test cases**

Add a new `describe` block after the `getMemberLimit` describe block (after line 272):

```typescript
describe('getFeatures', () => {
  it('should return features from cached license', async () => {
    prisma.licenseCache.findUnique.mockResolvedValue({
      features: ['referrals', 'analytics'],
    } as any);
    const result = await service.getFeatures();
    expect(result).toEqual(['referrals', 'analytics']);
  });

  it('should return empty array when no cache exists', async () => {
    prisma.licenseCache.findUnique.mockResolvedValue(null);
    const result = await service.getFeatures();
    expect(result).toEqual([]);
  });

  it('should return empty array when features is null', async () => {
    prisma.licenseCache.findUnique.mockResolvedValue({
      features: null,
    } as any);
    const result = await service.getFeatures();
    expect(result).toEqual([]);
  });
});

describe('hasFeature', () => {
  it('should return true when feature is in cached list', async () => {
    prisma.licenseCache.findUnique.mockResolvedValue({
      features: ['referrals', 'analytics'],
    } as any);
    const result = await service.hasFeature('referrals');
    expect(result).toBe(true);
  });

  it('should return false when feature is not in cached list', async () => {
    prisma.licenseCache.findUnique.mockResolvedValue({
      features: ['referrals'],
    } as any);
    const result = await service.hasFeature('salary');
    expect(result).toBe(false);
  });

  it('should return true for any feature in dev mode (unconfigured)', async () => {
    mockConfigService.get.mockReturnValue({
      licenseKey: '',
      licenseServerUrl: '',
    });
    const devService = new LicensingService(
      prisma as unknown as PrismaService,
      mockConfigService as unknown as ConfigService,
    );
    const result = await devService.hasFeature('anything');
    expect(result).toBe(true);
  });

  it('should return false when no cache and license is configured', async () => {
    prisma.licenseCache.findUnique.mockResolvedValue(null);
    const result = await service.hasFeature('referrals');
    expect(result).toBe(false);
  });
});
```

**Step 2: Also update the `validateLicense` test to verify features are cached**

Update the existing test `'should update cache with ACTIVE on successful response'` (around line 118) — add `features` to the mock response data and verify it appears in the upsert:

In the `mockedAxios.post.mockResolvedValue` call, add `features` to `data`:

```typescript
mockedAxios.post.mockResolvedValue({
  status: 200,
  data: {
    status: 'ACTIVE',
    gymName: 'Test Gym',
    tierName: 'Growth',
    maxMembers: 100,
    expiresAt: '2026-04-10T00:00:00Z',
    features: ['referrals', 'analytics'],
  },
});
```

And update the upsert assertion to check for features:

```typescript
expect(prisma.licenseCache.upsert).toHaveBeenCalledWith(
  expect.objectContaining({
    where: { id: 'singleton' },
    update: expect.objectContaining({
      status: 'ACTIVE',
      features: ['referrals', 'analytics'],
    }),
    create: expect.objectContaining({
      status: 'ACTIVE',
      features: ['referrals', 'analytics'],
    }),
  }),
);
```

**Step 3: Run tests**

Run: `yarn test -- --testPathPattern=licensing.service`
Expected: All tests pass.

**Step 4: Commit**

```bash
git add src/licensing/licensing.service.spec.ts
git commit -m "test(licensing): add tests for hasFeature and getFeatures"
```

---

### Task 4: Create `@RequiresFeature()` decorator

**Files:**
- Create: `src/licensing/decorators/requires-feature.decorator.ts`

**Step 1: Create the decorator**

```typescript
import { SetMetadata } from '@nestjs/common';

export const FEATURE_KEY = 'requiredFeature';
export const RequiresFeature = (feature: string) =>
  SetMetadata(FEATURE_KEY, feature);
```

**Step 2: Commit**

```bash
git add src/licensing/decorators/requires-feature.decorator.ts
git commit -m "feat(licensing): add @RequiresFeature() decorator"
```

---

### Task 5: Create `FeatureGuard` with tests

**Files:**
- Create: `src/licensing/feature.guard.ts`
- Create: `src/licensing/feature.guard.spec.ts`

**Step 1: Write the test file**

Create `src/licensing/feature.guard.spec.ts`:

```typescript
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FeatureGuard } from './feature.guard';
import { LicensingService } from './licensing.service';

describe('FeatureGuard', () => {
  let guard: FeatureGuard;
  let reflector: Partial<Reflector>;
  let licensingService: Partial<LicensingService>;

  beforeEach(() => {
    reflector = {
      getAllAndOverride: jest.fn(),
    };
    licensingService = {
      hasFeature: jest.fn(),
    };
    guard = new FeatureGuard(
      reflector as Reflector,
      licensingService as LicensingService,
    );
  });

  const createMockContext = (): ExecutionContext =>
    ({
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
    }) as unknown as ExecutionContext;

  it('should allow request when no feature is required', async () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(undefined);
    const result = await guard.canActivate(createMockContext());
    expect(result).toBe(true);
    expect(licensingService.hasFeature).not.toHaveBeenCalled();
  });

  it('should allow request when feature is enabled', async () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue('referrals');
    (licensingService.hasFeature as jest.Mock).mockResolvedValue(true);
    const result = await guard.canActivate(createMockContext());
    expect(result).toBe(true);
    expect(licensingService.hasFeature).toHaveBeenCalledWith('referrals');
  });

  it('should throw ForbiddenException when feature is not enabled', async () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue('salary');
    (licensingService.hasFeature as jest.Mock).mockResolvedValue(false);
    await expect(guard.canActivate(createMockContext())).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('should check both handler and class for metadata', async () => {
    const mockHandler = jest.fn();
    const mockClass = jest.fn();
    const context = {
      getHandler: () => mockHandler,
      getClass: () => mockClass,
    } as unknown as ExecutionContext;

    (reflector.getAllAndOverride as jest.Mock).mockReturnValue('analytics');
    (licensingService.hasFeature as jest.Mock).mockResolvedValue(true);

    await guard.canActivate(context);

    expect(reflector.getAllAndOverride).toHaveBeenCalledWith('requiredFeature', [
      mockHandler,
      mockClass,
    ]);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `yarn test -- --testPathPattern=feature.guard`
Expected: FAIL — `FeatureGuard` doesn't exist yet.

**Step 3: Create the guard**

Create `src/licensing/feature.guard.ts`:

```typescript
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FEATURE_KEY } from './decorators/requires-feature.decorator';
import { LicensingService } from './licensing.service';

@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly licensingService: LicensingService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredFeature = this.reflector.getAllAndOverride<string>(
      FEATURE_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredFeature) return true;

    const hasFeature = await this.licensingService.hasFeature(requiredFeature);
    if (!hasFeature) {
      throw new ForbiddenException(
        'This feature is not available on your current plan.',
      );
    }

    return true;
  }
}
```

**Step 4: Run tests**

Run: `yarn test -- --testPathPattern=feature.guard`
Expected: All 4 tests pass.

**Step 5: Commit**

```bash
git add src/licensing/feature.guard.ts src/licensing/feature.guard.spec.ts
git commit -m "feat(licensing): add FeatureGuard with tests"
```

---

### Task 6: Register `FeatureGuard` globally

**Files:**
- Modify: `src/licensing/licensing.module.ts`
- Modify: `src/app.module.ts:75-91`

**Step 1: Export FeatureGuard from LicensingModule**

Update `src/licensing/licensing.module.ts`:

```typescript
import { Global, Module } from '@nestjs/common';
import { LicensingService } from './licensing.service';
import { LicenseCron } from './licensing.cron';
import { LicenseGuard } from './licensing.guard';
import { FeatureGuard } from './feature.guard';

@Global()
@Module({
  providers: [LicensingService, LicenseCron, LicenseGuard, FeatureGuard],
  exports: [LicensingService, LicenseGuard, FeatureGuard],
})
export class LicensingModule {}
```

**Step 2: Register as APP_GUARD in app.module.ts**

In `src/app.module.ts`, add the import and register `FeatureGuard` after `ThrottlerGuard`:

Add to imports at top:
```typescript
import { FeatureGuard } from './licensing/feature.guard';
```

Add to providers array after the `ThrottlerGuard` entry:
```typescript
{
  provide: APP_GUARD,
  useClass: LicenseGuard,
},
{
  provide: APP_GUARD,
  useClass: ThrottlerGuard,
},
{
  provide: APP_GUARD,
  useClass: FeatureGuard,
},
```

**Step 3: Run all tests to verify nothing breaks**

Run: `yarn test`
Expected: All tests pass.

**Step 4: Commit**

```bash
git add src/licensing/licensing.module.ts src/app.module.ts
git commit -m "feat(licensing): register FeatureGuard as global APP_GUARD"
```

---

### Task 7: Apply `@RequiresFeature()` to controller-level gated modules

**Files:**
- Modify: `src/referrals/referrals.controller.ts` — add `@RequiresFeature('referrals')` before `@Controller`
- Modify: `src/discount-codes/discount-codes.controller.ts` — add `@RequiresFeature('discount-codes')`
- Modify: `src/gym-classes/gym-classes.controller.ts` — add `@RequiresFeature('gym-classes')`
- Modify: `src/events/events.controller.ts` — add `@RequiresFeature('events')`
- Modify: `src/notifications/notifications.controller.ts` — add `@RequiresFeature('notifications')`
- Modify: `src/notifications/push-tokens.controller.ts` — add `@RequiresFeature('notifications')`
- Modify: `src/banners/banners.controller.ts` — add `@RequiresFeature('banners')`
- Modify: `src/entrances/entrances.controller.ts` — add `@RequiresFeature('multi-entrance')`
- Modify: `src/salary/salary.controller.ts` — add `@RequiresFeature('salary')`
- Modify: `src/audit-logs/audit-logs.controller.ts` — add `@RequiresFeature('audit-logs')`

**Step 1: Apply to each controller**

For each controller listed above, add two things:

1. Import at top:
```typescript
import { RequiresFeature } from '../licensing/decorators/requires-feature.decorator';
```

2. Add decorator before `@Controller(...)`:
```typescript
@RequiresFeature('feature-key')
@Controller('controller-name')
```

Example for `referrals.controller.ts`:
```typescript
import { RequiresFeature } from '../licensing/decorators/requires-feature.decorator';
// ... existing imports ...

@RequiresFeature('referrals')
@Controller('referrals')
export class ReferralsController {
```

Repeat the same pattern for all 10 controllers with their respective feature keys.

**Step 2: Run lint**

Run: `yarn lint`
Expected: No errors.

**Step 3: Run all tests**

Run: `yarn test`
Expected: All tests pass. The `FeatureGuard` won't interfere because in tests the guard is not registered globally — controllers are tested in isolation.

**Step 4: Commit**

```bash
git add src/referrals/ src/discount-codes/ src/gym-classes/ src/events/ src/notifications/ src/banners/ src/entrances/ src/salary/ src/audit-logs/
git commit -m "feat(licensing): apply @RequiresFeature to controller-level gated modules"
```

---

### Task 8: Apply handler-level `@RequiresFeature()` to analytics and attendance

**Files:**
- Modify: `src/analytics/analytics.controller.ts:45-107` — add `@RequiresFeature('analytics')` to 5 handlers (NOT `getDashboard`)
- Modify: `src/attendance/attendance.controller.ts:47-57` — add `@RequiresFeature('attendance-streaks')` to `streak` and `leaderboard` handlers

**Step 1: Update analytics controller**

In `src/analytics/analytics.controller.ts`, add the import:
```typescript
import { RequiresFeature } from '../licensing/decorators/requires-feature.decorator';
```

Add `@RequiresFeature('analytics')` to these 5 handlers (before each `@Roles` decorator):
- `getExpiringMemberships` (line 45)
- `getRevenue` (line 57)
- `getAttendance` (line 73)
- `getSubscriptions` (line 85)
- `getMembers` (line 97)

Do NOT add it to `getDashboard` (line 33).

Example for `getExpiringMemberships`:
```typescript
@Get('expiring-memberships')
@RequiresFeature('analytics')
@Roles('ADMIN', 'SUPER_ADMIN')
@ApiOperation({ ... })
```

**Step 2: Update attendance controller**

In `src/attendance/attendance.controller.ts`, add the import:
```typescript
import { RequiresFeature } from '../licensing/decorators/requires-feature.decorator';
```

Add `@RequiresFeature('attendance-streaks')` to these 2 handlers:
- `streak` (line 47)
- `leaderboard` (line 53)

Do NOT add it to `checkIn`, `history`, or `today`.

Example for `streak`:
```typescript
@Get('streak')
@RequiresFeature('attendance-streaks')
@ApiOkResponse({ type: StreakResponseDto })
```

**Step 3: Run lint and tests**

Run: `yarn lint && yarn test`
Expected: All pass.

**Step 4: Commit**

```bash
git add src/analytics/analytics.controller.ts src/attendance/attendance.controller.ts
git commit -m "feat(licensing): apply handler-level @RequiresFeature to analytics and attendance"
```

---

### Task 9: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Update the licensing section**

In the `licensing/` module description in CLAUDE.md, add feature gating info. Find the existing line:

```
- `licensing/` — SaaS license validation. Daily phone-home to control plane. Global `LicenseGuard` returns 503 when license invalid (7-day grace period). Dev mode when `LICENSE_KEY` unset.
```

Replace with:

```
- `licensing/` — SaaS license validation and feature gating. Daily phone-home to control plane. Global `LicenseGuard` returns 503 when license invalid (7-day grace period). Dev mode when `LICENSE_KEY` unset (all features enabled). `FeatureGuard` enforces feature access via `@RequiresFeature()` decorator — returns 403 when feature not in license. Gated modules: referrals, discount-codes, gym-classes, events, analytics (except dashboard), notifications, banners, multi-entrance, attendance-streaks, salary, audit-logs.
```

Also add a note in the Security section about feature gating:

```
- **Feature gating**: License-based feature access via `@RequiresFeature(key)` decorator + global `FeatureGuard`. Returns 403 when feature not enabled. Dev mode allows all features.
```

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add feature gating to CLAUDE.md"
```
