# Notifications Scaling Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all scaling issues in the notifications system by replacing in-memory push delivery with a database-backed job queue.

**Architecture:** Push delivery is decoupled from the HTTP request via a `PushJob` table. A 10-second cron processes jobs in cursor-based batches of 500 tokens. Receipt tracking moves from an in-memory array to a `PushTicket` table. A daily cleanup cron prevents unbounded table growth.

**Tech Stack:** Prisma 6 (schema + migrations), NestJS `@nestjs/schedule` (crons), Expo Push API (notifications), Jest (unit tests)

**Design doc:** `docs/plans/2026-03-13-notifications-scaling-design.md`

---

### Task 1: Add PushJob and PushTicket Schema

**Files:**
- Modify: `prisma/schema.prisma`

**Step 1: Add the PushJobStatus enum and PushJob model after the Notification model**

Add after the `Notification` model's closing `}` (after line ~364):

```prisma
enum PushJobStatus {
  PENDING
  PROCESSING
  COMPLETED
  FAILED
}

model PushJob {
  id             String        @id @default(uuid())
  notificationId String        @unique
  status         PushJobStatus @default(PENDING)
  cursor         String?
  batchSize      Int           @default(500)
  sent           Int           @default(0)
  failed         Int           @default(0)
  retries        Int           @default(0)
  error          String?
  createdAt      DateTime      @default(now())
  updatedAt      DateTime      @updatedAt

  notification Notification @relation(fields: [notificationId], references: [id])

  @@index([status, createdAt])
}
```

**Step 2: Add the PushTicket model after PushJob**

```prisma
model PushTicket {
  id        String   @id @default(uuid())
  ticketId  String   @unique
  pushToken String
  createdAt DateTime @default(now())

  @@index([createdAt])
}
```

**Step 3: Add the `pushJob` relation to the Notification model**

In the `Notification` model, add after `reads NotificationRead[]`:

```prisma
  pushJob PushJob?
```

**Step 4: Add createdAt index to Notification model**

In the `Notification` model, add after `@@index([userId, createdAt])`:

```prisma
  @@index([createdAt])
```

**Step 5: Run the migration**

```bash
npx prisma migrate dev --name add-push-job-and-push-ticket
```

**Step 6: Commit**

```bash
git add prisma/
git commit -m "feat(notifications): add PushJob and PushTicket schema for job queue"
```

---

### Task 2: Refactor create() to Insert PushJob Instead of Sending Push

**Files:**
- Modify: `src/notifications/notifications.service.ts`
- Create: `src/notifications/notifications.service.spec.ts`

**Step 1: Write the failing test for create()**

Create `src/notifications/notifications.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../prisma/prisma.service';

describe('NotificationsService', () => {
  let service: NotificationsService;

  const mockNotification = {
    id: 'notif-1',
    userId: null,
    title: 'Test',
    body: 'Test body',
    type: 'GENERAL',
    isRead: false,
    metadata: null,
    pushSentCount: 0,
    pushFailedCount: 0,
    createdAt: new Date(),
  };

  const mockPushJob = {
    id: 'job-1',
    notificationId: 'notif-1',
    status: 'PENDING',
    cursor: null,
    batchSize: 500,
    sent: 0,
    failed: 0,
    retries: 0,
    error: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockPrisma = {
    notification: {
      create: jest.fn().mockResolvedValue(mockNotification),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn(),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    pushJob: {
      create: jest.fn().mockResolvedValue(mockPushJob),
      findFirst: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    pushToken: {
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn(),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    pushTicket: {
      findMany: jest.fn().mockResolvedValue([]),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    notificationRead: {
      upsert: jest.fn(),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
  });

  describe('create', () => {
    it('should create notification and a PENDING push job', async () => {
      const dto = {
        title: 'Test',
        body: 'Test body',
        type: 'GENERAL' as const,
      };

      const result = await service.create(dto);

      expect(mockPrisma.notification.create).toHaveBeenCalledWith({
        data: {
          userId: undefined,
          title: 'Test',
          body: 'Test body',
          type: 'GENERAL',
          metadata: undefined,
        },
      });
      expect(mockPrisma.pushJob.create).toHaveBeenCalledWith({
        data: { notificationId: 'notif-1' },
      });
      expect(result).toEqual(mockNotification);
    });

    it('should create targeted notification with userId', async () => {
      const dto = {
        userId: 'user-1',
        title: 'Hello',
        body: 'Personal message',
        type: 'GENERAL' as const,
      };

      await service.create(dto);

      expect(mockPrisma.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ userId: 'user-1' }),
      });
      expect(mockPrisma.pushJob.create).toHaveBeenCalled();
    });
  });
});
```

