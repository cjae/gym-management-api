/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Test, TestingModule } from '@nestjs/testing';
import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaClient } from '@prisma/client';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../prisma/prisma.service';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let prisma: DeepMockProxy<PrismaClient>;

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

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: mockDeep<PrismaClient>() },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
    prisma = module.get(PrismaService);

    // Set default mock return values
    prisma.notification.create.mockResolvedValue(mockNotification as any);
    prisma.notification.findMany.mockResolvedValue([]);
    prisma.notification.count.mockResolvedValue(0);
    prisma.notification.updateMany.mockResolvedValue({ count: 1 } as any);
    prisma.notification.deleteMany.mockResolvedValue({ count: 0 } as any);
    prisma.pushJob.create.mockResolvedValue(mockPushJob as any);
    prisma.pushJob.updateMany.mockResolvedValue({ count: 1 } as any);
    prisma.pushJob.deleteMany.mockResolvedValue({ count: 0 } as any);
    prisma.pushToken.findMany.mockResolvedValue([]);
    prisma.pushToken.deleteMany.mockResolvedValue({ count: 0 } as any);
    prisma.pushTicket.findMany.mockResolvedValue([]);
    prisma.pushTicket.createMany.mockResolvedValue({ count: 0 } as any);
    prisma.pushTicket.deleteMany.mockResolvedValue({ count: 0 } as any);
    prisma.notificationRead.createMany.mockResolvedValue({ count: 0 } as any);
    prisma.notificationRead.deleteMany.mockResolvedValue({ count: 0 } as any);
    prisma.$transaction.mockImplementation((fn: any) => fn(prisma));
  });

  describe('create', () => {
    it('should create notification and a PENDING push job', async () => {
      const dto = {
        title: 'Test',
        body: 'Test body',
        type: 'GENERAL' as const,
      };

      const result = await service.create(dto);

      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: {
          userId: undefined,
          title: 'Test',
          body: 'Test body',
          type: 'GENERAL',
          metadata: undefined,
        },
      });
      expect(prisma.pushJob.create).toHaveBeenCalledWith({
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

      const result = await service.create(dto);

      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ userId: 'user-1' }),
      });
      expect(prisma.pushJob.create).toHaveBeenCalled();
      expect(result).toEqual(mockNotification);
    });
  });

  describe('processPushJobs', () => {
    it('should skip when no pending jobs exist', async () => {
      prisma.pushJob.findFirst.mockResolvedValue(null);

      await service.processPushJobs();

      expect(prisma.pushToken.findMany).not.toHaveBeenCalled();
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
        notification: {
          userId: null,
          title: 'Test',
          body: 'Body',
          metadata: null,
        },
      };
      prisma.pushJob.findFirst.mockResolvedValue(job as any);
      prisma.pushToken.findMany.mockResolvedValue([
        { id: 'tok-1', token: 'ExponentPushToken[aaa]' },
        { id: 'tok-2', token: 'ExponentPushToken[bbb]' },
      ] as any);

      const mockResponse = {
        json: jest.fn().mockResolvedValue({
          data: [
            { id: 'ticket-1', status: 'ok' },
            { id: 'ticket-2', status: 'ok' },
          ],
        }),
      };
      global.fetch = jest.fn().mockResolvedValue(mockResponse);
      prisma.pushJob.findUnique.mockResolvedValue({
        ...job,
        sent: 2,
        failed: 0,
      } as any);

      await service.processPushJobs();

      // Should atomically claim the job as PROCESSING
      expect(prisma.pushJob.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'job-1', status: 'PENDING' },
          data: expect.objectContaining({ status: 'PROCESSING' }),
        }),
      );
      // Should save tickets to DB
      expect(prisma.pushTicket.createMany).toHaveBeenCalled();
      // Should update job with cursor and counts — COMPLETED since < batchSize
      expect(prisma.pushJob.update).toHaveBeenLastCalledWith(
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
        notification: {
          userId: null,
          title: 'Test',
          body: 'Body',
          metadata: null,
        },
      };
      prisma.pushJob.findFirst.mockResolvedValue(job as any);
      prisma.pushToken.findMany.mockResolvedValue([]);
      prisma.pushJob.findUnique.mockResolvedValue({
        ...job,
        status: 'COMPLETED',
      } as any);

      await service.processPushJobs();

      expect(prisma.pushToken.findMany).toHaveBeenCalledWith(
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
        notification: {
          userId: null,
          title: 'Test',
          body: 'Body',
          metadata: null,
        },
      };
      prisma.pushJob.findFirst.mockResolvedValue(job as any);
      prisma.pushToken.findMany.mockResolvedValue([
        { id: 'tok-4', token: 'ExponentPushToken[ddd]' },
      ] as any);
      global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));
      prisma.pushJob.findUnique.mockResolvedValue({
        ...job,
        status: 'FAILED',
        retries: 3,
      } as any);

      await service.processPushJobs();

      expect(prisma.pushJob.update).toHaveBeenLastCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'FAILED',
            error: 'Network error',
          }),
        }),
      );
    });
  });

  describe('markAllAsRead', () => {
    it('should batch broadcast read receipts in pages of 500', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 0 } as any);
      // First call: 500 results (full page — loop continues)
      // Second call: 200 results (partial page — loop ends)
      prisma.notification.findMany
        .mockResolvedValueOnce(
          Array.from({ length: 500 }, (_, i) => ({ id: `notif-${i}` })) as any,
        )
        .mockResolvedValueOnce(
          Array.from({ length: 200 }, (_, i) => ({
            id: `notif-${500 + i}`,
          })) as any,
        );
      prisma.notificationRead.createMany.mockResolvedValue({ count: 0 } as any);

      await service.markAllAsRead('user-1');

      // Should have been called twice for broadcast batching
      expect(prisma.notification.findMany).toHaveBeenCalledTimes(2);
      expect(prisma.notificationRead.createMany).toHaveBeenCalledTimes(2);
    });
  });

  describe('handlePushReceipts', () => {
    it('should skip when no push tickets exist', async () => {
      prisma.pushTicket.findMany.mockResolvedValue([]);
      global.fetch = jest.fn();

      await service.handlePushReceipts();

      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should delete invalid tokens from DeviceNotRegistered receipts', async () => {
      prisma.pushTicket.findMany.mockResolvedValue([
        {
          id: 'pt-1',
          ticketId: 'ticket-1',
          pushToken: 'ExponentPushToken[aaa]',
        },
        {
          id: 'pt-2',
          ticketId: 'ticket-2',
          pushToken: 'ExponentPushToken[bbb]',
        },
      ] as any);

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
      expect(prisma.pushToken.deleteMany).toHaveBeenCalledWith({
        where: { token: { in: ['ExponentPushToken[bbb]'] } },
      });
      // Should delete processed tickets
      expect(prisma.pushTicket.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['pt-1', 'pt-2'] } },
      });
    });
  });

  describe('cleanupOldNotifications', () => {
    it('should delete old notifications, tickets, and jobs', async () => {
      prisma.notification.deleteMany.mockResolvedValue({ count: 3 } as any);
      prisma.pushTicket.deleteMany.mockResolvedValue({ count: 10 } as any);
      prisma.pushJob.deleteMany.mockResolvedValue({ count: 2 } as any);

      await service.cleanupOldNotifications();

      // Should NOT manually delete reads (cascade handles it)
      expect(prisma.notificationRead.deleteMany).not.toHaveBeenCalled();
      // Should delete old notifications
      expect(prisma.notification.deleteMany).toHaveBeenCalledWith({
        where: { createdAt: { lt: expect.any(Date) } },
      });
      // Should delete stale push tickets
      expect(prisma.pushTicket.deleteMany).toHaveBeenCalledWith({
        where: { createdAt: { lt: expect.any(Date) } },
      });
      // Should delete completed/failed push jobs
      expect(prisma.pushJob.deleteMany).toHaveBeenCalledWith({
        where: {
          status: { in: ['COMPLETED', 'FAILED'] },
          updatedAt: { lt: expect.any(Date) },
        },
      });
    });
  });
});
