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
    currentValue: { valueOf: () => 80 },
    targetValue: { valueOf: () => 120 },
    currentGymFrequency: 3,
    generationStatus: 'GENERATING',
    createdAt: new Date('2026-04-01T00:00:00Z'),
    member: { streak: { weeklyStreak: 2, longestStreak: 6 } },
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
});
