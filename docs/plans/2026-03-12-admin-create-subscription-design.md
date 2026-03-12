# Admin Create Subscription & Pending Subscription Fix

**Date:** 2026-03-12
**Status:** Approved

## Problem

1. Subscriptions are created as ACTIVE immediately, before payment. A member who abandons the Paystack checkout gets a free billing cycle.
2. Admins have no way to create subscriptions for members who pay offline (M-Pesa offline, bank transfer, complimentary).
3. Members can spam `POST /payments/initialize`, creating multiple orphaned PENDING payment records.

## Design

### Schema Changes

**`SubscriptionStatus` enum** — add `PENDING`:
```
PENDING | ACTIVE | FROZEN | EXPIRED | CANCELLED
```

**`PaymentMethod` enum** — add `MPESA_OFFLINE`, `BANK_TRANSFER`, `COMPLIMENTARY`:
```
CARD | MPESA | MPESA_OFFLINE | BANK_TRANSFER | COMPLIMENTARY
```

**`MemberSubscription` new fields:**
- `paymentNote: String?` — free-text for admin context (e.g., "M-Pesa confirmation code ABC123")
- `createdBy: String?` (FK to User) — which admin created it. Null = member self-service.

**`Payment` new fields:**
- `paymentNote: String?` — mirrors context from admin creation

### Existing Member Flow Changes

**`POST /subscriptions` (member self-service):**
- Creates subscription with `status: PENDING` instead of `ACTIVE`
- Everything else unchanged — member still calls `POST /payments/initialize/:subscriptionId` next

**Webhook `charge.success` handler:**
- Now also sets `status: ACTIVE` on the subscription (previously it was already ACTIVE)

**`POST /payments/initialize/:subscriptionId`:**
- Before creating a new Payment, check for existing PENDING payment on this subscription
- If found: mark it EXPIRED, then create a fresh one
- Net effect: one PENDING payment per subscription at any time

**Query filtering:**
- `GET /subscriptions/my` (member view) — exclude `PENDING`
- `GET /subscriptions` (admin list) — exclude `PENDING`
- `GET /subscriptions/:id` — still accessible (admin may need to debug)
- `hasActiveSubscription` — no change needed (already checks `ACTIVE` only)

### New Admin Endpoint

**`POST /subscriptions/admin`** — ADMIN, SUPER_ADMIN only

**Request body (`AdminCreateSubscriptionDto`):**
| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `memberId` | UUID string | Yes | Target member |
| `planId` | UUID string | Yes | Subscription plan |
| `paymentMethod` | `MPESA_OFFLINE \| BANK_TRANSFER \| COMPLIMENTARY` | Yes | Only offline methods |
| `paymentNote` | string (max 500) | No | e.g., "M-Pesa confirmation code ABC123" |

**Validations:**
- Target user must exist with role `MEMBER`
- Plan must exist and be active (`isActive: true`)
- Member must not already have an active subscription

**Creates (in a transaction):**
1. `MemberSubscription` — `status: ACTIVE`, `startDate: now`, `endDate: now + billingInterval`, `nextBillingDate: endDate`, `createdBy: adminId`, `autoRenew: false`
2. `SubscriptionMember` join record linking the member
3. `Payment` — `status: PAID`, `amount: plan.price` (or 0 if COMPLIMENTARY), matching `paymentMethod` and `paymentNote`

**Returns:** `SubscriptionResponseDto` (same shape as existing)

### New Cron: Pending Subscription Cleanup

**Schedule:** Every hour

**Logic:**
1. Query `MemberSubscription` where `status: PENDING` and `createdAt < 1 hour ago`
2. Delete associated Payment records (PENDING/EXPIRED) for those subscriptions
3. Delete the subscriptions
4. Log count of cleaned-up subscriptions

### No Changes To

- Billing cron (card renewals, M-Pesa reminders, overdue expiry)
- Freeze/unfreeze flow
- Duo member flow (`POST /subscriptions/:id/duo`)
- Cancel flow
- `hasActiveSubscription` check
- Subscription plans module
