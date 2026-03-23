import { Test, TestingModule } from '@nestjs/testing';
import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaClient, NotificationType, Prisma } from '@prisma/client';
import { MilestonesService } from './milestones.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StreakUpdatedPayload } from './milestones.constants';

describe('MilestonesService', () => {
  let service: MilestonesService;
  let prisma: DeepMockProxy<PrismaClient>;
  let notificationsService: { create: jest.Mock };

  beforeEach(async () => {
    notificationsService = { create: jest.fn().mockResolvedValue({}) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MilestonesService,
        { provide: PrismaService, useValue: mockDeep<PrismaClient>() },
        { provide: NotificationsService, useValue: notificationsService },
      ],
    }).compile();

    service = module.get<MilestonesService>(MilestonesService);
    prisma = module.get(PrismaService);
    jest.clearAllMocks();
  });

  const basePayload: StreakUpdatedPayload = {
    memberId: 'member-1',
    weeklyStreak: 0,
    longestStreak: 0,
    previousLongestStreak: 0,
    daysThisWeek: 1,
    previousBestWeek: 1,
    totalCheckIns: 1,
    isFirstCheckIn: false,
  };

  describe('first check-in', () => {
    it('should send first check-in notification', async () => {
      const payload = {
        ...basePayload,
        isFirstCheckIn: true,
        totalCheckIns: 1,
      };
      prisma.milestoneNotification.create.mockResolvedValue({} as any);

      await service.handleStreakUpdated(payload);

      expect(prisma.milestoneNotification.create).toHaveBeenCalledWith({
        data: {
          memberId: 'member-1',
          milestoneType: 'FIRST_CHECKIN',
          milestoneValue: 1,
        },
      });
      expect(notificationsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'member-1',
          title: 'Welcome to the gym!',
          type: NotificationType.MILESTONE,
        }),
      );
    });
  });

  describe('weekly streak milestones', () => {
    it('should send notification at 4-week streak', async () => {
      const payload = { ...basePayload, weeklyStreak: 4 };
      prisma.milestoneNotification.create.mockResolvedValue({} as any);

      await service.handleStreakUpdated(payload);

      expect(notificationsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'One month of consistency!',
          type: NotificationType.MILESTONE,
        }),
      );
    });

    it('should not send notification for non-milestone streak', async () => {
      const payload = { ...basePayload, weeklyStreak: 3 };

      await service.handleStreakUpdated(payload);

      expect(notificationsService.create).not.toHaveBeenCalled();
    });
  });

  describe('total check-in milestones', () => {
    it('should send notification at 50 total check-ins', async () => {
      const payload = { ...basePayload, totalCheckIns: 50 };
      prisma.milestoneNotification.create.mockResolvedValue({} as any);

      await service.handleStreakUpdated(payload);

      expect(notificationsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Half century!',
          type: NotificationType.MILESTONE,
        }),
      );
    });
  });

  describe('longest streak broken', () => {
    it('should send notification when longestStreak exceeds previous', async () => {
      const payload = {
        ...basePayload,
        weeklyStreak: 5,
        longestStreak: 5,
        previousLongestStreak: 4,
      };
      prisma.milestoneNotification.create.mockResolvedValue({} as any);

      await service.handleStreakUpdated(payload);

      expect(notificationsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'New streak record!',
          type: NotificationType.MILESTONE,
        }),
      );
    });

    it('should not send when longestStreak equals previous', async () => {
      const payload = {
        ...basePayload,
        weeklyStreak: 5,
        longestStreak: 5,
        previousLongestStreak: 5,
      };

      await service.handleStreakUpdated(payload);

      expect(notificationsService.create).not.toHaveBeenCalled();
    });
  });

  describe('dedup', () => {
    it('should skip notification when milestone already recorded', async () => {
      const payload = { ...basePayload, weeklyStreak: 4 };
      prisma.milestoneNotification.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '6.0.0',
        }),
      );

      await service.handleStreakUpdated(payload);

      expect(notificationsService.create).not.toHaveBeenCalled();
    });
  });

  describe('multiple milestones', () => {
    it('should send multiple notifications when multiple milestones hit', async () => {
      const payload = {
        ...basePayload,
        weeklyStreak: 4,
        totalCheckIns: 25,
        longestStreak: 4,
        previousLongestStreak: 3,
      };
      prisma.milestoneNotification.create.mockResolvedValue({} as any);

      await service.handleStreakUpdated(payload);

      // streak milestone + checkin milestone + longest streak = 3
      expect(notificationsService.create).toHaveBeenCalledTimes(3);
    });
  });
});
