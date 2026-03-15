# Events Module Design

**Date**: 2026-03-15
**Status**: Approved

## Overview

Add an Events module to support one-off, date-specific activities (special classes, community/outdoor events, workshops/seminars). Events appear alongside recurring classes on the member's schedule calendar but are fetched via separate endpoints — the mobile app merges them client-side.

## Data Model

```prisma
model Event {
  id          String   @id @default(uuid())
  title       String
  description String?
  date        DateTime // specific date (stored as midnight UTC)
  startTime   String   // HH:mm 24h format
  endTime     String   // HH:mm 24h format
  location    String?  // e.g. "Outdoor field", "Studio B", "Community hall"
  maxCapacity Int      @default(50)
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  enrollments EventEnrollment[]
}

model EventEnrollment {
  id         String   @id @default(uuid())
  eventId    String
  memberId   String
  enrolledAt DateTime @default(now())

  event  Event @relation(fields: [eventId], references: [id])
  member User  @relation(fields: [memberId], references: [id])

  @@unique([eventId, memberId])
}
```

Key differences from GymClass: `date` (specific DateTime) replaces `dayOfWeek` (recurring int), `location` field added (events can be off-site), no `trainerId`.

## API Endpoints

```
POST   /api/v1/events              — Create event (ADMIN, SUPER_ADMIN)
GET    /api/v1/events              — List upcoming active events (paginated, any authenticated user)
GET    /api/v1/events/my           — Get events I'm enrolled in (any authenticated user)
GET    /api/v1/events/:id          — Get event details (any authenticated user)
PATCH  /api/v1/events/:id          — Update event (ADMIN, SUPER_ADMIN)
DELETE /api/v1/events/:id          — Soft-delete/deactivate (ADMIN, SUPER_ADMIN)
POST   /api/v1/events/:id/enroll   — Enroll in event (MEMBER)
POST   /api/v1/events/:id/unenroll — Leave event (MEMBER)
GET    /api/v1/events/:id/enrollments — List enrolled members (ADMIN, SUPER_ADMIN)
```

Mirrors gym-classes pattern. `GET /events` defaults to upcoming events (date >= today), sorted by date ASC then startTime ASC.

## Business Rules

1. **Capacity enforcement** — enrollment blocked when `maxCapacity` reached
2. **No past enrollment** — can't enroll in events where `date` is in the past
3. **No past unenrollment** — can't unenroll from events that have already happened
4. **Email notifications** — notify enrolled members when event details change (time/date/location) or event is cancelled
5. **Soft delete** — deactivating an event sends cancellation emails to all enrolled members
6. **Validation** — end time must be after start time, date must be in the future when creating
7. **No time overlap validation** — unlike classes, events are one-off so overlaps are fine (a gym can run multiple events on the same day)

## Events Are Free

All events are free for members. No payment integration needed.

## Design Decisions

- **Separate endpoints** (not a unified `/schedule`) — classes and events have different data shapes (recurring vs one-off). Mobile app fetches both and merges on the calendar client-side.
- **Standalone module** (not a generalized "schedulable" abstraction) — follows existing module pattern, no refactoring of working gym-classes code. Minimal duplication (~30 lines of enrollment/capacity logic).
- **No trainer assignment** — events don't need a dedicated trainer relation.
