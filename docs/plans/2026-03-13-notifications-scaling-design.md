# Notifications Scaling Design

**Date:** 2026-03-13
**Status:** Approved

## Problem

The notifications system has several scaling issues that will cause problems as the platform grows:

1. **`pendingTickets` in-memory array** — unbounded, lost on restart, re-queued indefinitely on failure
2. **Push delivery blocks HTTP response** — broadcast to thousands of tokens stalls the endpoint
3. **Unbounded token query for broadcasts** — loads entire PushToken table into memory (up to 10,000 cap)
4. **Sequential Expo API calls** — 50 chunks = 50 serial HTTP round-trips
5. **`markAllAsRead` unbounded query** — fetches all unread broadcasts with no limit
6. **No notification cleanup** — tables grow forever
7. **No concurrency guard** — parallel broadcasts double memory pressure
8. **O(n²) ticket lookup** — `Array.find()` in receipt polling

## Approach

Database-backed job queue using Prisma + `@nestjs/schedule`. No new infrastructure dependencies.

## Schema Changes

### New: `PushJobStatus` enum

```
enum PushJobStatus {
  PENDING
  PROCESSING
  COMPLETED
  FAILED
}
```

### New: `PushJob` table

Tracks push delivery as a resumable, cursor-based job.

```
PushJob {
  id              String        @id @default(uuid())
  notificationId  String        @unique
  status          PushJobStatus @default(PENDING)
  cursor          String?       // last processed PushToken ID
  batchSize       Int           @default(500)
  sent            Int           @default(0)
  failed          Int           @default(0)
  error           String?       // last error if FAILED
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt

  notification Notification @relation(fields: [notificationId], references: [id])
}
```

### New: `PushTicket` table

Replaces the in-memory `pendingTickets` array.

```
PushTicket {
  id        String   @id @default(uuid())
  ticketId  String   @unique
  pushToken String
  createdAt DateTime @default(now())
}
```

### Modified: `Notification`

- Add relation to `PushJob`
- Add `@@index([createdAt])` for cleanup cron

## Job Lifecycle

### `create()` Flow

1. Insert `Notification` row
2. Insert `PushJob(status: PENDING, notificationId)`
3. Return notification immediately (HTTP 201)

No push work happens during the request.

### Push Job Processor (every 10 seconds)

1. Find ONE `PushJob` where status = PENDING or PROCESSING (FIFO by createdAt)
2. Set status = PROCESSING
3. Fetch next 500 PushTokens using cursor-based pagination:
   - If job has a cursor: `WHERE id > cursor`
   - Broadcast: all tokens; Targeted: `WHERE userId = notification.userId`
   - `ORDER BY id ASC, TAKE 500`
4. Build Expo messages, send in chunks of 100 with bounded concurrency (max 5 parallel)
5. Batch-insert resulting tickets into `PushTicket` table
6. Update PushJob: `cursor = last token ID, sent += n, failed += n`
7. If fewer than 500 tokens returned (last page):
   - Set status = COMPLETED
   - Sync sent/failed counts to `Notification.pushSentCount` / `pushFailedCount`
8. After 3 consecutive failures on the same cursor, set status = FAILED with error message

**Key behaviors:**
- Only one job processes at a time
- Survives restarts — resumes from cursor
- Retries automatically from last position on transient failures

### Receipt Polling (every 30 minutes)

1. Fetch up to 1,000 `PushTicket` rows (oldest first)
2. Build a `Map<ticketId, pushToken>` for O(1) lookups
3. Call Expo `getReceipts` API (chunked by 1,000)
4. Collect `DeviceNotRegistered` tokens → delete from `PushToken`
5. Delete processed `PushTicket` rows
6. On Expo API failure, leave tickets for next cycle

### Cleanup Cron (daily, 3:00 AM EAT)

1. Delete `NotificationRead` rows where notification is older than 90 days
2. Delete `Notification` rows older than 90 days
3. Delete `PushTicket` rows older than 7 days (stale)
4. Delete COMPLETED/FAILED `PushJob` rows older than 30 days
5. Log deletion counts

### `markAllAsRead` Fix

Batch the unbounded query in pages of 500:

```
Loop:
  Fetch 500 unread broadcast IDs (no read receipt for user)
  createMany NotificationRead rows (skipDuplicates)
  Break if fewer than 500 returned
```

## `sendPush` Refactor

Used by the job processor (not called from `create()` anymore):

- Receives a batch of tokens (up to 500) instead of querying the DB itself
- Chunks into groups of 100, sends up to 5 chunks in parallel via `Promise.all`
- Returns `{ sent, failed, tickets }` — caller persists tickets and updates job

## What's NOT Changing

- Notification data model (title, body, type, metadata)
- Controller endpoints and DTOs
- Push token registration/removal
- Role-based access (ADMIN/SUPER_ADMIN for create/broadcasts)
- Expo Push API integration (just better batching)
