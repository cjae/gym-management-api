import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateNotificationDto } from './dto/create-notification.dto';

@Injectable()
export class NotificationsService {
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

    const [data, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.notification.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async markAsRead(id: string, userId: string) {
    return this.prisma.notification.updateMany({
      where: {
        id,
        OR: [{ userId }, { userId: null }],
      },
      data: { isRead: true },
    });
  }

  async markAllAsRead(userId: string) {
    return this.prisma.notification.updateMany({
      where: {
        OR: [{ userId }, { userId: null }],
        isRead: false,
      },
      data: { isRead: true },
    });
  }

  async registerPushToken(userId: string, token: string, platform: string) {
    return this.prisma.pushToken.upsert({
      where: { token },
      create: { userId, token, platform },
      update: { userId, platform },
    });
  }

  async removePushToken(token: string) {
    return this.prisma.pushToken.deleteMany({ where: { token } });
  }

  private async sendPush(
    userId: string | null,
    title: string,
    body: string,
    metadata?: Record<string, unknown> | null,
  ) {
    try {
      let tokens: { token: string }[];

      if (userId) {
        tokens = await this.prisma.pushToken.findMany({
          where: { userId },
          select: { token: true },
        });
      } else {
        // Broadcast — get all push tokens
        tokens = await this.prisma.pushToken.findMany({
          select: { token: true },
        });
      }

      if (tokens.length === 0) return;

      const messages = tokens.map((t) => ({
        to: t.token,
        sound: 'default' as const,
        title,
        body,
        data: metadata ?? {},
      }));

      // Send via Expo Push API
      const chunks = this.chunkArray(messages, 100);
      for (const chunk of chunks) {
        await fetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(chunk),
        });
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
