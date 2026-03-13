import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateNotificationDto } from './dto/create-notification.dto';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly MAX_TOKENS_PER_USER = 5;
  private static readonly MAX_RETRIES = 3;
  private static readonly PUSH_CONCURRENCY = 5;
  private static readonly EXPO_CHUNK_SIZE = 100;
  private isProcessing = false;

  constructor(private prisma: PrismaService) {}

  async create(dto: CreateNotificationDto) {
    return this.prisma.$transaction(async (tx) => {
      const notification = await tx.notification.create({
        data: {
          userId: dto.userId,
          title: dto.title,
          body: dto.body,
          type: dto.type,
          metadata: dto.metadata as Prisma.InputJsonValue,
        },
      });

      await tx.pushJob.create({
        data: { notificationId: notification.id },
      });

      return notification;
    });
  }

  async findAllForUser(userId: string, page = 1, limit = 20) {
    const where = {
      OR: [{ userId }, { userId: null }], // User's notifications + broadcasts
    };

    const [notifications, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          reads: { where: { userId }, select: { id: true } },
        },
      }),
      this.prisma.notification.count({ where }),
    ]);

    // Merge read state: targeted notifications use isRead field,
    // broadcasts use the NotificationRead join table
    const data = notifications.map(({ reads, ...notification }) => ({
      ...notification,
      isRead: notification.userId ? notification.isRead : reads.length > 0,
    }));

    return { data, total, page, limit };
  }

  async findAllBroadcasts(page = 1, limit = 20) {
    const where = { userId: null };

    const [notifications, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          _count: { select: { reads: true } },
        },
      }),
      this.prisma.notification.count({ where }),
    ]);

    const data = notifications.map(({ _count, ...notification }) => ({
      ...notification,
      readCount: _count.reads,
    }));

    return { data, total, page, limit };
  }

  async markAsRead(id: string, userId: string) {
    // Check if this is a broadcast notification
    const notification = await this.prisma.notification.findFirst({
      where: {
        id,
        OR: [{ userId }, { userId: null }],
      },
    });

    if (!notification) return { count: 0 };

    if (notification.userId) {
      // Targeted notification — update the record directly
      return this.prisma.notification.updateMany({
        where: { id, userId },
        data: { isRead: true },
      });
    }

    // Broadcast — create a read receipt (upsert to avoid duplicates)
    await this.prisma.notificationRead.upsert({
      where: { notificationId_userId: { notificationId: id, userId } },
      create: { notificationId: id, userId },
      update: {},
    });
    return { count: 1 };
  }

  async markAllAsRead(userId: string) {
    // 1. Mark all targeted notifications as read
    const targetedResult = await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });

    // 2. Create read receipts for unread broadcasts in batches
    let broadcastCount = 0;
    const batchSize = 500;

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

  async registerPushToken(userId: string, token: string, platform: string) {
    const result = await this.prisma.pushToken.upsert({
      where: { token },
      create: { userId, token, platform },
      update: { userId, platform },
    });

    // Evict oldest tokens if user exceeds device limit
    const tokens = await this.prisma.pushToken.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });

    if (tokens.length > this.MAX_TOKENS_PER_USER) {
      const idsToDelete = tokens
        .slice(this.MAX_TOKENS_PER_USER)
        .map((t) => t.id);
      await this.prisma.pushToken.deleteMany({
        where: { id: { in: idsToDelete } },
      });
    }

    return result;
  }

  async removePushToken(token: string, userId: string) {
    return this.prisma.pushToken.deleteMany({
      where: { token, userId },
    });
  }

  /**
   * Poll Expo for push receipts and remove invalid tokens.
   * Runs every 30 minutes — Expo recommends waiting ~15min after sending.
   * Reads from PushTicket DB table, uses Map for O(1) lookups.
   */
  @Cron(CronExpression.EVERY_30_MINUTES, { timeZone: 'Africa/Nairobi' })
  async handlePushReceipts() {
    const tickets = await this.prisma.pushTicket.findMany({
      orderBy: { createdAt: 'asc' },
      take: 1000,
    });

    if (tickets.length === 0) return;

    try {
      const ticketMap = new Map(tickets.map((t) => [t.ticketId, t.pushToken]));
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

  @Cron('*/10 * * * * *', { timeZone: 'Africa/Nairobi' })
  async processPushJobs() {
    if (this.isProcessing) return;
    this.isProcessing = true;
    try {
      await this._processPushJobs();
    } finally {
      this.isProcessing = false;
    }
  }

  private async _processPushJobs() {
    const job = await this.prisma.pushJob.findFirst({
      where: { status: { in: ['PENDING', 'PROCESSING'] } },
      orderBy: { createdAt: 'asc' },
      include: {
        notification: {
          select: { userId: true, title: true, body: true, metadata: true },
        },
      },
    });

    if (!job) return;

    if (job.status === 'PENDING') {
      const { count } = await this.prisma.pushJob.updateMany({
        where: { id: job.id, status: 'PENDING' },
        data: { status: 'PROCESSING' },
      });
      if (count === 0) return; // Another instance claimed it
    }

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

    if (tokens.length === 0) {
      await this.prisma.pushJob.update({
        where: { id: job.id },
        data: { status: 'COMPLETED' },
      });
      await this.syncPushStats(job.notificationId, job.sent, job.failed);
      return;
    }

    try {
      const { sent, failed, tickets } = await this.sendPushBatch(
        tokens,
        job.notification.title,
        job.notification.body,
        job.notification.metadata as Record<string, unknown> | null,
      );

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
        await this.syncPushStats(
          job.notificationId,
          job.sent + sent,
          job.failed + failed,
        );
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
        await this.syncPushStats(job.notificationId, job.sent, job.failed);
      }
    }
  }

  private async syncPushStats(
    notificationId: string,
    sent: number,
    failed: number,
  ) {
    await this.prisma.notification.update({
      where: { id: notificationId },
      data: { pushSentCount: sent, pushFailedCount: failed },
    });
  }

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

    const chunks = this.chunkArray(
      messages,
      NotificationsService.EXPO_CHUNK_SIZE,
    );
    for (
      let i = 0;
      i < chunks.length;
      i += NotificationsService.PUSH_CONCURRENCY
    ) {
      const batch = chunks.slice(i, i + NotificationsService.PUSH_CONCURRENCY);
      const results = await Promise.all(
        batch.map(async (chunk, batchIndex) => {
          const response = await fetch('https://exp.host/--/api/v2/push/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(chunk),
          });

          const json = (await response.json()) as {
            data: { id?: string; status: string }[];
          };

          let chunkSent = 0;
          let chunkFailed = 0;
          const chunkTickets: { ticketId: string; pushToken: string }[] = [];

          const chunkOffset =
            (i + batchIndex) * NotificationsService.EXPO_CHUNK_SIZE;

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

          return {
            sent: chunkSent,
            failed: chunkFailed,
            tickets: chunkTickets,
          };
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

  @Cron(CronExpression.EVERY_DAY_AT_3AM, { timeZone: 'Africa/Nairobi' })
  async cleanupOldNotifications() {
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Delete old notifications (cascade handles read receipts)
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
      `Cleanup: ${notifications.count} notifications, ` +
        `${tickets.count} tickets, ${jobs.count} jobs deleted`,
    );
  }

  private chunkArray<T>(arr: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  }
}