**Step 2: Run test to verify it fails**

```bash
yarn test -- --testPathPattern=notifications.service
```

Expected: FAIL — `create()` currently calls `sendPush()` instead of `pushJob.create`.

**Step 3: Rewrite the `create()` method**

In `src/notifications/notifications.service.ts`, replace the entire `create()` method:

```typescript
  async create(dto: CreateNotificationDto) {
    const notification = await this.prisma.notification.create({
      data: {
        userId: dto.userId,
        title: dto.title,
        body: dto.body,
        type: dto.type,
        metadata: dto.metadata as Prisma.InputJsonValue,
      },
    });

    await this.prisma.pushJob.create({
      data: { notificationId: notification.id },
    });

    return notification;
  }
```

**Step 4: Remove the `pendingTickets` in-memory array**

Remove this line from the class:

```typescript
  private pendingTickets: { ticketId: string; pushToken: string }[] = [];
```

**Step 5: Run test to verify it passes**

```bash
yarn test -- --testPathPattern=notifications.service
```

Expected: PASS

**Step 6: Commit**

```bash
git add src/notifications/notifications.service.ts src/notifications/notifications.service.spec.ts
git commit -m "feat(notifications): decouple push delivery from create() via PushJob"
```

---

### Task 3: Implement the Push Job Processor Cron

**Files:**
- Modify: `src/notifications/notifications.service.ts`
- Modify: `src/notifications/notifications.service.spec.ts`

**Step 1: Write failing tests for processPushJobs()**

Add to `notifications.service.spec.ts`:

```typescript
  describe('processPushJobs', () => {
    it('should skip when no pending jobs exist', async () => {
      mockPrisma.pushJob.findFirst.mockResolvedValue(null);

      await service.processPushJobs();

      expect(mockPrisma.pushToken.findMany).not.toHaveBeenCalled();
    });

    it('should process a batch of tokens and update job progress', async () => {
      const job = {
        id: 'job-1',
        notificationId: 'notif-1',
        status: 'PENDING',
        cursor: null,
        batchSize: 500,
        sent: 0,
        failed: 0,
        retries: 0,
        notification: { userId: null },
      };
      mockPrisma.pushJob.findFirst.mockResolvedValue(job);
      mockPrisma.pushToken.findMany.mockResolvedValue([
        { id: 'tok-1', token: 'ExponentPushToken[aaa]' },
        { id: 'tok-2', token: 'ExponentPushToken[bbb]' },
      ]);

      // Mock global fetch
      const mockResponse = {
        json: jest.fn().mockResolvedValue({
          data: [
            { id: 'ticket-1', status: 'ok' },
            { id: 'ticket-2', status: 'ok' },
          ],
        }),
      };
      global.fetch = jest.fn().mockResolvedValue(mockResponse);

      await service.processPushJobs();

      // Should mark as PROCESSING first
      expect(mockPrisma.pushJob.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'job-1' },
          data: expect.objectContaining({ status: 'PROCESSING' }),
        }),
      );
      // Should save tickets to DB
      expect(mockPrisma.pushTicket.createMany).toHaveBeenCalled();
      // Should update job with cursor and counts — COMPLETED since < batchSize
      expect(mockPrisma.pushJob.update).toHaveBeenLastCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'COMPLETED',
            cursor: 'tok-2',
            sent: 2,
            failed: 0,
            retries: 0,
          }),
        }),
      );
    });

    it('should use cursor for resuming interrupted jobs', async () => {
      const job = {
        id: 'job-1',
        notificationId: 'notif-1',
        status: 'PROCESSING',
        cursor: 'tok-5',
        batchSize: 500,
        sent: 5,
        failed: 0,
        retries: 0,
        notification: { userId: null },
      };
      mockPrisma.pushJob.findFirst.mockResolvedValue(job);
      mockPrisma.pushToken.findMany.mockResolvedValue([]);

      await service.processPushJobs();

      // Should query tokens after cursor
      expect(mockPrisma.pushToken.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: { gt: 'tok-5' },
          }),
        }),
      );
    });

    it('should mark job FAILED after 3 retries', async () => {
      const job = {
        id: 'job-1',
        notificationId: 'notif-1',
        status: 'PROCESSING',
        cursor: 'tok-3',
        batchSize: 500,
        sent: 3,
        failed: 0,
        retries: 2,
        notification: { userId: null },
      };
      mockPrisma.pushJob.findFirst.mockResolvedValue(job);
      mockPrisma.pushToken.findMany.mockResolvedValue([
        { id: 'tok-4', token: 'ExponentPushToken[ddd]' },
      ]);
      global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

      await service.processPushJobs();

      expect(mockPrisma.pushJob.update).toHaveBeenLastCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'FAILED',
            error: 'Network error',
          }),
        }),
      );
    });
  });
```

