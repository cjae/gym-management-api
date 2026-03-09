# Dashboard Analytics: WebSocket Activity Feed + API Alignment

## Overview

Align the analytics API with frontend expectations, add a new expiring-memberships endpoint, and replace the pull-based activity feed with a real-time WebSocket feed using Socket.IO.

## 1. Field Name Alignment (`GET /analytics/dashboard`)

Rename response fields to match frontend `DashboardStats` type:

| Current | New |
|---|---|
| `attendance.today` | `attendance.todayCheckIns` |
| `attendance.thisWeek` | `attendance.thisWeekCheckIns` |
| `attendance.avgDailyLast30Days` | `attendance.avgDaily30Days` |
| `payments.pendingLast30Days` | `payments.pendingCount30Days` |
| `payments.failedLast30Days` | `payments.failedCount30Days` |

Remove `recentActivity` from the dashboard response entirely (replaced by WebSocket).

## 2. New Endpoint: `GET /analytics/expiring-memberships`

- Access: ADMIN, SUPER_ADMIN
- Query active `MemberSubscription` with `endDate` within 14 days from now
- Join with `User` for `firstName + lastName` as `memberName`
- Join with `SubscriptionPlan` for `planName`
- Return `{ memberships: [...] }` sorted by `daysUntilExpiry` ASC, limit 20

Response shape:
```json
{
  "memberships": [
    {
      "memberId": "uuid",
      "memberName": "Jane Muthoni",
      "planName": "Premium Monthly",
      "expiresAt": "2026-03-15T00:00:00.000Z",
      "daysUntilExpiry": 6
    }
  ]
}
```

## 3. WebSocket Activity Feed

### Architecture

- `@nestjs/websockets` + `@nestjs/platform-socket.io` + `@nestjs/event-emitter`
- `ActivityGateway` in the analytics module, namespace `/activity`
- JWT auth on connection via handshake `auth.token` — reject non-ADMIN/SUPER_ADMIN
- Services emit domain events via `EventEmitter2`
- Gateway listens with `@OnEvent()` and broadcasts to connected admin clients

### Event Types

| Event name | Emitted from | Trigger |
|---|---|---|
| `activity.registration` | AuthService | Successful registration |
| `activity.check_in` | AttendanceService | Check-in created |
| `activity.payment` | PaymentsService | Payment status change |
| `activity.subscription` | SubscriptionsService | Subscription create/cancel |

### Event Payload

```typescript
{
  type: "registration" | "check_in" | "payment" | "subscription";
  description: string;
  timestamp: string; // ISO
  metadata?: Record<string, unknown>;
}
```

### Client Connection

```
connect(ws://host/activity, { auth: { token: "jwt..." } })
→ server validates JWT + checks ADMIN/SUPER_ADMIN role
→ server emits "activity" events as they happen
```

### Emitters (4 touchpoints)

- `AuthService.register()` — emit after user creation
- `AttendanceService.checkIn()` — emit after attendance record created
- `PaymentsService` — emit on payment status update (webhook handler)
- `SubscriptionsService` — emit on subscription create/cancel

## 4. Unchanged

- `GET /analytics/revenue` — no changes needed, fields already match
- `GET /analytics/attendance` — no changes
- `GET /analytics/subscriptions` — no changes
- `GET /analytics/members` — no changes
