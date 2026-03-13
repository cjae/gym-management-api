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
