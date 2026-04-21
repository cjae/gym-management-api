import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
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
      Sentry.captureException(err, {
        extra: { goalId: payload.goalId, memberId: payload.memberId },
      });
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

    const userDeadlineIso = goal.userDeadline
      ? goal.userDeadline.toISOString().slice(0, 10)
      : null;
    const weeksUntilDeadline = goal.userDeadline
      ? Math.max(
          1,
          Math.round(
            (goal.userDeadline.getTime() - goal.createdAt.getTime()) /
              (7 * 24 * 60 * 60 * 1000),
          ),
        )
      : null;

    const member = goal.member as {
      streak?: { weeklyStreak: number; longestStreak: number };
      experienceLevel: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED' | null;
      bodyweightKg: Prisma.Decimal | null;
      heightCm: number | null;
      sessionMinutes: number | null;
      preferredTrainingDays: string[];
      sleepHoursAvg: Prisma.Decimal | null;
      primaryMotivation: string | null;
      injuryNotes: string | null;
    };

    const prompt = buildGoalPrompt({
      title: goal.title,
      category: goal.category,
      metric: goal.metric,
      startingValue: Number(goal.startingValue),
      targetValue: Number(goal.targetValue),
      currentGymFrequency: goal.currentGymFrequency,
      weeklyStreak: member.streak?.weeklyStreak ?? 0,
      longestStreak: member.streak?.longestStreak ?? 0,
      requestedFrequency: payload.requestedFrequency,
      userDeadline: userDeadlineIso,
      weeksUntilDeadline,
      experienceLevel: member.experienceLevel,
      bodyweightKg:
        member.bodyweightKg != null ? Number(member.bodyweightKg) : null,
      heightCm: member.heightCm,
      sessionMinutes: member.sessionMinutes,
      preferredTrainingDays: member.preferredTrainingDays ?? [],
      sleepHoursAvg:
        member.sleepHoursAvg != null ? Number(member.sleepHoursAvg) : null,
      primaryMotivation: member.primaryMotivation,
      injuryNotes: member.injuryNotes,
      ageYears: null,
      sex: null,
      memberTenureMonths: null,
      hasPersonalTrainer: false,
      actualAttendanceLast4Weeks: 0,
      subscriptionPlanName: null,
      isOffPeakPlan: false,
      priorGoalsCompleted: 0,
      priorGoalsAbandoned: 0,
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

    const weeksInPlan = new Set(dto.plan.map((p) => p.weekNumber));
    for (let w = 1; w <= dto.estimatedWeeks; w++) {
      if (!weeksInPlan.has(w)) {
        throw new Error(
          `LLM plan is incomplete: missing week ${w} (estimatedWeeks=${dto.estimatedWeeks})`,
        );
      }
    }
    const stray = dto.plan.find((p) => p.weekNumber > dto.estimatedWeeks);
    if (stray) {
      throw new Error(
        `LLM plan contains out-of-range week ${stray.weekNumber} (estimatedWeeks=${dto.estimatedWeeks})`,
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
