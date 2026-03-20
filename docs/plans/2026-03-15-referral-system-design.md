# Referral System Design

**Date:** 2026-03-15
**Status:** Approved

## Overview

Members can refer others to the gym using a unique referral code. When a referred user completes their first subscription payment, the referrer earns free days added to their active subscription. Rewards are configurable by SUPER_ADMIN via gym settings.

## Reward Mechanics

- **Reward type:** Free days added to referrer's subscription `endDate` (and `nextBillingDate`)
- **Trigger:** Referred user's first subscription payment confirmed (Paystack webhook `charge.success`)
- **Default reward:** 7 days per successful referral
- **Cap:** Max 3 referral rewards per billing cycle (configurable)
- **Referral code:** Auto-generated 8-char alphanumeric code per user, unique

## Data Model

### User Model Additions

```prisma
referralCode    String?  @unique  // 8-char alphanumeric, auto-generated on creation
referredById    String?            // FK to User who referred them
referredBy      User?    @relation("UserReferrals", fields: [referredById], references: [id])
referrals       User[]   @relation("UserReferrals")
```

### New Referral Model

```prisma
model Referral {
  id          String         @id @default(uuid())
  referrerId  String         // User who made the referral
  referredId  String         @unique  // User who was referred (one referrer per user)
  status      ReferralStatus @default(PENDING)
  rewardDays  Int            @default(0)  // Days earned (0 if cap reached)
  completedAt DateTime?      // When first payment confirmed

  referrer    User           @relation("ReferrerReferrals", fields: [referrerId], references: [id])
  referred    User           @relation("ReferredReferrals", fields: [referredId], references: [id])

  createdAt   DateTime       @default(now())
  updatedAt   DateTime       @updatedAt

  @@index([referrerId, createdAt])
}

enum ReferralStatus {
  PENDING    // Referred user registered but hasn't paid
  COMPLETED  // First payment confirmed, reward applied (or cap reached)
}
```

### GymSettings Additions

```prisma
referralRewardDays     Int @default(7)
maxReferralsPerCycle   Int @default(3)
```

### NotificationType Enum Addition

```prisma
REFERRAL_REWARD  // Added to existing NotificationType enum
```

## Flow

### 1. Registration

- `RegisterDto` gains optional `referralCode` field (string, max 8 chars)
- `AuthService.register()`:
  - If `referralCode` provided, look up referrer by code
  - Validate referrer exists and is ACTIVE
  - Set `referredById` on new user
  - Create PENDING `Referral` record (referrerId, referredId)
  - If code is invalid, registration still succeeds (soft fail — no error, just ignore)

### 2. Referral Code Generation

- Generated in `UsersService.create()` and `AuthService.register()` (any user creation path)
- Format: 8-char uppercase alphanumeric (e.g., `JOHN2X4K`)
- Collision handling: retry up to 3 times with new random code

### 3. Reward Application (Webhook)

When `PaymentsService.handleWebhook()` processes a successful `charge.success`:

1. Check if paying user has a PENDING referral record
2. If yes, load the referrer's active subscription
3. Count referrer's COMPLETED referrals (with rewardDays > 0) in current billing cycle
4. If count < `maxReferralsPerCycle` (from GymSettings):
   - Extend referrer's `endDate` by `referralRewardDays`
   - Extend referrer's `nextBillingDate` by `referralRewardDays`
   - Set `referral.rewardDays = referralRewardDays`
5. If count >= cap: set `referral.rewardDays = 0` (no reward, still mark completed)
6. Mark referral as COMPLETED with `completedAt = now()`
7. Send email to referrer via EmailService (new `referral-reward.hbs` template)
8. Create in-app + push notification via `NotificationsService.create()` with type `REFERRAL_REWARD`

### 4. Edge Cases

- **Referrer has no active subscription:** Referral marked COMPLETED with `rewardDays = 0`. No reward applied, no notification.
- **Referred user never pays:** Referral stays PENDING forever. No cleanup needed.
- **Self-referral:** Prevented — validate `referralCode` doesn't belong to the registering user (by email check not possible pre-creation, so check post-creation and skip if self)
- **Duo subscriptions:** Reward goes to referrer's own subscription, not the referred user's. No special handling needed.

## API Endpoints

### Referrals Module

All endpoints require JWT auth.

| Method | Path | Role | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/referrals/my-code` | Any authenticated | Returns user's referral code |
| `GET` | `/api/v1/referrals/my-referrals` | Any authenticated | Paginated list of user's referrals |
| `GET` | `/api/v1/referrals/stats` | Any authenticated | Referral count, total days earned, remaining this cycle |

### Response: My Code

```json
{ "referralCode": "JOHN2X4K" }
```

### Response: My Referrals

```json
{
  "data": [
    {
      "id": "uuid",
      "referredName": "Jane Doe",
      "status": "COMPLETED",
      "rewardDays": 7,
      "completedAt": "2026-03-15T10:00:00Z",
      "createdAt": "2026-03-14T08:00:00Z"
    }
  ],
  "total": 5,
  "page": 1,
  "limit": 20
}
```

### Response: Stats

```json
{
  "totalReferrals": 12,
  "completedReferrals": 8,
  "totalDaysEarned": 49,
  "referralsThisCycle": 2,
  "maxReferralsPerCycle": 3,
  "remainingThisCycle": 1,
  "rewardDaysPerReferral": 7
}
```

## Notifications

### Email (referral-reward.hbs)

Subject: "You earned free days!"

Body: "Great news! Your friend {{referredName}} just joined the gym. You've earned {{rewardDays}} free days on your subscription. Your new end date is {{newEndDate}}."

### Push / In-App

```typescript
notificationsService.create({
  userId: referrerId,
  title: 'Referral reward earned!',
  body: `${referredName} joined — you earned ${rewardDays} free days!`,
  type: 'REFERRAL_REWARD',
  metadata: { referredId, referredName, rewardDays, newEndDate }
})
```

## GymSettings Configuration

SUPER_ADMIN configures via existing gym settings endpoints:

- `referralRewardDays` (Int, default 7, min 1, max 90)
- `maxReferralsPerCycle` (Int, default 3, min 1, max 50)

## What Changes in Existing Code

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Add Referral model, ReferralStatus enum, User fields, GymSettings fields, REFERRAL_REWARD to NotificationType |
| `src/auth/dto/register.dto.ts` | Add optional `referralCode` field |
| `src/auth/auth.service.ts` | Validate referral code during registration, create Referral record |
| `src/payments/payments.service.ts` | After successful charge, trigger referral reward logic |
| `src/payments/payments.module.ts` | Import ReferralsModule |
| `src/referrals/` | New module: controller, service, DTOs, spec |
| `src/email/templates/referral-reward.hbs` | New email template |
| `prisma/seed.ts` | Add referral seed data and GymSettings fields |