**Step 2: Run test to verify it fails**

```bash
yarn test -- --testPathPattern=notifications.service
```

Expected: FAIL — `processPushJobs` does not exist yet.

**Step 3: Implement processPushJobs()**

Add to `NotificationsService` class in `notifications.service.ts`:

```typescript
  private static readonly MAX_RETRIES = 3;
  private static readonly PUSH_CONCURRENCY = 5;

  @Cron('*/10 * * * * *', { timeZone: 'Africa/Nairobi' })
  async processPushJobs() {
    const job = await this.prisma.pushJob.findFirst({
      where: { status: { in: ['PENDING', 'PROCESSING'] } },
      orderBy: { createdAt: 'asc' },
      include: { notification: { select: { userId: true } } },
    });

    if (!job) return;

    // Mark as PROCESSING
    if (job.status === 'PENDING') {
      await this.prisma.pushJob.update({
        where: { id: job.id },
        data: { status: 'PROCESSING' },
      });
    }

    // Build token query with cursor
    const tokenWhere: Record<string, unknown> = {};
    if (job.notification.userId) {
      tokenWhere.userId = job.notification.userId;
    }
    if (job.cursor) {
      tokenWhere.id = { gt: job.cursor };
    }

    const tokens = await this.prisma.pushToken.findMany({
      where: tokenWhere,
      orderBy: { id: 'asc' },
      take: job.batchSize,
      select: { id: true, token: true },
    });

    // No more tokens — job is complete
    if (tokens.length === 0) {
      await this.prisma.pushJob.update({
        where: { id: job.id },
        data: { status: 'COMPLETED' },
      });
      await this.syncPushStats(job.id);
      return;
    }

    try {
      const { sent, failed, tickets } = await this.sendPushBatch(tokens);

      // Persist tickets for receipt polling
      if (tickets.length > 0) {
        await this.prisma.pushTicket.createMany({
          data: tickets,
          skipDuplicates: true,
        });
      }

      const lastCursor = tokens[tokens.length - 1].id;
      const isLastBatch = tokens.length < job.batchSize;

      await this.prisma.pushJob.update({
        where: { id: job.id },
        data: {
          cursor: lastCursor,
          sent: job.sent + sent,
          failed: job.failed + failed,
          retries: 0,
          ...(isLastBatch ? { status: 'COMPLETED' } : {}),
        },
      });

      if (isLastBatch) {
        await this.syncPushStats(job.id);
      }
    } catch (err) {
      const retries = job.retries + 1;
      const isFatal = retries >= NotificationsService.MAX_RETRIES;

      await this.prisma.pushJob.update({
        where: { id: job.id },
        data: {
          retries,
          ...(isFatal
            ? {
                status: 'FAILED',
                error: err instanceof Error ? err.message : 'Unknown error',
              }
            : {}),
        },
      });

      if (isFatal) {
        this.logger.error(`Push job ${job.id} failed permanently`, err);
        await this.syncPushStats(job.id);
      }
    }
  }

  private async syncPushStats(jobId: string) {
    const job = await this.prisma.pushJob.findFirst({ where: { id: jobId } });
    if (!job) return;
    await this.prisma.notification.update({
      where: { id: job.notificationId },
      data: { pushSentCount: job.sent, pushFailedCount: job.failed },
    });
  }
```

