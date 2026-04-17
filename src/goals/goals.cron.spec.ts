import { Test } from '@nestjs/testing';
import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaClient } from '@prisma/client';
import { GoalsCron } from './goals.cron';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '@prisma/client';

describe('GoalsCron', () => {
  let cron: GoalsCron;
  let prisma: DeepMockProxy<PrismaClient>;
  const emitter = { emit: jest.fn() };
  const notifications = { create: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        GoalsCron,
        { provide: PrismaService, useValue: mockDeep<PrismaClient>() },
        { provide: EventEmitter2, useValue: emitter },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();
    cron = moduleRef.get(GoalsCron);
    prisma = moduleRef.get(PrismaService);
  });

  describe('sweepStaleGenerations', () => {
    it('flips GENERATING goals older than 10 min to FAILED and emits event per goal', async () => {
      prisma.goal.findMany.mockResolvedValue([
        { id: 'g1', memberId: 'm1' },
      ] as never);
      prisma.goal.updateMany.mockResolvedValue({ count: 1 });

      await cron.sweepStaleGenerations();

      expect(prisma.goal.findMany).toHaveBeenCalledWith({
        where: {
          generationStatus: 'GENERATING',
          generationStartedAt: { lt: expect.any(Date) },
        },
        select: { id: true, memberId: true },
      });
      expect(prisma.goal.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'g1',
          generationStatus: 'GENERATING',
          generationStartedAt: { lt: expect.any(Date) },
        },
        data: {
          generationStatus: 'FAILED',
          generationError: 'Generation timed out',
        },
      });
      expect(emitter.emit).toHaveBeenCalledWith('goal.plan.failed', {
        goalId: 'g1',
        memberId: 'm1',
      });
    });

    it('does nothing when no stale goals exist', async () => {
      prisma.goal.findMany.mockResolvedValue([] as never);
      await cron.sweepStaleGenerations();
      expect(prisma.goal.updateMany).not.toHaveBeenCalled();
      expect(emitter.emit).not.toHaveBeenCalled();
    });
  });

  describe('sendWeeklyMotivation', () => {
    it('sends one GOAL_WEEKLY_PULSE notification per member with active goals', async () => {
      prisma.goal.findMany.mockResolvedValue([
        {
          id: 'g1',
          memberId: 'm1',
          title: 'Bench 120kg',
          status: 'ACTIVE',
          milestones: [],
          progressLogs: [],
        },
        {
          id: 'g2',
          memberId: 'm1',
          title: 'Lose weight',
          status: 'ACTIVE',
          milestones: [],
          progressLogs: [],
        },
        {
          id: 'g3',
          memberId: 'm2',
          title: 'Run 5K',
          status: 'ACTIVE',
          milestones: [],
          progressLogs: [],
        },
      ] as never);
      notifications.create.mockResolvedValue({});

      await cron.sendWeeklyMotivation();

      // m1 and m2 each get exactly 1 notification
      expect(notifications.create).toHaveBeenCalledTimes(2);
      // m1's notification has GOAL_WEEKLY_PULSE type
      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'm1',
          type: NotificationType.GOAL_WEEKLY_PULSE,
          metadata: expect.objectContaining({
            goalIds: expect.arrayContaining(['g1', 'g2']),
          }),
        }),
      );
    });

    it('does nothing when no active goals exist', async () => {
      prisma.goal.findMany.mockResolvedValue([] as never);
      await cron.sendWeeklyMotivation();
      expect(notifications.create).not.toHaveBeenCalled();
    });
  });

  describe('cleanupAbandoned', () => {
    it('deletes ABANDONED goals older than 90 days', async () => {
      prisma.goal.deleteMany.mockResolvedValue({ count: 3 });
      await cron.cleanupAbandoned();
      expect(prisma.goal.deleteMany).toHaveBeenCalledWith({
        where: {
          status: 'ABANDONED',
          updatedAt: { lt: expect.any(Date) },
        },
      });
    });

    it('does not touch COMPLETED goals', async () => {
      prisma.goal.deleteMany.mockResolvedValue({ count: 0 });
      await cron.cleanupAbandoned();
      const args = prisma.goal.deleteMany.mock.calls[0][0] as {
        where: { status: string };
      };
      expect(args.where.status).toBe('ABANDONED');
    });
  });
});
