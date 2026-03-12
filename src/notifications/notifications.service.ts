import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateNotificationDto } from './dto/create-notification.dto';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly MAX_TOKENS_PER_USER = 5;

  // In-memory buffer of ticket IDs to check for receipts
  private pendingTickets: { ticketId: string; pushToken: string }[] = [];

  constructor(private prisma: PrismaService) {}

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

    // Send push notification
    await this.sendPush(dto.userId ?? null, dto.title, dto.body, dto.metadata);

    return notification;
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
      isRead: notification.userId
        ? notification.isRead
        : reads.length > 0,
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
    const targeted = this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });

    // 2. Create read receipts for unread broadcasts
    const unreadBroadcasts = await this.prisma.notification.findMany({
      where: {
        userId: null,
        reads: { none: { userId } },
      },
      select: { id: true },
    });

    const broadcastReads = unreadBroadcasts.length > 0
      ? this.prisma.notificationRead.createMany({
          data: unreadBroadcasts.map((n) => ({
            notificationId: n.id,
            userId,
          })),
          skipDuplicates: true,
        })
      : Promise.resolve({ count: 0 });

    const [targetedResult, broadcastResult] = await Promise.all([
      targeted,
      broadcastReads,
    ]);

    return { count: targetedResult.count + broadcastResult.count };
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
   */
  @Cron(CronExpression.EVERY_30_MINUTES)
  async handlePushReceipts() {
    if (this.pendingTickets.length === 0) return;

    // Drain the buffer
    const tickets = this.pendingTickets.splice(0);
    const ticketIds = tickets.map((t) => t.ticketId);

    try {
      const chunks = this.chunkArray(ticketIds, 1000);
      const invalidTokens: string[] = [];

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
            const ticket = tickets.find((t) => t.ticketId === ticketId);
            if (ticket) invalidTokens.push(ticket.pushToken);
          }
        }
      }

      if (invalidTokens.length > 0) {
        const result = await this.prisma.pushToken.deleteMany({
          where: { token: { in: invalidTokens } },
        });
        this.logger.log(
          `Removed ${result.count} invalid push tokens`,
        );
      }
    } catch {
      // Re-queue tickets for next cycle if receipt check fails
      this.pendingTickets.push(...tickets);
    }
  }

  private async sendPush(
    userId: string | null,
    title: string,
    body: string,
    metadata?: Record<string, unknown> | null,
  ) {
    try {
      const tokens = await this.prisma.pushToken.findMany({
        where: userId ? { userId } : undefined,
        select: { token: true },
        take: 10000, // Safety cap for broadcasts
      });

      if (tokens.length === 0) return;

      const messages = tokens.map((t) => ({
        to: t.token,
        sound: 'default' as const,
        title,
        body,
        data: metadata ?? {},
      }));

      // Send via Expo Push API and collect ticket IDs
      const chunks = this.chunkArray(messages, 100);
      for (const chunk of chunks) {
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

        // Buffer ticket IDs for receipt polling
        for (let i = 0; i < json.data.length; i++) {
          const ticket = json.data[i];
          if (ticket.status === 'ok' && ticket.id) {
            this.pendingTickets.push({
              ticketId: ticket.id,
              pushToken: chunk[i].to,
            });
          }
        }
      }
    } catch {
      // Silent fail — push is best-effort
    }
  }

  private chunkArray<T>(arr: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  }
}
