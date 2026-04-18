import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LlmService } from '../../llm/llm.service';
import { buildGoalPrompt } from '../goal-prompt.builder';
import { LlmPlanResponseDto } from '../dto/llm-plan-response.dto';

type Payload = {
  goalId: string;
  memberId: string;
  requestedFrequency: number | null;
};

@Injectable()
export class GoalGenerationListener {
  private readonly logger = new Logger(GoalGenerationListener.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @OnEvent('goal.generation.requested', { async: true })
  async handle(payload: Payload) {
    try {
      await this.generate(payload);
    } catch (err) {
      this.logger.error(
        `Goal generation failed for ${payload.goalId}`,
        err as Error,
      );
      await this.markFailed(payload.goalId, err as Error);
      this.eventEmitter.emit('goal.plan.failed', payload);
    }
  }

  private async generate(payload: Payload) {
    const goal = await this.prisma.goal.findUniqueOrThrow({
      where: { id: payload.goalId },
      include: { member: { include: { streak: true } } },
    });

    if (goal.generationStatus !== 'GENERATING') {
      this.logger.warn(`Ignoring duplicate generation request for ${goal.id}`);
      return;
    }

    const prompt = buildGoalPrompt({
      title: goal.title,
      category: goal.category,
      metric: goal.metric,
      currentValue: Number(goal.currentValue),
      targetValue: Number(goal.targetValue),
      currentGymFrequency: goal.currentGymFrequency,
      weeklyStreak:
        (goal.member as { streak?: { weeklyStreak: number } }).streak
          ?.weeklyStreak ?? 0,
      longestStreak:
        (goal.member as { streak?: { longestStreak: number } }).streak
          ?.longestStreak ?? 0,
      requestedFrequency: payload.requestedFrequency,
    });

    const raw = await this.llm.generatePlan(prompt);

    const dto = plainToInstance(LlmPlanResponseDto, raw, {
      enableImplicitConversion: true,
    });
    const errors = await validate(dto, { whitelist: true });
    if (errors.length > 0) {
      throw new Error(
        `LLM response failed validation: ${JSON.stringify(errors)}`,
      );
    }

    const deadline = new Date(goal.createdAt);
    deadline.setUTCDate(deadline.getUTCDate() + dto.estimatedWeeks * 7);

    await this.prisma.$transaction(async (tx) => {
      if (dto.plan.length > 0) {
        await tx.goalPlanItem.createMany({
          data: dto.plan.map((p) => ({
            goalId: goal.id,
            weekNumber: p.weekNumber,
            dayLabel: p.dayLabel,
            exerciseOrder: p.exerciseOrder,
            description: p.description,
            workoutType: p.workoutType ?? null,
            muscleGroup: p.muscleGroup ?? null,
            sets: p.sets ?? null,
            reps: p.reps ?? null,
            weight: p.weight != null ? new Prisma.Decimal(p.weight) : null,
            duration: p.duration ?? null,
            restSeconds: p.restSeconds ?? null,
            distanceKm:
              p.distanceKm != null ? new Prisma.Decimal(p.distanceKm) : null,
            paceMinPerKm:
              p.paceMinPerKm != null
                ? new Prisma.Decimal(p.paceMinPerKm)
                : null,
            notes: p.notes ?? null,
          })),
        });
      }
      if (dto.milestones.length > 0) {
        await tx.goalMilestone.createMany({
          data: dto.milestones.map((m) => ({
            goalId: goal.id,
            weekNumber: m.weekNumber,
            description: m.description,
            targetValue:
              m.targetValue != null ? new Prisma.Decimal(m.targetValue) : null,
          })),
        });
      }
      await tx.goal.update({
        where: { id: goal.id },
        data: {
          recommendedGymFrequency: dto.recommendedGymFrequency,
          aiReasoning: dto.reasoning,
          aiEstimatedDeadline: deadline,
          rawLlmResponse: raw as Prisma.InputJsonValue,
          generationStatus: 'READY',
          generationError: null,
        },
      });
    });

    this.eventEmitter.emit('goal.plan.ready', {
      goalId: goal.id,
      memberId: goal.memberId,
      title: goal.title,
    });
  }

  private async markFailed(goalId: string, err: Error) {
    await this.prisma.goal.update({
      where: { id: goalId },
      data: {
        generationStatus: 'FAILED',
        generationError: err.message.slice(0, 1000),
      },
    });
  }
}