**Step 4: Implement sendPushBatch() — replaces old sendPush()**

Replace the old `sendPush()` method with:

```typescript
  private async sendPushBatch(
    tokens: { id: string; token: string }[],
  ): Promise<{
    sent: number;
    failed: number;
    tickets: { ticketId: string; pushToken: string }[];
  }> {
    // This method is called from processPushJobs which already has
    // the notification context. We receive pre-built messages.
    // Actually, we need title/body — let's adjust the signature.
    throw new Error('Not implemented');
  }
```

Wait — `sendPushBatch` needs the notification title/body. Let me adjust. The processor should pass them. Let me revise `processPushJobs` to fetch the notification and update `sendPushBatch` accordingly:

Replace the `sendPushBatch` stub and update `processPushJobs` to pass title/body:

In `processPushJobs`, after fetching tokens, change the `sendPushBatch` call:

```typescript
      const { sent, failed, tickets } = await this.sendPushBatch(
        tokens,
        job.notification.title,
        job.notification.body,
        job.notification.metadata as Record<string, unknown> | null,
      );
```

And update the `findFirst` include to get title/body/metadata:

```typescript
      include: { notification: { select: { userId: true, title: true, body: true, metadata: true } } },
```

Then implement `sendPushBatch`:

```typescript
  private async sendPushBatch(
    tokens: { id: string; token: string }[],
    title: string,
    body: string,
    metadata?: Record<string, unknown> | null,
  ): Promise<{
    sent: number;
    failed: number;
    tickets: { ticketId: string; pushToken: string }[];
  }> {
    const messages = tokens.map((t) => ({
      to: t.token,
      sound: 'default' as const,
      title,
      body,
      data: metadata ?? {},
    }));

    let sent = 0;
    let failed = 0;
    const tickets: { ticketId: string; pushToken: string }[] = [];

    const chunks = this.chunkArray(messages, 100);
    // Bounded concurrency: process up to PUSH_CONCURRENCY chunks in parallel
    for (
      let i = 0;
      i < chunks.length;
      i += NotificationsService.PUSH_CONCURRENCY
    ) {
      const batch = chunks.slice(i, i + NotificationsService.PUSH_CONCURRENCY);
      const results = await Promise.all(
        batch.map(async (chunk, batchIndex) => {
          const response = await fetch(
            'https://exp.host/--/api/v2/push/send',
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(chunk),
            },
          );

          const json = (await response.json()) as {
            data: { id?: string; status: string }[];
          };

          let chunkSent = 0;
          let chunkFailed = 0;
          const chunkTickets: { ticketId: string; pushToken: string }[] = [];

          // Calculate offset into original messages array
          const chunkOffset = (i + batchIndex) * 100;

          for (let j = 0; j < json.data.length; j++) {
            const ticket = json.data[j];
            if (ticket.status === 'ok') {
              chunkSent++;
              if (ticket.id) {
                chunkTickets.push({
                  ticketId: ticket.id,
                  pushToken: tokens[chunkOffset + j].token,
                });
              }
            } else {
              chunkFailed++;
            }
          }

          return { sent: chunkSent, failed: chunkFailed, tickets: chunkTickets };
        }),
      );

      for (const result of results) {
        sent += result.sent;
        failed += result.failed;
        tickets.push(...result.tickets);
      }
    }

    return { sent, failed, tickets };
  }
```

**Step 5: Remove the old `sendPush()` method**

Delete the old `sendPush()` private method entirely.

**Step 6: Run tests to verify they pass**

```bash
yarn test -- --testPathPattern=notifications.service
```

Expected: PASS

**Step 7: Commit**

```bash
git add src/notifications/notifications.service.ts src/notifications/notifications.service.spec.ts
git commit -m "feat(notifications): add push job processor cron with cursor pagination"
```

---

### Task 4: Refactor Receipt Handling to Use PushTicket Table

