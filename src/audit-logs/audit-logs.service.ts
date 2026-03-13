import { Injectable, Logger } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const SENSITIVE_FIELDS = [
  'password',
  'paystackAuthorizationCode',
  'token',
  'signatureData',
];

export interface LogEntry {
  userId: string | null;
  action: AuditAction;
  resource: string;
  resourceId?: string;
  oldData?: Record<string, unknown>;
  newData?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  route?: string;
  metadata?: Record<string, unknown>;
}

export interface FindAllParams {
  page?: number;
  limit?: number;
  userId?: string;
  action?: AuditAction;
  resource?: string;
  resourceId?: string;
  startDate?: string;
  endDate?: string;
  ipAddress?: string;
}

const RESOURCE_MODEL_MAP: Record<string, string> = {
  User: 'user',
  SubscriptionPlan: 'subscriptionPlan',
  Subscription: 'memberSubscription',
  Salary: 'staffSalaryRecord',
  Trainer: 'trainerProfile',
  Entrance: 'entrance',
  QrCode: 'gymQrCode',
  GymClasses: 'gymClass',
  Payment: 'payment',
  Attendance: 'attendance',
  Banners: 'banner',
  Notifications: 'notification',
};

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private prisma: PrismaService) {}

  async log(entry: LogEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: entry.userId,
          action: entry.action,
          resource: entry.resource,
          resourceId: entry.resourceId,
          oldData: this.stripSensitiveFields(entry.oldData) as
            | Prisma.InputJsonValue
            | undefined,
          newData: this.stripSensitiveFields(entry.newData) as
            | Prisma.InputJsonValue
            | undefined,
          ipAddress: entry.ipAddress,
          userAgent: entry.userAgent,
          route: entry.route,
          metadata: this.stripSensitiveFields(entry.metadata) as
            | Prisma.InputJsonValue
            | undefined,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to write audit log: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }

  async fetchOldData(
    resource: string,
    id: string,
  ): Promise<Record<string, unknown> | null> {
    const modelName = RESOURCE_MODEL_MAP[resource];
    if (!modelName) {
      return null;
    }

    const model = this.prisma[modelName] as {
      findUnique: (args: { where: { id: string } }) => Promise<unknown>;
    };
    if (!model) {
      return null;
    }

    try {
      const record = await model.findUnique({ where: { id } });
      return (record as Record<string, unknown>) ?? null;
    } catch (error) {
      this.logger.error(
        `Failed to fetch old data for ${resource}:${id}: ${(error as Error).message}`,
        (error as Error).stack,
      );
      return null;
    }
  }

  async findAll(params: FindAllParams) {
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;
    const {
      userId,
      action,
      resource,
      resourceId,
      startDate,
      endDate,
      ipAddress,
    } = params;

    const where: Record<string, unknown> = {};
    if (userId) where.userId = userId;
    if (action) where.action = action;
    if (resource) where.resource = resource;
    if (resourceId) where.resourceId = resourceId;
    if (ipAddress) where.ipAddress = ipAddress;
    if (startDate || endDate) {
      where.createdAt = {
        ...(startDate && { gte: new Date(startDate) }),
        ...(endDate && { lte: new Date(endDate) }),
      };
    }

    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        include: {
          user: {
            select: { id: true, email: true, firstName: true, lastName: true },
          },
        },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  private stripSensitiveFields(
    data?: Record<string, unknown>,
  ): Record<string, unknown> | undefined {
    if (!data) return undefined;
    const cleaned = { ...data };
    for (const field of SENSITIVE_FIELDS) {
      delete cleaned[field];
    }
    return cleaned;
  }
}
