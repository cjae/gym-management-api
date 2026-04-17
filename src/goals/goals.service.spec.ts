import { Test } from '@nestjs/testing';
import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  GoalCategory,
  GoalMetric,
  GoalStatus,
  PrismaClient,
} from '@prisma/client';
import { GoalsService } from './goals.service';
import { PrismaService } from '../prisma/prisma.service';
import { AttendanceService } from '../attendance/attendance.service';
import { GymSettingsService } from '../gym-settings/gym-settings.service';

describe('GoalsService.create', () => {
  let service: GoalsService;
  let prisma: DeepMockProxy<PrismaClient>;
  const emitter = { emit: jest.fn() };
  const attendance = { getAvgDaysPerWeek: jest.fn() };
  const settings = {
    getCachedSettings: jest
      .fn()
      .mockResolvedValue({ maxActiveGoalsPerMember: 3 }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        GoalsService,
        { provide: PrismaService, useValue: mockDeep<PrismaClient>() },
        { provide: EventEmitter2, useValue: emitter },
        { provide: AttendanceService, useValue: attendance },
        { provide: GymSettingsService, useValue: settings },
      ],
    }).compile();
    service = moduleRef.get(GoalsService);
    prisma = moduleRef.get(PrismaService);
    attendance.getAvgDaysPerWeek.mockResolvedValue(3);
  });

  const dto = {
    title: 'Bench 120kg',
    category: GoalCategory.STRENGTH,
    metric: GoalMetric.KG,
    currentValue: 80,
    targetValue: 120,
  };

  it('snapshots currentGymFrequency and inserts in GENERATING status', async () => {
    prisma.goal.count.mockResolvedValue(0);
    prisma.goal.create.mockResolvedValue({ id: 'g1' } as never);

    await service.create('m1', dto);

    expect(prisma.goal.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        memberId: 'm1',
        currentGymFrequency: 3,
        generationStatus: 'GENERATING',
        status: 'ACTIVE',
      }),
    });
    expect(emitter.emit).toHaveBeenCalledWith(
      'goal.generation.requested',
      expect.objectContaining({ goalId: 'g1' }),
    );
  });

  it('throws 400 when member is at the concurrent-goals cap', async () => {
    prisma.goal.count.mockResolvedValue(3);
    await expect(service.create('m1', dto)).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.goal.create).not.toHaveBeenCalled();
  });

  it('counts only ACTIVE and PAUSED toward the cap', async () => {
    prisma.goal.count.mockResolvedValue(0);
    prisma.goal.create.mockResolvedValue({ id: 'g1' } as never);
    await service.create('m1', dto);
    expect(prisma.goal.count).toHaveBeenCalledWith({
      where: {
        memberId: 'm1',
        status: { in: [GoalStatus.ACTIVE, GoalStatus.PAUSED] },
      },
    });
  });
});