**Files:**
- Modify: `src/notifications/notifications.service.ts`
- Modify: `src/notifications/notifications.service.spec.ts`

**Step 1: Write failing tests for handlePushReceipts()**

Add to `notifications.service.spec.ts`:

```typescript
  describe('handlePushReceipts', () => {
    it('should skip when no push tickets exist', async () => {
      mockPrisma.pushTicket.findMany.mockResolvedValue([]);

      await service.handlePushReceipts();

      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should delete invalid tokens from DeviceNotRegistered receipts', async () => {
      mockPrisma.pushTicket.findMany.mockResolvedValue([
        { id: 'pt-1', ticketId: 'ticket-1', pushToken: 'ExponentPushToken[aaa]' },
        { id: 'pt-2', ticketId: 'ticket-2', pushToken: 'ExponentPushToken[bbb]' },
      ]);

      global.fetch = jest.fn().mockResolvedValue({
        json: jest.fn().mockResolvedValue({
          data: {
            'ticket-1': { status: 'ok' },
            'ticket-2': {
              status: 'error',
              details: { error: 'DeviceNotRegistered' },
            },
          },
        }),
      });

      await service.handlePushReceipts();

      // Should delete the invalid push token
      expect(mockPrisma.pushToken.deleteMany).toHaveBeenCalledWith({
        where: { token: { in: ['ExponentPushToken[bbb]'] } },
      });
      // Should delete processed tickets
      expect(mockPrisma.pushTicket.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['pt-1', 'pt-2'] } },
      });
    });
  });
```

**Step 2: Run test to verify it fails**

```bash
yarn test -- --testPathPattern=notifications.service
```

**Step 3: Rewrite handlePushReceipts()**

Replace the existing `handlePushReceipts()` method:

```typescript
  @Cron(CronExpression.EVERY_30_MINUTES, { timeZone: 'Africa/Nairobi' })
  async handlePushReceipts() {
    const tickets = await this.prisma.pushTicket.findMany({
      orderBy: { createdAt: 'asc' },
      take: 1000,
    });

    if (tickets.length === 0) return;

    try {
      const ticketMap = new Map(
        tickets.map((t) => [t.ticketId, t.pushToken]),
      );
      const ticketIds = tickets.map((t) => t.ticketId);
      const invalidTokens: string[] = [];

      const chunks = this.chunkArray(ticketIds, 1000);
      for (const chunk of chunks) {
        const response = await fetch(
          'https://exp.host/--/api/v2/push/getReceipts',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: chunk }),
          },
        );

        const json = (await response.json()) as {
          data: Record<
            string,
            { status: string; details?: { error?: string } }
          >;
        };

        for (const [ticketId, receipt] of Object.entries(json.data)) {
          if (
            receipt.status === 'error' &&
            receipt.details?.error === 'DeviceNotRegistered'
          ) {
            const pushToken = ticketMap.get(ticketId);
            if (pushToken) invalidTokens.push(pushToken);
          }
        }
      }

      if (invalidTokens.length > 0) {
        const result = await this.prisma.pushToken.deleteMany({
          where: { token: { in: invalidTokens } },
        });
        this.logger.log(`Removed ${result.count} invalid push tokens`);
      }

      // Delete processed tickets regardless of outcome
      await this.prisma.pushTicket.deleteMany({
        where: { id: { in: tickets.map((t) => t.id) } },
      });
    } catch (err) {
      this.logger.error('Failed to process push receipts', err);
      // Leave tickets for next cycle
    }
  }
```

**Step 4: Run tests**

```bash
yarn test -- --testPathPattern=notifications.service
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/notifications/notifications.service.ts src/notifications/notifications.service.spec.ts
git commit -m "refactor(notifications): receipt polling uses PushTicket table with Map lookup"
```

---

### Task 5: Fix markAllAsRead Unbounded Query

**Files:**
- Modify: `src/notifications/notifications.service.ts`
- Modify: `src/notifications/notifications.service.spec.ts`

**Step 1: Write failing test**

Add to `notifications.service.spec.ts`:

