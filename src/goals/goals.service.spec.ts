import { Test } from '@nestjs/testing';
import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  GoalCategory,
  GoalMetric,
  GoalStatus,
  PrismaClient,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/client';
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
    // Pass prisma itself as the tx so existing goal.count/create mocks work
    (prisma.$transaction as jest.Mock).mockImplementation(async (fn) =>
      fn(prisma),
    );
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

  it('stores requestedFrequency as userRequestedFrequency (not recommendedGymFrequency)', async () => {
    prisma.goal.count.mockResolvedValue(0);
    prisma.goal.create.mockResolvedValue({ id: 'g1' } as never);
    await service.create('m1', { ...dto, requestedFrequency: 4 });
    expect(prisma.goal.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userRequestedFrequency: 4,
      }),
    });
    expect(prisma.goal.create).toHaveBeenCalledWith({
      data: expect.not.objectContaining({ recommendedGymFrequency: 4 }),
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
    userRequestedFrequency: null,
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

// ---------------------------------------------------------------------------
describe('GoalsService.addProgressLog', () => {
  let service: GoalsService;
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(async () => {
    jest.clearAllMocks();
    ({ service, prisma } = await buildModule());
  });

  it('creates a progress log for an owned goal', async () => {
    prisma.goal.findFirst.mockResolvedValue({
      id: 'g1',
      category: 'STRENGTH',
    } as never);
    (prisma.$transaction as jest.Mock).mockImplementation(
      (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          goalProgressLog: {
            create: jest.fn().mockResolvedValue({
              id: 'l1',
              value: new Decimal(85),
              note: null,
              loggedAt: new Date(),
            }),
          },
          goalMilestone: {
            findMany: jest.fn().mockResolvedValue([]),
            updateMany: jest.fn(),
          },
        }),
    );

    const result = await service.addProgressLog('m1', 'g1', { value: 85 });
    expect(result).toMatchObject({ id: 'l1', value: 85 });
  });

  it('auto-completes milestones when value >= targetValue (non-WEIGHT_LOSS goal)', async () => {
    prisma.goal.findFirst.mockResolvedValue({
      id: 'g1',
      category: 'STRENGTH',
    } as never);
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    (prisma.$transaction as jest.Mock).mockImplementation(
      (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          goalProgressLog: {
            create: jest.fn().mockResolvedValue({
              id: 'l1',
              value: new Decimal(100),
              note: null,
              loggedAt: new Date(),
            }),
          },
          goalMilestone: {
            findMany: jest
              .fn()
              .mockResolvedValue([{ id: 'ms1', targetValue: new Decimal(90) }]),
            updateMany,
          },
        }),
    );

    await service.addProgressLog('m1', 'g1', { value: 100 });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['ms1'] } },
      data: { completed: true, completedAt: expect.any(Date) },
    });
  });

  it('auto-completes milestones for WEIGHT_LOSS when value <= targetValue', async () => {
    prisma.goal.findFirst.mockResolvedValue({
      id: 'g1',
      category: 'WEIGHT_LOSS',
    } as never);
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    (prisma.$transaction as jest.Mock).mockImplementation(
      (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          goalProgressLog: {
            create: jest.fn().mockResolvedValue({
              id: 'l1',
              value: new Decimal(75),
              note: null,
              loggedAt: new Date(),
            }),
          },
          goalMilestone: {
            findMany: jest
              .fn()
              .mockResolvedValue([{ id: 'ms1', targetValue: new Decimal(80) }]),
            updateMany,
          },
        }),
    );

    await service.addProgressLog('m1', 'g1', { value: 75 });
    expect(updateMany).toHaveBeenCalled();
  });

  it('throws NotFoundException for an unowned goal', async () => {
    prisma.goal.findFirst.mockResolvedValue(null);
    await expect(
      service.addProgressLog('m1', 'g1', { value: 85 }),
    ).rejects.toThrow(NotFoundException);
  });
});

// ---------------------------------------------------------------------------
describe('GoalsService.removeProgressLog', () => {
  let service: GoalsService;
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(async () => {
    jest.clearAllMocks();
    ({ service, prisma } = await buildModule());
  });

  it('deletes a progress log scoped by goalId', async () => {
    prisma.goal.findFirst.mockResolvedValue({ id: 'g1' } as never);
    prisma.goalProgressLog.deleteMany.mockResolvedValue({ count: 1 });
    const result = await service.removeProgressLog('m1', 'g1', 'l1');
    expect(result).toEqual({ deleted: true });
  });

  it('throws NotFoundException when log does not exist', async () => {
    prisma.goal.findFirst.mockResolvedValue({ id: 'g1' } as never);
    prisma.goalProgressLog.deleteMany.mockResolvedValue({ count: 0 });
    await expect(service.removeProgressLog('m1', 'g1', 'l1')).rejects.toThrow(
      NotFoundException,
    );
  });
});

