# Event Creation Notifications — Design

**Date:** 2026-03-31
**Status:** Approved

## Problem

When admins create new events (workshops, community days, etc.), members have no way to discover them unless they check the app. Events are one-off and time-sensitive — unlike recurring classes, they're easy to miss.

## Decision

Send in-app + push notifications to all MEMBER users when an admin creates a new event with `notifyMembers: true`.

## Design

### DTO Change

Add `notifyMembers` (boolean, optional, default `false`) to `CreateEventDto`. This is a transient field — not persisted on the Event model. Admins opt-in per event to avoid notification fatigue.

### Service Logic

After `prisma.event.create()`, if `dto.notifyMembers` is true:

1. Query all users with `role: MEMBER` and `deletedAt: null` (select id only)
2. For each member, call `notificationsService.create()`:
   - `userId`: member ID
   - `title`: "New Event: {title}"
   - `body`: "{date} at {startTime} — {location || 'TBA'}"
   - `type`: `NotificationType.EVENT_UPDATE`
   - `metadata`: `{ eventId }`
3. All calls fire-and-forget with `.catch(err => logger.error(...))`

New private method `notifyNewEvent(event)` follows the same pattern as existing `notifyEventUpdate()` and `notifyCancellation()`.

### Delivery

Existing infrastructure handles everything:
- `notificationsService.create()` auto-creates a `PushJob` per notification
- Background cron (every 10s) processes push jobs via Expo
- No new infrastructure needed

### Scope

**In scope:**
- `notifyMembers` flag on CreateEventDto
- `notifyNewEvent()` private method in EventsService
- Swagger docs for new field
- Unit tests (3 cases)

**Out of scope:**
- Reminder notifications (e.g. "event tomorrow")
- Notification preferences / opt-out
- Targeting by tags or subscription status
- Email notifications for new events (only in-app + push)

### Files Changed

- `src/events/dto/create-event.dto.ts` — add `notifyMembers` field
- `src/events/events.service.ts` — call `notifyNewEvent()` in `create()`, add private method
- `src/events/events.service.spec.ts` — 3 new tests