```typescript
  describe('markAllAsRead', () => {
    it('should batch broadcast read receipts in pages of 500', async () => {
      mockPrisma.notification.updateMany.mockResolvedValue({ count: 0 });
      // First call: 500 results (full page — loop continues)
      // Second call: 200 results (partial page — loop ends)
      mockPrisma.notification.findMany
        .mockResolvedValueOnce(
          Array.from({ length: 500 }, (_, i) => ({ id: `notif-${i}` })),
        )
        .mockResolvedValueOnce(
          Array.from({ length: 200 }, (_, i) => ({ id: `notif-${500 + i}` })),
        );
      mockPrisma.notificationRead.createMany.mockResolvedValue({ count: 0 });

      await service.markAllAsRead('user-1');

      // Should have been called twice for broadcast batching
      expect(mockPrisma.notification.findMany).toHaveBeenCalledTimes(2);
      expect(mockPrisma.notificationRead.createMany).toHaveBeenCalledTimes(2);
    });
  });
```

**Step 2: Run test to verify it fails**

```bash
yarn test -- --testPathPattern=notifications.service
```

Expected: FAIL — current implementation does a single unbounded query.

**Step 3: Rewrite markAllAsRead() with batching**

```typescript
  async markAllAsRead(userId: string) {
    // 1. Mark all targeted notifications as read
    const targetedResult = await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });

    // 2. Create read receipts for unread broadcasts in batches
    let broadcastCount = 0;
    const batchSize = 500;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const unreadBroadcasts = await this.prisma.notification.findMany({
        where: {
          userId: null,
          reads: { none: { userId } },
        },
        select: { id: true },
        take: batchSize,
      });

      if (unreadBroadcasts.length === 0) break;

      const result = await this.prisma.notificationRead.createMany({
        data: unreadBroadcasts.map((n) => ({
          notificationId: n.id,
          userId,
        })),
        skipDuplicates: true,
      });

      broadcastCount += result.count;

      if (unreadBroadcasts.length < batchSize) break;
    }

    return { count: targetedResult.count + broadcastCount };
  }
```

**Step 4: Run tests**

```bash
yarn test -- --testPathPattern=notifications.service
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/notifications/notifications.service.ts src/notifications/notifications.service.spec.ts
git commit -m "fix(notifications): batch markAllAsRead to prevent unbounded queries"
```

---

### Task 6: Add Cleanup Cron

**Files:**
- Modify: `src/notifications/notifications.service.ts`
- Modify: `src/notifications/notifications.service.spec.ts`

**Step 1: Write failing test**

Add to `notifications.service.spec.ts`:

```typescript
  describe('cleanupOldNotifications', () => {
    it('should delete old notifications, reads, tickets, and jobs', async () => {
      mockPrisma.notificationRead.deleteMany.mockResolvedValue({ count: 5 });
      mockPrisma.notification.deleteMany.mockResolvedValue({ count: 3 });
      mockPrisma.pushTicket.deleteMany.mockResolvedValue({ count: 10 });
      mockPrisma.pushJob.deleteMany.mockResolvedValue({ count: 2 });

      await service.cleanupOldNotifications();

      // Should delete reads for old notifications
      expect(mockPrisma.notificationRead.deleteMany).toHaveBeenCalledWith({
        where: {
          notification: {
            createdAt: { lt: expect.any(Date) },
          },
        },
      });
      // Should delete old notifications
      expect(mockPrisma.notification.deleteMany).toHaveBeenCalledWith({
        where: { createdAt: { lt: expect.any(Date) } },
      });
      // Should delete stale push tickets
      expect(mockPrisma.pushTicket.deleteMany).toHaveBeenCalledWith({
        where: { createdAt: { lt: expect.any(Date) } },
      });
      // Should delete completed/failed push jobs
      expect(mockPrisma.pushJob.deleteMany).toHaveBeenCalledWith({
        where: {
          status: { in: ['COMPLETED', 'FAILED'] },
          updatedAt: { lt: expect.any(Date) },
        },
      });
    });
  });
```

**Step 2: Run test to verify it fails**

```bash
yarn test -- --testPathPattern=notifications.service
```

**Step 3: Implement cleanupOldNotifications()**

Add to `NotificationsService`:

