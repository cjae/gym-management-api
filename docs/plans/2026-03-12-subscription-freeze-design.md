# Subscription Freeze Design

## Overview

Allow members to temporarily freeze their subscription when traveling or unavailable. While frozen, gym check-in is blocked and the subscription end date is extended by the actual number of frozen days so members don't lose paid time.

## Schema Changes

### SubscriptionPlan — new field

- `maxFreezeDays Int @default(0)` — maximum freeze days allowed per billing cycle. 0 means freeze is not available for this plan.

### SubscriptionStatus enum — new value

- `FROZEN` — added alongside ACTIVE, EXPIRED, CANCELLED.

### MemberSubscription — new fields

- `freezeStartDate DateTime?` — when the current freeze started
- `freezeEndDate DateTime?` — when the current freeze ends
- `frozenDaysUsed Int @default(0)` — days used this billing cycle (resets on renewal)

## Endpoints

| Method | Route | Who | Description |
|--------|-------|-----|-------------|
| PATCH | /subscriptions/:id/freeze | Owner, Admin, Super Admin | Freeze subscription. Body: `{ days: number }` |
| PATCH | /subscriptions/:id/unfreeze | Owner, Admin, Super Admin | Unfreeze early. Extends end date by actual frozen days only |

## Business Rules

1. Can only freeze an ACTIVE subscription.
2. `days` must be between 1 and `plan.maxFreezeDays`.
3. One freeze per billing cycle — if `frozenDaysUsed > 0`, reject with error.
4. Freezing sets status to FROZEN, records freezeStartDate (now) and freezeEndDate (now + days).
5. Unfreezing (manual or auto-expiry) sets status back to ACTIVE, extends endDate and nextBillingDate by the actual number of frozen days (not the requested days, in case of early unfreeze).
6. Frozen subscriptions block check-in — `hasActiveSubscription` excludes FROZEN status.
7. `frozenDaysUsed` resets to 0 on billing cycle renewal.
8. Auto-unfreeze via daily cron: checks for FROZEN subscriptions where `freezeEndDate <= now`, unfreezes them and extends dates.
9. Billing cron skips FROZEN subscriptions.

## DTO Changes

### CreatePlanDto / UpdatePlanDto

- Add `maxFreezeDays` (optional Int, min 0, default 0).

### FreezeSubscriptionDto

- `days: number` — required, min 1, max validated against plan.maxFreezeDays at runtime.

## Impact on Existing Code

- `hasActiveSubscription()` in SubscriptionsService: exclude FROZEN status.
- Billing cron: skip FROZEN subscriptions.
- Subscription responses: include new freeze fields.
- Attendance check-in: no code change needed (already calls hasActiveSubscription).