// ---------------------------------------------------------------------------
describe('GoalsService planItem CRUD', () => {
  let service: GoalsService;
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(async () => {
    jest.clearAllMocks();
    ({ service, prisma } = await buildModule());
  });

  it('addPlanItem creates row scoped to owned goal', async () => {
    prisma.goal.findFirst.mockResolvedValue({ id: 'g1' } as never);
    prisma.goalPlanItem.create.mockResolvedValue({ id: 'p1' } as never);
    const result = await service.addPlanItem('m1', 'g1', {
      weekNumber: 1,
      dayLabel: 'Monday',
      exerciseOrder: 1,
      description: 'Squats',
    });
    expect(prisma.goalPlanItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ goalId: 'g1', weekNumber: 1 }),
    });
    expect(result).toMatchObject({ id: 'p1' });
  });

  it('updatePlanItem sets completedAt when completed=true', async () => {
    prisma.goal.findFirst.mockResolvedValue({ id: 'g1' } as never);
    prisma.goalPlanItem.update.mockResolvedValue({
      id: 'p1',
      completedAt: new Date(),
    } as never);
    await service.updatePlanItem('m1', 'g1', 'p1', { completed: true });
    expect(prisma.goalPlanItem.update).toHaveBeenCalledWith({
      where: { id: 'p1', goalId: 'g1' },
      data: expect.objectContaining({
        completed: true,
        completedAt: expect.any(Date),
      }),
    });
  });

  it('updatePlanItem nulls completedAt when completed=false', async () => {
    prisma.goal.findFirst.mockResolvedValue({ id: 'g1' } as never);
    prisma.goalPlanItem.update.mockResolvedValue({
      id: 'p1',
      completedAt: null,
    } as never);
    await service.updatePlanItem('m1', 'g1', 'p1', { completed: false });
    expect(prisma.goalPlanItem.update).toHaveBeenCalledWith({
      where: { id: 'p1', goalId: 'g1' },
      data: expect.objectContaining({ completed: false, completedAt: null }),
    });
  });

  it('removePlanItem deletes scoped by goalId', async () => {
    prisma.goal.findFirst.mockResolvedValue({ id: 'g1' } as never);
    prisma.goalPlanItem.deleteMany.mockResolvedValue({ count: 1 });
    const result = await service.removePlanItem('m1', 'g1', 'p1');
    expect(result).toEqual({ deleted: true });
  });

  it('addPlanItem throws NotFound when goal not owned', async () => {
    prisma.goal.findFirst.mockResolvedValue(null);
    await expect(
      service.addPlanItem('m1', 'g1', {
        weekNumber: 1,
        dayLabel: 'Monday',
        exerciseOrder: 1,
        description: 'X',
      }),
    ).rejects.toThrow(ForbiddenException);
  });
});

// ---------------------------------------------------------------------------
describe('GoalsService.retryGeneration', () => {
  let service: GoalsService;
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(async () => {
    jest.clearAllMocks();
    ({ service, prisma } = await buildModule());
  });

  it('resets FAILED goal to GENERATING and re-emits event', async () => {
    prisma.goal.updateMany.mockResolvedValue({ count: 1 } as never);
    prisma.goal.findFirstOrThrow.mockResolvedValue({
      id: 'g1',
      generationStatus: 'GENERATING',
      userRequestedFrequency: 4,
    } as never);

    const result = await service.retryGeneration('m1', 'g1');

    expect(prisma.goal.updateMany).toHaveBeenCalledWith({
      where: { id: 'g1', memberId: 'm1', generationStatus: 'FAILED' },
      data: expect.objectContaining({
        generationStatus: 'GENERATING',
        generationError: null,
        generationStartedAt: expect.any(Date),
      }),
    });
    expect(result).toMatchObject({ id: 'g1' });
  });

  it('throws BadRequestException when goal is not FAILED', async () => {
    prisma.goal.updateMany.mockResolvedValue({ count: 0 } as never);
    prisma.goal.findFirst.mockResolvedValue({
      id: 'g1',
      generationStatus: 'READY',
    } as never);
    await expect(service.retryGeneration('m1', 'g1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('throws NotFoundException when goal is not owned', async () => {
    prisma.goal.updateMany.mockResolvedValue({ count: 0 } as never);
    prisma.goal.findFirst.mockResolvedValue(null);
    await expect(service.retryGeneration('m1', 'g1')).rejects.toThrow(
      NotFoundException,
    );
  });
});

// ---------------------------------------------------------------------------
describe('GoalsService milestone CRUD', () => {
  let service: GoalsService;
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(async () => {
    jest.clearAllMocks();
    ({ service, prisma } = await buildModule());
  });

  it('addMilestone creates row scoped to owned goal', async () => {
    prisma.goal.findFirst.mockResolvedValue({ id: 'g1' } as never);
    prisma.goalMilestone.create.mockResolvedValue({ id: 'ms1' } as never);
    const result = await service.addMilestone('m1', 'g1', {
      weekNumber: 4,
      description: 'First milestone',
    });
    expect(prisma.goalMilestone.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ goalId: 'g1', weekNumber: 4 }),
    });
    expect(result).toMatchObject({ id: 'ms1' });
  });

  it('updateMilestone sets completedAt when completed=true', async () => {
    prisma.goal.findFirst.mockResolvedValue({ id: 'g1' } as never);
    prisma.goalMilestone.update.mockResolvedValue({ id: 'ms1' } as never);
    await service.updateMilestone('m1', 'g1', 'ms1', { completed: true });
    expect(prisma.goalMilestone.update).toHaveBeenCalledWith({
      where: { id: 'ms1', goalId: 'g1' },
      data: expect.objectContaining({
        completed: true,
        completedAt: expect.any(Date),
      }),
    });
  });

  it('removeMilestone deletes scoped by goalId', async () => {
    prisma.goal.findFirst.mockResolvedValue({ id: 'g1' } as never);
    prisma.goalMilestone.deleteMany.mockResolvedValue({ count: 1 });
    const result = await service.removeMilestone('m1', 'g1', 'ms1');
    expect(result).toEqual({ deleted: true });
  });
});