```typescript
  @Cron(CronExpression.EVERY_DAY_AT_3AM, { timeZone: 'Africa/Nairobi' })
  async cleanupOldNotifications() {
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Delete read receipts for old notifications first (FK constraint)
    const reads = await this.prisma.notificationRead.deleteMany({
      where: {
        notification: {
          createdAt: { lt: ninetyDaysAgo },
        },
      },
    });

    // Delete old notifications (PushJob cascades via FK or delete separately)
    const notifications = await this.prisma.notification.deleteMany({
      where: { createdAt: { lt: ninetyDaysAgo } },
    });

    // Delete stale push tickets (Expo won't have receipts after 7 days)
    const tickets = await this.prisma.pushTicket.deleteMany({
      where: { createdAt: { lt: sevenDaysAgo } },
    });

    // Delete completed/failed jobs older than 30 days
    const jobs = await this.prisma.pushJob.deleteMany({
      where: {
        status: { in: ['COMPLETED', 'FAILED'] },
        updatedAt: { lt: thirtyDaysAgo },
      },
    });

    this.logger.log(
      `Cleanup: ${reads.count} reads, ${notifications.count} notifications, ` +
        `${tickets.count} tickets, ${jobs.count} jobs deleted`,
    );
  }
```

**Step 4: Run tests**

```bash
yarn test -- --testPathPattern=notifications.service
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/notifications/notifications.service.ts src/notifications/notifications.service.spec.ts
git commit -m "feat(notifications): add daily cleanup cron for old notifications and jobs"
```

---

### Task 7: Update Response DTOs and Run Full Test Suite

**Files:**
- Modify: `src/notifications/dto/notification-response.dto.ts`
- Modify: `src/notifications/notifications.controller.ts` (Swagger description update)

**Step 1: Update NotificationResponseDto**

The `pushSentCount` and `pushFailedCount` are still on the `Notification` model and still returned — no DTO changes needed. However, the `create` endpoint Swagger description should note that push counts will be `0` initially:

In `notifications.controller.ts`, update the `@ApiCreatedResponse` description:

```typescript
  @ApiCreatedResponse({
    description: 'Notification created. Push delivery is processed asynchronously — pushSentCount/pushFailedCount update once delivery completes.',
    type: NotificationResponseDto,
  })
```

**Step 2: Run full test suite**

```bash
yarn test
```

Expected: All tests pass (existing tests in other modules should be unaffected).

**Step 3: Run lint**

```bash
yarn lint
```

**Step 4: Commit**

```bash
git add src/notifications/
git commit -m "docs(notifications): update Swagger to reflect async push delivery"
```

---

### Task 8: Verify PushJob Cascade Deletion

**Files:**
- Modify: `prisma/schema.prisma` (if needed)

**Step 1: Check that deleting a Notification cascades to PushJob**

Prisma does NOT cascade by default. The `cleanupOldNotifications` cron deletes notifications, but the FK on `PushJob.notificationId` will block deletion if a PushJob still exists.

Add `onDelete: Cascade` to the PushJob relation:

In `prisma/schema.prisma`, update the PushJob model's notification relation:

```prisma
  notification Notification @relation(fields: [notificationId], references: [id], onDelete: Cascade)
```

Also add `onDelete: Cascade` to NotificationRead if not already present:

```prisma
  notification Notification @relation(fields: [notificationId], references: [id], onDelete: Cascade)
```

**Step 2: Run migration**

```bash
npx prisma migrate dev --name add-cascade-deletes
```

**Step 3: Run full test suite**

```bash
yarn test
```

**Step 4: Commit**

```bash
git add prisma/
git commit -m "fix(notifications): add cascade deletes for PushJob and NotificationRead"
```

---

### Task 9: Final Integration Check

**Step 1: Start dev server and verify no startup errors**

```bash
yarn start:dev
```

Verify: Server starts on port 3000, no errors related to missing Prisma models.

**Step 2: Verify Swagger docs reflect changes**

Open `http://localhost:3000/api/docs` — check `POST /api/v1/notifications` shows updated description.

**Step 3: Run full test suite one more time**

```bash
yarn test
yarn lint
```

**Step 4: Final commit if any remaining changes**

```bash
git add -A
git commit -m "chore(notifications): final cleanup after scaling refactor"
```
