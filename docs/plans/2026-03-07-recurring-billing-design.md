# Recurring Subscription Billing Design

## Problem

Gym subscriptions are recurring. Paystack supports auto-debit for cards but not for M-Pesa. M-Pesa is the dominant payment method in Kenya, so the system must handle both:

- **Card users**: Auto-charge via saved Paystack authorization codes
- **M-Pesa users**: Reminder-driven, member pays manually via app or payment link

## Core Concept

The system owns the billing cycle. A daily cron job is the single engine that processes all renewals — charging cards automatically and sending reminders to M-Pesa users.

## Schema Changes

### SubscriptionPlan

Replace `durationDays: Int` with:

```prisma
enum BillingInterval {
  DAILY
  WEEKLY
  MONTHLY
  QUARTERLY
  BI_ANNUALLY
  ANNUALLY
}
```

Add `billingInterval BillingInterval` to `SubscriptionPlan`. Remove `durationDays`.

### MemberSubscription

Add recurring billing fields:

```prisma
enum PaymentMethod {
  CARD
  MPESA
}
```

New fields on `MemberSubscription`:

| Field | Type | Purpose |
|-------|------|---------|
| `paymentMethod` | `PaymentMethod` | Card or M-Pesa |
| `paystackAuthorizationCode` | `String?` | Saved card token from first payment |
| `autoRenew` | `Boolean` (default `true`) | Whether to auto-renew |
| `nextBillingDate` | `DateTime` | When the next charge/reminder is due |

Remove `paystackReference` and `paymentStatus` from `MemberSubscription` (moved to `Payment` table).

### Payment (new table)

Standalone table to track every charge attempt per billing cycle:

```prisma
model Payment {
  id               String        @id @default(uuid())
  subscriptionId   String
  amount           Float
  currency         String        @default("KES")
  status           PaymentStatus @default(PENDING)
  paymentMethod    PaymentMethod
  paystackReference String?
  failureReason    String?
  createdAt        DateTime      @default(now())
  updatedAt        DateTime      @updatedAt

  subscription MemberSubscription @relation(fields: [subscriptionId], references: [id])
}
```

## Billing Interval Calculation

Helper to compute the next billing date from current date:

| Interval | Calculation |
|----------|-------------|
| DAILY | +1 day |
| WEEKLY | +7 days |
| MONTHLY | +1 calendar month |
| QUARTERLY | +3 calendar months |
| BI_ANNUALLY | +6 calendar months |
| ANNUALLY | +1 year |

## Billing Flows

### First Payment (Onboarding)

1. Member picks a plan, chooses card or M-Pesa
2. System creates a `MemberSubscription` with `status: PENDING` and a `Payment` record
3. System initializes Paystack checkout
4. On `charge.success` webhook:
   - Mark `Payment` as `PAID`
   - If card: save `authorization.authorization_code` from webhook payload to subscription
   - Set `nextBillingDate` = start date + billing interval
   - Activate subscription (`status: ACTIVE`)

### Daily Cron Job

Runs once per day (e.g. 6:00 AM EAT). Single job handles both payment methods:

1. Query all `ACTIVE` subscriptions where `nextBillingDate <= today` and `autoRenew = true`
2. For each subscription:

**Card users:**
- Create a `PENDING` payment record
- Call Paystack "charge authorization" endpoint with saved `paystackAuthorizationCode`
- On `charge.success` webhook: mark payment `PAID`, advance `nextBillingDate` by one interval
- On failure: mark payment `FAILED`, record `failureReason`
- If 2 consecutive failures: set subscription `status: EXPIRED`, send "please update payment method" email

**M-Pesa users:**
- Create a `PENDING` payment record
- Send reminder email + push notification with payment link
- If no payment by end of `nextBillingDate`: set subscription `status: EXPIRED`

### Member-Initiated Payment (M-Pesa Renewal)

1. Member opens app, sees "Subscription expired / due", taps Pay
2. System initializes a new Paystack transaction for the current plan amount
3. On `charge.success` webhook:
   - Mark payment as `PAID`
   - Reactivate subscription (`status: ACTIVE`)
   - Advance `nextBillingDate` by one interval from today

### Reminder Schedule (M-Pesa users only)

| Timing | Message |
|--------|---------|
| 3 days before expiry | "Your subscription renews in 3 days" |
| 1 day before expiry | "Your subscription renews tomorrow -- tap to pay" |
| On due date | "Your subscription is due today" |
| After due date, no payment | Immediate expiry, no grace period |

## Key Design Decisions

- **No grace period** -- immediate lockout on expiry
- **Card failure retry** -- retry once the next day. After 2 consecutive failures, expire and notify
- **Duo subscriptions** -- only the primary member is billed. Duo member access follows primary's subscription state
- **Plan changes** -- take effect at next billing date (no mid-cycle pro-rating for MVP)
- **Cancellation** -- sets `autoRenew = false`. Subscription stays active until current period ends, then expires
- **Payment history** -- every charge attempt is a row in `Payment`, queryable per member/subscription
- **Self-managed billing** -- system owns the schedule rather than using Paystack's built-in subscription plans, giving full control over both card and M-Pesa flows with one unified engine
