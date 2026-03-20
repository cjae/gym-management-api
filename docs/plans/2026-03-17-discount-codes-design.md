# Discount Codes Design

## Overview

Standalone discount code system for promotional campaigns and targeted member retention. Codes give a one-time discount on the first payment of a subscription. No recurring discount — renewals charge full price.

## Use Cases

1. **Promotional campaigns** — gym shares a public code (e.g., "NEWYEAR25" for 20% off any plan)
2. **Targeted retention** — admin generates a code for a specific at-risk member (e.g., 500 KES off next month)

## Data Model

### DiscountCode

| Field | Type | Notes |
|---|---|---|
| id | UUID | PK |
| code | String | Unique, uppercase, 6-12 chars |
| description | String? | Internal admin note |
| discountType | Enum: PERCENTAGE \| FIXED | |
| discountValue | Decimal | 1-100 for percentage, KES amount for fixed |
| maxUses | Int? | Global cap, null = unlimited |
| maxUsesPerMember | Int | Default 1 |
| currentUses | Int | Default 0, incremented on redemption |
| startDate | DateTime | When code becomes valid |
| endDate | DateTime | When code expires |
| isActive | Boolean | Default true, manual override |
| plans | Relation to SubscriptionPlan[] | Optional restriction, empty = all plans |
| redemptions | Relation to DiscountRedemption[] | |
| createdAt | DateTime | |
| updatedAt | DateTime | |

### DiscountRedemption

| Field | Type | Notes |
|---|---|---|
| id | UUID | PK |
| discountCodeId | FK -> DiscountCode | |
| memberId | FK -> User | |
| subscriptionId | FK -> MemberSubscription | |
| originalAmount | Decimal | Plan price before discount |
| discountedAmount | Decimal | Amount actually charged |
| createdAt | DateTime | |
| @@unique([discountCodeId, memberId, subscriptionId]) | | Prevents double-apply |

### MemberSubscription additions

| Field | Type | Notes |
|---|---|---|
| discountCodeId | FK -> DiscountCode? | Which code was used |
| discountAmount | Decimal? | KES saved |

## Validation Logic

When a member creates a subscription with a discount code, validate in order:

1. Code exists (lookup by uppercase string)
2. Code is active (`isActive === true`)
3. Within date window (`now >= startDate AND now <= endDate`)
4. Global usage cap (`currentUses < maxUses`, skip if null)
5. Per-member cap (count redemptions for this member < `maxUsesPerMember`)
6. Plan restriction (if code has linked plans, selected plan must be in the list)
7. Discount sanity: FIXED value < plan.price, PERCENTAGE 1-100, minimum final amount 50 KES (Paystack minimum)

Hard fail — if code is invalid, reject the subscription creation request with a clear error message.

## Application Flow

### Member-created subscription (`POST /subscriptions`)

1. Member includes optional `discountCode` string in DTO
2. Validate code (all checks above)
3. Calculate discounted amount:
   - PERCENTAGE: `plan.price - (plan.price * discountValue / 100)`, rounded to nearest KES
   - FIXED: `plan.price - discountValue`
4. Create subscription with `discountCodeId` and `discountAmount` set
5. Create DiscountRedemption and increment `currentUses` in same Prisma transaction
6. Payment initialization reads discounted price: `plan.price - (subscription.discountAmount ?? 0)`
7. Webhook processes normally — amount is already correct

### Admin-created subscription (`POST /subscriptions/admin`)

- Optional `discountCode` in admin DTO
- Same validation and calculation, applied to Payment amount
- Ignored for COMPLIMENTARY subscriptions (amount is already 0)

### Auto-renewal (billing cron)

- No discount applied — first payment only
- Renewals charge `plan.price`

## API Endpoints

New `discount-codes/` module:

| Method | Endpoint | Access | Description |
|---|---|---|---|
| POST | `/discount-codes` | ADMIN+ | Create a discount code |
| GET | `/discount-codes` | ADMIN+ | List all codes (paginated, filterable) |
| GET | `/discount-codes/:id` | ADMIN+ | Code details + usage stats |
| PATCH | `/discount-codes/:id` | ADMIN+ | Update (reject if expired) |
| DELETE | `/discount-codes/:id` | SUPER_ADMIN | Deactivate |
| GET | `/discount-codes/:id/redemptions` | ADMIN+ | Redemption list (paginated) |
| POST | `/discount-codes/validate` | Authenticated | Check code validity for a plan |

### Validate endpoint

- Body: `{ code: string, planId: string }`
- Returns: `{ valid: boolean, discountType, discountValue, finalPrice }` or error message
- Lets mobile app preview the discount before committing

### Update constraints

- Expired codes (`endDate < now`): updates rejected
- Inactive codes (`isActive: false`): updates allowed (admin can reactivate)

### Modified endpoints

- `POST /subscriptions` — add optional `discountCode` field
- `POST /subscriptions/admin` — add optional `discountCode` field

## Edge Cases

- **Race condition on global cap**: Increment `currentUses` with conditional update (`where: { currentUses: { lt: maxUses } }`) inside transaction. Zero affected rows = code exhausted.
- **Subscription cancelled before payment**: Redemption stays, `currentUses` stays incremented. Prevents gaming limited codes.
- **PENDING subscription cleanup (hourly cron)**: Decrement `currentUses` and delete redemption record when abandoned PENDING subscriptions are cleaned up.
- **Duo subscriptions**: Discount applies per subscription, not per member.

## Testing

- All 7 validation checks (happy + failure paths)
- Percentage and fixed amount calculation with rounding
- Race condition on global cap
- Redemption cleanup on PENDING subscription expiry
- Admin CRUD with expired code update rejection
- Validate endpoint with plan restrictions
