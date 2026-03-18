# Feature Gating Design

## Overview

Add license-based feature gating to the gym API. The license server returns a `features` string array in the validate response. The gym API caches it and enforces access per-controller or per-handler using a decorator + global guard pattern — identical to how `@Roles()` + `RolesGuard` already works.

## Response Contract

The license server validate response adds a `features` field:

```json
{
  "status": "ACTIVE",
  "gymName": "FitLife Nairobi",
  "tierName": "Growth",
  "maxMembers": 200,
  "expiresAt": "2027-01-15T00:00:00.000Z",
  "features": ["referrals", "discount-codes", "gym-classes", "events", "analytics"]
}
```

## Database Change

Add `features` JSON column to `LicenseCache`:

```prisma
model LicenseCache {
  // ... existing fields ...
  features  Json?    // String array stored as JSON
}
```

## Service Changes (`LicensingService`)

Add two methods:

- `hasFeature(key: string): Promise<boolean>` — returns `true` if feature is in cached list. In dev mode (unconfigured), returns `true` for all features.
- `getFeatures(): Promise<string[]>` — returns cached feature list. In dev mode, returns empty array (but `hasFeature` still returns true).

Update `validateLicense()` to cache `features` from the response in the upsert.

## Decorator: `@RequiresFeature(key)`

```typescript
import { SetMetadata } from '@nestjs/common';

export const FEATURE_KEY = 'requiredFeature';
export const RequiresFeature = (feature: string) => SetMetadata(FEATURE_KEY, feature);
```

Applied at controller level (gates all endpoints) or handler level (gates specific endpoints).

## Guard: `FeatureGuard`

Global guard registered as `APP_GUARD` in `app.module.ts`. Uses `Reflector` to read `FEATURE_KEY` metadata from the handler and class. If no feature required, allows. If feature required, calls `licensingService.hasFeature()`. Throws `ForbiddenException` with message: `"This feature is not available on your current plan."` if not enabled.

Guard order in `app.module.ts`: `LicenseGuard` → `ThrottlerGuard` → `FeatureGuard` (feature guard runs after license is validated).

## Feature-to-Controller Mapping

### Controller-level gating (entire controller)

| Feature Key | Controller |
|---|---|
| `referrals` | ReferralsController |
| `discount-codes` | DiscountCodesController |
| `gym-classes` | GymClassesController |
| `events` | EventsController |
| `notifications` | NotificationsController, PushTokensController |
| `banners` | BannersController |
| `multi-entrance` | EntrancesController |
| `salary` | SalaryController |
| `audit-logs` | AuditLogsController |

### Handler-level gating (specific endpoints only)

| Feature Key | Controller | Gated Handlers | Ungated Handlers |
|---|---|---|---|
| `analytics` | AnalyticsController | `getExpiringMemberships`, `getRevenue`, `getAttendance`, `getSubscriptions`, `getMembers` | `getDashboard` |
| `attendance-streaks` | AttendanceController | `streak`, `leaderboard` | `checkIn`, `history`, `today` |

### Ungated (all tiers, no decorator needed)

auth, users, subscription-plans, subscriptions, payments, attendance (check-in/history/today), qr, trainers, gym-settings, uploads, billing, imports, analytics dashboard.

## Dev Mode Behavior

When `LICENSE_KEY` is not configured (dev mode), `hasFeature()` returns `true` for all features. No endpoints are blocked during development.

## Files to Create/Modify

**New files:**
- `src/licensing/decorators/requires-feature.decorator.ts`
- `src/licensing/feature.guard.ts`
- `src/licensing/feature.guard.spec.ts`

**Modified files:**
- `prisma/schema.prisma` — add `features Json?` to `LicenseCache`
- `src/licensing/dto/license-response.dto.ts` — add `features?: string[]`
- `src/licensing/licensing.service.ts` — cache features, add `hasFeature()`, `getFeatures()`
- `src/licensing/licensing.service.spec.ts` — tests for new methods
- `src/licensing/licensing.module.ts` — export `FeatureGuard`
- `src/app.module.ts` — register `FeatureGuard` as `APP_GUARD`
- 11 controllers — add `@RequiresFeature()` decorator

## Error Response

```json
{
  "statusCode": 403,
  "message": "This feature is not available on your current plan."
}
```
