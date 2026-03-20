# Off-Peak Plans Design

## Overview

Support off-peak subscription plans where members pay a cheaper rate but are restricted to checking in during specific time windows. Off-peak hours are defined gym-wide; plans simply flag whether they are off-peak.

## Data Model

### New: GymSettings (singleton)

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| timezone | String | IANA timezone (default: `Africa/Nairobi`) |
| createdAt | DateTime | Auto |
| updatedAt | DateTime | Auto |

Singleton enforced at service level. Holds gym-wide configuration.

### New: OffPeakWindow

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| gymSettingsId | UUID | FK to GymSettings |
| dayOfWeek | DayOfWeek? | Null = applies every day |
| startTime | String | `HH:mm` 24h format (e.g., `"05:00"`) |
| endTime | String | `HH:mm` 24h format (e.g., `"10:00"`) |
| createdAt | DateTime | Auto |
| updatedAt | DateTime | Auto |

Multiple windows supported. Day-specific windows are additive with universal (null day) windows — on a given day, all matching windows apply. Overnight windows supported (startTime > endTime means crosses midnight).

### New: DayOfWeek enum

`MONDAY | TUESDAY | WEDNESDAY | THURSDAY | FRIDAY | SATURDAY | SUNDAY`

### Modified: SubscriptionPlan

Add `isOffPeak: Boolean @default(false)`.

## Check-in Enforcement

After validating the member has an active subscription in `attendance.service.ts`:

1. Load the subscription's plan
2. If `plan.isOffPeak` is `false` → proceed (no restriction)
3. If `plan.isOffPeak` is `true`:
   - Fetch GymSettings + off-peak windows (cached in-memory, invalidated on update)
   - Convert current UTC time to gym timezone
   - Determine current day of week
   - Collect applicable windows: day-specific for today + universal (`dayOfWeek = null`)
   - Check if current time falls within ANY window
   - If yes → proceed
   - If no → throw `BadRequestException` with message listing allowed windows

### Time Comparison

- Convert `HH:mm` strings to minutes-since-midnight
- Current time also converted to minutes-since-midnight in gym timezone
- Overnight windows (start > end): current >= start OR current < end
- Use `Intl.DateTimeFormat` for timezone conversion (no external library)

## API Endpoints

### New: gym-settings module

| Method | Endpoint | Role | Description |
|--------|----------|------|-------------|
| GET | `/api/v1/gym-settings` | ADMIN, SUPER_ADMIN | Get settings with off-peak windows |
| PUT | `/api/v1/gym-settings` | SUPER_ADMIN | Upsert gym settings (timezone) |
| POST | `/api/v1/gym-settings/off-peak-windows` | SUPER_ADMIN | Add off-peak window |
| DELETE | `/api/v1/gym-settings/off-peak-windows/:id` | SUPER_ADMIN | Remove off-peak window |

### Modified: subscription-plans

- `POST` and `PATCH` accept optional `isOffPeak: boolean`
- All GET responses include `isOffPeak` field

### No changes to attendance endpoints

Enforcement is internal. Check-in returns existing success/error shape, just a new error case.

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| No GymSettings + off-peak check-in | Deny: "Off-peak hours not configured" |
| No windows defined + off-peak check-in | Deny: no windows = no allowed times |
| Duo subscriptions | Both members inherit plan's isOffPeak, both restricted |
| Frozen subscription | Freeze check blocks before off-peak check (no change) |
| Plan toggled off-peak ↔ regular | Immediate effect on next check-in (isOffPeak lives on plan, not subscription) |

## Caching

Cache GymSettings + windows in a service-level variable. Invalidate on any PUT/POST/DELETE to gym-settings. Off-peak windows change rarely but are checked on every off-peak member check-in.

## Seed Data

- Default GymSettings: `timezone: "Africa/Nairobi"`
- Two off-peak windows (all days): `06:00–10:00`, `14:00–17:00`
- One off-peak plan: "Off-Peak Monthly" at discounted KES price
