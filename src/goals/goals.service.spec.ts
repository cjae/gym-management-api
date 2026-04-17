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

// ---------------------------------------------------------------------------
// Shared helper — builds a full module and returns { service, prisma }
// ---------------------------------------------------------------------------
async function buildModule() {
  const emitter = { emit: jest.fn() };
  const attendance = { getAvgDaysPerWeek: jest.fn().mockResolvedValue(3) };
  const settings = {
    getCachedSettings: jest
      .fn()
      .mockResolvedValue({ maxActiveGoalsPerMember: 3 }),
  };
  const moduleRef = await Test.createTestingModule({
    providers: [
      GoalsService,
      { provide: PrismaService, useValue: mockDeep<PrismaClient>() },
      { provide: EventEmitter2, useValue: emitter },
      { provide: AttendanceService, useValue: attendance },
      { provide: GymSettingsService, useValue: settings },
    ],
  }).compile();

  return {
    service: moduleRef.get(GoalsService),
    prisma: moduleRef.get<DeepMockProxy<PrismaClient>>(PrismaService),
  };
}

/** Minimal stub that satisfies the Goal shape the sanitizer needs. */
function makeGoal(overrides: Record<string, unknown> = {}) {
  return {
    id: 'g1',
    memberId: 'm1',
    title: 'Test goal',
    category: GoalCategory.STRENGTH,
    metric: GoalMetric.KG,
    currentValue: 80,
    targetValue: 120,
    currentGymFrequency: 3,
    status: GoalStatus.ACTIVE,
    generationStatus: 'DONE',
    generationError: null,
    rawLlmResponse: '{"raw":"data"}',
    userDeadline: null,
    recommendedGymFrequency: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    planItems: [],
    milestones: [],
    progressLogs: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
describe('GoalsService.update', () => {
  let service: GoalsService;
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(async () => {
    jest.clearAllMocks();
    ({ service, prisma } = await buildModule());
  });

  it('throws BadRequestException when trying COMPLETED → ACTIVE', async () => {
    prisma.goal.findFirst.mockResolvedValue(
      makeGoal({ status: GoalStatus.COMPLETED }) as never,
    );
    await expect(
      service.update('m1', 'g1', { status: GoalStatus.ACTIVE }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.goal.update).not.toHaveBeenCalled();
  });

  it('throws BadRequestException when trying ABANDONED → ACTIVE', async () => {
    prisma.goal.findFirst.mockResolvedValue(
      makeGoal({ status: GoalStatus.ABANDONED }) as never,
    );
    await expect(
      service.update('m1', 'g1', { status: GoalStatus.ACTIVE }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.goal.update).not.toHaveBeenCalled();
  });

  it('allows ACTIVE → PAUSED', async () => {
    prisma.goal.findFirst.mockResolvedValue(
      makeGoal({ status: GoalStatus.ACTIVE }) as never,
    );
    prisma.goal.update.mockResolvedValue(
      makeGoal({ status: GoalStatus.PAUSED }) as never,
    );
    const result = await service.update('m1', 'g1', {
      status: GoalStatus.PAUSED,
    });
    expect(result.status).toBe(GoalStatus.PAUSED);
  });

  it('allows PAUSED → ACTIVE', async () => {
    prisma.goal.findFirst.mockResolvedValue(
      makeGoal({ status: GoalStatus.PAUSED }) as never,
    );
    prisma.goal.update.mockResolvedValue(
      makeGoal({ status: GoalStatus.ACTIVE }) as never,
    );
    const result = await service.update('m1', 'g1', {
      status: GoalStatus.ACTIVE,
    });
    expect(result.status).toBe(GoalStatus.ACTIVE);
  });

  it('allows ACTIVE → ABANDONED', async () => {
    prisma.goal.findFirst.mockResolvedValue(
      makeGoal({ status: GoalStatus.ACTIVE }) as never,
    );
    prisma.goal.update.mockResolvedValue(
      makeGoal({ status: GoalStatus.ABANDONED }) as never,
    );
    const result = await service.update('m1', 'g1', {
      status: GoalStatus.ABANDONED,
    });
    expect(result.status).toBe(GoalStatus.ABANDONED);
  });

  it('throws NotFoundException when goal not owned by user', async () => {
    prisma.goal.findFirst.mockResolvedValue(null);
    await expect(
      service.update('m1', 'g1', { status: GoalStatus.PAUSED }),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.goal.update).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
describe('GoalsService.findOne', () => {
  let service: GoalsService;
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(async () => {
    jest.clearAllMocks();
    ({ service, prisma } = await buildModule());
  });

  it('returns goal with planItems, milestones, and progressLogs included', async () => {
    const planItems = [
      { id: 'pi1', weekNumber: 1, dayLabel: 'Mon', weight: 100 },
    ];
    const milestones = [{ id: 'ms1', weekNumber: 2, targetValue: 100 }];
    const progressLogs = [{ id: 'pl1', value: 90, loggedAt: new Date() }];
    prisma.goal.findFirst.mockResolvedValue(
      makeGoal({ planItems, milestones, progressLogs }) as never,
    );
    const result = await service.findOne('m1', 'g1');
    expect(result.planItems).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'pi1' })]),
    );
    expect(result.milestones).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'ms1' })]),
    );
    expect(result.progressLogs).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'pl1' })]),
    );
  });

  it('strips rawLlmResponse from the result', async () => {
    prisma.goal.findFirst.mockResolvedValue(
      makeGoal({ rawLlmResponse: '{"secret":"data"}' }) as never,
    );
    const result = await service.findOne('m1', 'g1');
    expect(result).not.toHaveProperty('rawLlmResponse');
  });

  it('exposes generationError because findOne passes includeError=true', async () => {
    prisma.goal.findFirst.mockResolvedValue(
      makeGoal({ generationError: 'LLM timeout' }) as never,
    );
    const result = await service.findOne('m1', 'g1');
    expect(result.generationError).toBe('LLM timeout');
  });

  it('throws NotFoundException for another member goal', async () => {
    prisma.goal.findFirst.mockResolvedValue(null);
    await expect(service.findOne('m2', 'g1')).rejects.toThrow(
      NotFoundException,
    );
  });
});

// ---------------------------------------------------------------------------
describe('GoalsService.remove', () => {
  let service: GoalsService;
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(async () => {
    jest.clearAllMocks();
    ({ service, prisma } = await buildModule());
  });

  it('deletes via deleteMany scoped by memberId and returns {deleted:true}', async () => {
    prisma.goal.deleteMany.mockResolvedValue({ count: 1 });
    const result = await service.remove('m1', 'g1');
    expect(prisma.goal.deleteMany).toHaveBeenCalledWith({
      where: { id: 'g1', memberId: 'm1' },
    });
    expect(result).toEqual({ deleted: true });
  });

  it('throws NotFoundException when deleteMany returns count=0', async () => {
    prisma.goal.deleteMany.mockResolvedValue({ count: 0 });
    await expect(service.remove('m1', 'g99')).rejects.toThrow(
      NotFoundException,
    );
  });
});
