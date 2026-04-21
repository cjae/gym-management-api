import { Test } from '@nestjs/testing';
import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaClient } from '@prisma/client';
import { GoalGenerationListener } from './goal-generation.listener';
import { PrismaService } from '../../prisma/prisma.service';
import { LlmService } from '../../llm/llm.service';

describe('GoalGenerationListener', () => {
  let listener: GoalGenerationListener;
  let prisma: DeepMockProxy<PrismaClient>;
  const llm = { generatePlan: jest.fn() };
  const emitter = { emit: jest.fn() };

  const validLlmResponse = {
    recommendedGymFrequency: 1,
    estimatedWeeks: 1,
    reasoning: 'Good plan',
    milestones: [
      { weekNumber: 1, description: 'First milestone', targetValue: 90 },
    ],
    plan: [
      {
        weekNumber: 1,
        dayLabel: 'Monday',
        exerciseOrder: 1,
        description: 'Squats',
        sets: 4,
        reps: 8,
        weight: 100,
      },
    ],
  };

  const baseGoal = {
    id: 'g1',
    memberId: 'm1',
    title: 'Bench 120kg',
    category: 'STRENGTH',
    metric: 'KG',
    startingValue: { valueOf: () => 80 },
    targetValue: { valueOf: () => 120 },
    currentGymFrequency: 3,
    generationStatus: 'GENERATING',
    createdAt: new Date('2026-04-01T00:00:00Z'),
    userDeadline: null,
    member: {
      streak: { weeklyStreak: 2, longestStreak: 6 },
      experienceLevel: null,
      bodyweightKg: null,
      heightCm: null,
      sessionMinutes: null,
      preferredTrainingDays: [],
      sleepHoursAvg: null,
      primaryMotivation: null,
      injuryNotes: null,
      birthday: null,
      gender: null,
      createdAt: new Date('2025-04-01T00:00:00Z'),
      subscriptionsOwned: [],
      attendances: [],
      trainerAssignmentsAsMember: [],
      goals: [],
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        GoalGenerationListener,
        { provide: PrismaService, useValue: mockDeep<PrismaClient>() },
        { provide: LlmService, useValue: llm },
        { provide: EventEmitter2, useValue: emitter },
      ],
    }).compile();
    listener = moduleRef.get(GoalGenerationListener);
    prisma = moduleRef.get(PrismaService);
  });

  it('generates plan and emits goal.plan.ready on success', async () => {
    prisma.goal.findUniqueOrThrow.mockResolvedValue(baseGoal as never);
    llm.generatePlan.mockResolvedValue(validLlmResponse);
    (prisma.$transaction as jest.Mock).mockImplementation(
      (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          goalPlanItem: {
            createMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
          goalMilestone: {
            createMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
          goal: { update: jest.fn().mockResolvedValue({}) },
        }),
    );

    await listener.handle({
      goalId: 'g1',
      memberId: 'm1',
      requestedFrequency: null,
    });

    expect(llm.generatePlan).toHaveBeenCalledWith(expect.any(String));
    expect(emitter.emit).toHaveBeenCalledWith('goal.plan.ready', {
      goalId: 'g1',
      memberId: 'm1',
      title: 'Bench 120kg',
    });
  });

  it('marks goal FAILED and emits goal.plan.failed when LLM throws', async () => {
    prisma.goal.findUniqueOrThrow.mockResolvedValue(baseGoal as never);
    llm.generatePlan.mockRejectedValue(new Error('LLM error'));
    prisma.goal.update.mockResolvedValue({} as never);

    await listener.handle({
      goalId: 'g1',
      memberId: 'm1',
      requestedFrequency: null,
    });

    expect(prisma.goal.update).toHaveBeenCalledWith({
      where: { id: 'g1' },
      data: expect.objectContaining({ generationStatus: 'FAILED' }),
    });
    expect(emitter.emit).toHaveBeenCalledWith('goal.plan.failed', {
      goalId: 'g1',
      memberId: 'm1',
      requestedFrequency: null,
    });
  });

  it('marks goal FAILED when plan is missing weeks', async () => {
    prisma.goal.findUniqueOrThrow.mockResolvedValue(baseGoal as never);
    llm.generatePlan.mockResolvedValue({
      ...validLlmResponse,
      estimatedWeeks: 3,
      plan: [{ ...validLlmResponse.plan[0], weekNumber: 1 }],
    });
    prisma.goal.update.mockResolvedValue({} as never);

    await listener.handle({
      goalId: 'g1',
      memberId: 'm1',
      requestedFrequency: null,
    });

    expect(prisma.goal.update).toHaveBeenCalledWith({
      where: { id: 'g1' },
      data: expect.objectContaining({ generationStatus: 'FAILED' }),
    });
  });

  it('passes userDeadline and weeks-until-deadline into the prompt', async () => {
    prisma.goal.findUniqueOrThrow.mockResolvedValue({
      ...baseGoal,
      userDeadline: new Date('2026-07-10T00:00:00Z'),
    } as never);
    llm.generatePlan.mockResolvedValue(validLlmResponse);
    (prisma.$transaction as jest.Mock).mockImplementation(
      (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          goalPlanItem: {
            createMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
          goalMilestone: {
            createMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
          goal: { update: jest.fn().mockResolvedValue({}) },
        }),
    );

    await listener.handle({
      goalId: 'g1',
      memberId: 'm1',
      requestedFrequency: null,
    });

    const prompt = llm.generatePlan.mock.calls[0][0] as string;
    expect(prompt).toContain('User deadline: 2026-07-10');
    expect(prompt).toContain('~14 weeks away');
  });

  it('ignores duplicate events when goal is not in GENERATING status', async () => {
    prisma.goal.findUniqueOrThrow.mockResolvedValue({
      ...baseGoal,
      generationStatus: 'READY',
    } as never);

    await listener.handle({
      goalId: 'g1',
      memberId: 'm1',
      requestedFrequency: null,
    });

    expect(llm.generatePlan).not.toHaveBeenCalled();
    expect(emitter.emit).not.toHaveBeenCalled();
  });

  describe('Phase 6 — derived member context in prompt', () => {
    const makeGoal = (
      memberOverrides: Record<string, unknown>,
      goalOverrides: Record<string, unknown> = {},
    ) => ({
      ...baseGoal,
      ...goalOverrides,
      member: {
        ...baseGoal.member,
        ...memberOverrides,
      },
    });

    const stubTransaction = () => {
      (prisma.$transaction as jest.Mock).mockImplementation(
        (fn: (tx: unknown) => Promise<unknown>) =>
          fn({
            goalPlanItem: {
              createMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
            goalMilestone: {
              createMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
            goal: { update: jest.fn().mockResolvedValue({}) },
          }),
      );
    };

    it('passes onboarding fields into the prompt', async () => {
      const goal = makeGoal({
        experienceLevel: 'INTERMEDIATE',
        bodyweightKg: { valueOf: () => 75 },
        heightCm: 180,
        sessionMinutes: 60,
        preferredTrainingDays: ['Mon', 'Wed', 'Fri'],
        sleepHoursAvg: { valueOf: () => 7.5 },
        primaryMotivation: 'HEALTH',
        injuryNotes: 'bad knee',
      });
      prisma.goal.findUniqueOrThrow.mockResolvedValue(goal as never);
      llm.generatePlan.mockResolvedValue(validLlmResponse);
      stubTransaction();

      await listener.handle({
        goalId: 'g1',
        memberId: 'm1',
        requestedFrequency: null,
      });

      const prompt = llm.generatePlan.mock.calls[0][0] as string;
      expect(prompt).toContain('Experience: INTERMEDIATE');
      expect(prompt).toContain('Bodyweight: 75 kg');
      expect(prompt).toContain('Height: 180 cm');
      expect(prompt).toContain('Preferred training days: MON, WED, FRI');
      expect(prompt).toContain('Primary motivation: HEALTH');
      expect(prompt).toContain('Injury notes: bad knee');
    });

    it('computes ageYears from birthday', async () => {
      const goal = makeGoal(
        {
          birthday: new Date('1990-01-01T00:00:00Z'),
        },
        {
          createdAt: new Date('2026-04-21T00:00:00Z'),
        },
      );
      prisma.goal.findUniqueOrThrow.mockResolvedValue(goal as never);
      llm.generatePlan.mockResolvedValue(validLlmResponse);
      stubTransaction();

      await listener.handle({
        goalId: 'g1',
        memberId: 'm1',
        requestedFrequency: null,
      });

      const prompt = llm.generatePlan.mock.calls[0][0] as string;
      expect(prompt).toContain('Age: 36 years');
    });

    it('renders age as not specified when birthday is null', async () => {
      const goal = makeGoal({ birthday: null });
      prisma.goal.findUniqueOrThrow.mockResolvedValue(goal as never);
      llm.generatePlan.mockResolvedValue(validLlmResponse);
      stubTransaction();

      await listener.handle({
        goalId: 'g1',
        memberId: 'm1',
        requestedFrequency: null,
      });

      const prompt = llm.generatePlan.mock.calls[0][0] as string;
      expect(prompt).toContain('Age: not specified');
    });

    it('counts attendance rows within [createdAt - 28d, createdAt]', async () => {
      const goal = makeGoal({
        attendances: [
          { id: 'a1' },
          { id: 'a2' },
          { id: 'a3' },
          { id: 'a4' },
          { id: 'a5' },
        ],
      });
      prisma.goal.findUniqueOrThrow.mockResolvedValue(goal as never);
      llm.generatePlan.mockResolvedValue(validLlmResponse);
      stubTransaction();

      await listener.handle({
        goalId: 'g1',
        memberId: 'm1',
        requestedFrequency: null,
      });

      const prompt = llm.generatePlan.mock.calls[0][0] as string;
      expect(prompt).toContain(
        'Recent attendance: 5 days over the last 4 weeks',
      );

      const findArgs = prisma.goal.findUniqueOrThrow.mock.calls[1][0];
      const expectedGte = new Date(
        baseGoal.createdAt.getTime() - 28 * 24 * 60 * 60 * 1000,
      );
      const expectedLte = baseGoal.createdAt;
      expect(findArgs).toEqual(
        expect.objectContaining({
          include: expect.objectContaining({
            member: expect.objectContaining({
              include: expect.objectContaining({
                attendances: {
                  where: {
                    checkInDate: { gte: expectedGte, lte: expectedLte },
                  },
                  select: { id: true },
                },
              }),
            }),
          }),
        }),
      );
    });

    it('renders subscription plan with off-peak flag when member has an active plan', async () => {
      const goal = makeGoal({
        subscriptionsOwned: [{ plan: { name: 'Premium', isOffPeak: true } }],
      });
      prisma.goal.findUniqueOrThrow.mockResolvedValue(goal as never);
      llm.generatePlan.mockResolvedValue(validLlmResponse);
      stubTransaction();

      await listener.handle({
        goalId: 'g1',
        memberId: 'm1',
        requestedFrequency: null,
      });

      const prompt = llm.generatePlan.mock.calls[0][0] as string;
      expect(prompt).toContain('Subscription plan: Premium (off-peak: yes)');
      expect(prompt).toContain(
        'The member is on an off-peak plan: training must occur during off-peak hours',
      );
    });

    it('renders subscription plan as not specified when member has no active plan', async () => {
      const goal = makeGoal({ subscriptionsOwned: [] });
      prisma.goal.findUniqueOrThrow.mockResolvedValue(goal as never);
      llm.generatePlan.mockResolvedValue(validLlmResponse);
      stubTransaction();

      await listener.handle({
        goalId: 'g1',
        memberId: 'm1',
        requestedFrequency: null,
      });

      const prompt = llm.generatePlan.mock.calls[0][0] as string;
      expect(prompt).toContain('Subscription plan: not specified');
      expect(prompt).not.toContain(
        'The member is on an off-peak plan: training must occur during off-peak hours',
      );
    });

    it('counts prior goals by status and includes them in the prompt', async () => {
      const goal = makeGoal({
        goals: [
          { status: 'COMPLETED' },
          { status: 'COMPLETED' },
          { status: 'ABANDONED' },
        ],
      });
      prisma.goal.findUniqueOrThrow.mockResolvedValue(goal as never);
      llm.generatePlan.mockResolvedValue(validLlmResponse);
      stubTransaction();

      await listener.handle({
        goalId: 'g1',
        memberId: 'm1',
        requestedFrequency: null,
      });

      const prompt = llm.generatePlan.mock.calls[0][0] as string;
      expect(prompt).toContain('Prior goal history: 2 completed, 1 abandoned');

      const findArgs = prisma.goal.findUniqueOrThrow.mock.calls[1][0];
      expect(findArgs).toEqual(
        expect.objectContaining({
          include: expect.objectContaining({
            member: expect.objectContaining({
              include: expect.objectContaining({
                goals: {
                  where: {
                    id: { not: 'g1' },
                    status: { in: ['COMPLETED', 'ABANDONED'] },
                  },
                  select: { status: true },
                },
              }),
            }),
          }),
        }),
      );
    });

    it('renders personal-trainer line based on active trainer assignments', async () => {
      const goalWithTrainer = makeGoal({
        trainerAssignmentsAsMember: [{ id: 't1' }],
      });
      prisma.goal.findUniqueOrThrow.mockResolvedValue(goalWithTrainer as never);
      llm.generatePlan.mockResolvedValue(validLlmResponse);
      stubTransaction();

      await listener.handle({
        goalId: 'g1',
        memberId: 'm1',
        requestedFrequency: null,
      });

      const promptWith = llm.generatePlan.mock.calls[0][0] as string;
      expect(promptWith).toContain(
        'Working with a personal trainer: yes (plans should complement trainer guidance, not replace it)',
      );

      const findArgs = prisma.goal.findUniqueOrThrow.mock.calls[1][0];
      expect(findArgs).toEqual(
        expect.objectContaining({
          include: expect.objectContaining({
            member: expect.objectContaining({
              include: expect.objectContaining({
                trainerAssignmentsAsMember: {
                  where: { endDate: null },
                  select: { id: true },
                  take: 1,
                },
              }),
            }),
          }),
        }),
      );
    });

    it('renders personal-trainer line as "no" when no active trainer assignment exists', async () => {
      const goalWithoutTrainer = makeGoal({ trainerAssignmentsAsMember: [] });
      prisma.goal.findUniqueOrThrow.mockResolvedValue(
        goalWithoutTrainer as never,
      );
      llm.generatePlan.mockResolvedValue(validLlmResponse);
      stubTransaction();

      await listener.handle({
        goalId: 'g1',
        memberId: 'm1',
        requestedFrequency: null,
      });

      const prompt = llm.generatePlan.mock.calls[0][0] as string;
      expect(prompt).toContain('Working with a personal trainer: no');
      expect(prompt).not.toContain(
        'plans should complement trainer guidance, not replace it',
      );
    });
  });
});
