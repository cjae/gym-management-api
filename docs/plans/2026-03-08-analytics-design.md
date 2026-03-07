# Analytics Module Design

## Overview

Analytics endpoints for the admin dashboard, accessible to ADMIN and SUPER_ADMIN roles. Provides a summary dashboard endpoint for at-a-glance metrics plus granular drill-down endpoints with flexible date ranges and time granularity.

## Endpoints

### 1. `GET /api/v1/analytics/dashboard` (ADMIN, SUPER_ADMIN)

Single summary endpoint for the main dashboard view. Returns:

- **Members**: total, active, inactive, suspended, new this month
- **Subscriptions**: total active, expiring within 7 days, expired this month, breakdown by plan
- **Attendance**: check-ins today, check-ins this week, average daily check-ins (last 30 days)
- **Payments**: pending payments count, failed payments count (last 30 days)
- **Recent activity feed**: last 20 events (new registrations, check-ins, payments, subscription changes)

**SUPER_ADMIN extras** (conditionally included based on role):
- **Revenue**: total revenue this month, total revenue last month
- **Expenses**: total salaries paid this month, pending salaries
- **Net position**: revenue minus salary costs

### 2. `GET /api/v1/analytics/revenue` (SUPER_ADMIN only)

Revenue drill-down with time-series data.

**Query params:**
- `from`, `to` — date range (defaults to last 12 months)
- `granularity` — `daily | weekly | monthly` (defaults to `monthly`)
- `paymentMethod` — optional filter (`CARD | MPESA`)

**Returns:** `{ series: [{ period, total, paid, failed, pending, byMethod: { card, mpesa } }] }`

### 3. `GET /api/v1/analytics/attendance` (ADMIN, SUPER_ADMIN)

Attendance trends.

**Query params:** `from`, `to`, `granularity`

**Returns:**
- Time-series: `[{ period, checkIns, uniqueMembers }]`
- `peakDayOfWeek` — day with highest average check-ins
- `peakHour` — hour of day with most check-ins

### 4. `GET /api/v1/analytics/subscriptions` (ADMIN, SUPER_ADMIN)

Subscription trends.

**Query params:** `from`, `to`, `granularity`

**Returns:**
- Time-series: `[{ period, newSubscriptions, cancellations, expirations }]`
- `byPlan` — current active subscription count per plan
- `byPaymentMethod` — current breakdown by payment method
- `churnRate` — cancellations + expirations / total active (for the period)

### 5. `GET /api/v1/analytics/members` (ADMIN, SUPER_ADMIN)

Member growth trends.

**Query params:** `from`, `to`, `granularity`

**Returns:**
- Time-series: `[{ period, newMembers, totalMembers }]`
- `byRole` — current count per role
- `byStatus` — current count per status

## Shared Query DTO

```typescript
class AnalyticsQueryDto {
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @IsEnum(Granularity) granularity?: 'daily' | 'weekly' | 'monthly';
}
```

Default `from`: 12 months ago. Default `to`: now. Default `granularity`: monthly.

## Recent Activity Feed

Merges recent events from multiple tables:
- `User` — new registrations (`createdAt`, role = MEMBER)
- `Attendance` — check-ins (`checkInTime`)
- `Payment` — payment events (`createdAt`)
- `MemberSubscription` — new/cancelled subscriptions (`createdAt`/`updatedAt`)

Events are merged, sorted by timestamp descending, and limited to 20. Each event:

```typescript
{ type: 'registration' | 'check_in' | 'payment' | 'subscription', message: string, timestamp: Date, metadata: Record<string, any> }
```

## Architecture

- New `src/analytics/` module: controller + service
- Service injects `PrismaService` and uses Prisma aggregation queries
- No new database tables — all metrics derived from existing data
- Controller uses `JwtAuthGuard` + `RolesGuard` with `@Roles('ADMIN', 'SUPER_ADMIN')`
- Dashboard endpoint reads `@CurrentUser()` role to conditionally include financial data
- Revenue endpoint restricted to `@Roles('SUPER_ADMIN')` only

## Access Control Summary

| Endpoint | ADMIN | SUPER_ADMIN |
|---|---|---|
| Dashboard (operational metrics) | Yes | Yes |
| Dashboard (financial metrics) | No | Yes |
| Revenue | No | Yes |
| Attendance | Yes | Yes |
| Subscriptions | Yes | Yes |
| Members | Yes | Yes |
