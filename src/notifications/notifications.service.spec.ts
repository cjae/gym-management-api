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
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
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
    $transaction: jest.fn().mockImplementation((fn) => fn(mockPrisma)),
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

      const result = await service.create(dto);

      expect(mockPrisma.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ userId: 'user-1' }),
      });
      expect(mockPrisma.pushJob.create).toHaveBeenCalled();
      expect(result).toEqual(mockNotification);
    });
  });

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
        notification: {
          userId: null,
          title: 'Test',
          body: 'Body',
          metadata: null,
        },
      };
      mockPrisma.pushJob.findFirst.mockResolvedValue(job);
      mockPrisma.pushToken.findMany.mockResolvedValue([
        { id: 'tok-1', token: 'ExponentPushToken[aaa]' },
        { id: 'tok-2', token: 'ExponentPushToken[bbb]' },
      ]);

      const mockResponse = {
        json: jest.fn().mockResolvedValue({
          data: [
            { id: 'ticket-1', status: 'ok' },
            { id: 'ticket-2', status: 'ok' },
          ],
        }),
      };
      global.fetch = jest.fn().mockResolvedValue(mockResponse);
      mockPrisma.pushJob.findUnique.mockResolvedValue({
        ...job,
        sent: 2,
        failed: 0,
      });

      await service.processPushJobs();

      // Should atomically claim the job as PROCESSING
      expect(mockPrisma.pushJob.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'job-1', status: 'PENDING' },
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
        notification: {
          userId: null,
          title: 'Test',
          body: 'Body',
          metadata: null,
        },
      };
      mockPrisma.pushJob.findFirst.mockResolvedValue(job);
      mockPrisma.pushToken.findMany.mockResolvedValue([]);
      mockPrisma.pushJob.findUnique.mockResolvedValue({
        ...job,
        status: 'COMPLETED',
      });

      await service.processPushJobs();

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
        notification: {
          userId: null,
          title: 'Test',
          body: 'Body',
          metadata: null,
        },
      };
      mockPrisma.pushJob.findFirst.mockResolvedValue(job);
      mockPrisma.pushToken.findMany.mockResolvedValue([
        { id: 'tok-4', token: 'ExponentPushToken[ddd]' },
      ]);
      global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));
      mockPrisma.pushJob.findUnique.mockResolvedValue({
        ...job,
        status: 'FAILED',
        retries: 3,
      });

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

  describe('handlePushReceipts', () => {
    it('should skip when no push tickets exist', async () => {
      mockPrisma.pushTicket.findMany.mockResolvedValue([]);
      global.fetch = jest.fn();

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
});
