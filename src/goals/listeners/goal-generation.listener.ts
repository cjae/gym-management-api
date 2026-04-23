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
      if (err instanceof GenerationRaceLostError) {
        // Another actor (e.g., the stale-generation sweeper) already transitioned
        // this goal out of GENERATING. The transaction rolled back cleanly; do
        // not mark FAILED, do not emit goal.plan.ready/failed. The other actor
        // owns the terminal state and its follow-up events.
        this.logger.warn(
          `Goal ${payload.goalId} generation race lost; skipping state update`,
        );
        return;
      }
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
    const baseGoal = await this.prisma.goal.findUniqueOrThrow({
      where: { id: payload.goalId },
      select: { createdAt: true },
    });

    // Attendance.checkInDate is @db.Date (UTC date-only). Normalize the window
    // bounds to UTC midnight so we don't drop rows for check-ins on day boundaries.
    const createdAtDateOnly = new Date(
      Date.UTC(
        baseGoal.createdAt.getUTCFullYear(),
        baseGoal.createdAt.getUTCMonth(),
        baseGoal.createdAt.getUTCDate(),
      ),
    );
    const attendanceFrom = new Date(
      createdAtDateOnly.getTime() - 28 * 24 * 60 * 60 * 1000,
    );
    const attendanceTo = createdAtDateOnly;

    const goal = await this.prisma.goal.findUniqueOrThrow({
      where: { id: payload.goalId },
      include: {
        member: {
          select: {
            id: true,
            createdAt: true,
            birthday: true,
            gender: true,
            experienceLevel: true,
            bodyweightKg: true,
            heightCm: true,
            sessionMinutes: true,
            preferredTrainingDays: true,
            sleepHoursAvg: true,
            primaryMotivation: true,
            injuryNotes: true,
            streak: true,
            subscriptionsOwned: {
              where: { status: { in: ['ACTIVE', 'FROZEN'] } },
              include: { plan: { select: { name: true, isOffPeak: true } } },
              orderBy: { endDate: 'desc' },
              take: 1,
            },
            attendances: {
              where: {
                checkInDate: { gte: attendanceFrom, lte: attendanceTo },
              },
              select: { id: true },
              take: 100,
            },
            trainerAssignmentsAsMember: {
              where: { endDate: null },
              select: { id: true },
              take: 1,
            },
            goals: {
              where: {
                id: { not: payload.goalId },
                status: { in: ['COMPLETED', 'ABANDONED'] },
              },
              select: { status: true },
            },
          },
        },
      },
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
      birthday: Date | null;
      gender: string | null;
      createdAt: Date;
      subscriptionsOwned: {
        plan: { name: string; isOffPeak: boolean } | null;
      }[];
      attendances: { id: string }[];
      trainerAssignmentsAsMember: { id: string }[];
      goals: { status: string }[];
    };

    const ageYears = member.birthday
      ? Math.floor(
          (goal.createdAt.getTime() - member.birthday.getTime()) /
            (365.25 * 24 * 60 * 60 * 1000),
        )
      : null;

    const memberTenureMonths = Math.max(
      0,
      (goal.createdAt.getUTCFullYear() - member.createdAt.getUTCFullYear()) *
        12 +
        (goal.createdAt.getUTCMonth() - member.createdAt.getUTCMonth()) -
        (goal.createdAt.getUTCDate() < member.createdAt.getUTCDate() ? 1 : 0),
    );

    const firstSubscription = member.subscriptionsOwned[0];
    const subscriptionPlanName = firstSubscription?.plan?.name ?? null;
    const isOffPeakPlan = firstSubscription?.plan?.isOffPeak ?? false;

    const priorGoalsCompleted = member.goals.filter(
      (g) => g.status === 'COMPLETED',
    ).length;
    const priorGoalsAbandoned = member.goals.filter(
      (g) => g.status === 'ABANDONED',
    ).length;

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
      ageYears,
      sex: member.gender,
      memberTenureMonths,
      hasPersonalTrainer: member.trainerAssignmentsAsMember.length > 0,
      actualAttendanceLast4Weeks: member.attendances.length,
      subscriptionPlanName,
      isOffPeakPlan,
      priorGoalsCompleted,
      priorGoalsAbandoned,
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

    const committed = await this.prisma.$transaction(async (tx) => {
      // Atomic state-guarded claim: only transition GENERATING -> READY.
      // If another actor (e.g., sweeper) has already transitioned this goal,
      // count === 0 and we throw to roll back plan item / milestone writes.
      const { count } = await tx.goal.updateMany({
        where: { id: goal.id, generationStatus: 'GENERATING' },
        data: {
          recommendedGymFrequency: dto.recommendedGymFrequency,
          aiReasoning: dto.reasoning,
          aiEstimatedDeadline: deadline,
          rawLlmResponse: raw as Prisma.InputJsonValue,
          generationStatus: 'READY',
          generationError: null,
        },
      });
      if (count === 0) {
        throw new GenerationRaceLostError(goal.id);
      }

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

      return true;
    });

    // Defer push notification until AFTER the transaction commits so we never
    // notify for a plan that got rolled back.
    if (committed) {
      this.eventEmitter.emit('goal.plan.ready', {
        goalId: goal.id,
        memberId: goal.memberId,
        title: goal.title,
      });
    }
  }

  private async markFailed(goalId: string, err: Error) {
    try {
      // Atomic state-guarded claim: only flip GENERATING -> FAILED so we never
      // clobber a READY goal (e.g., if somehow the listener failed after a
      // successful commit) or a row the sweeper already terminated.
      const { count } = await this.prisma.goal.updateMany({
        where: { id: goalId, generationStatus: 'GENERATING' },
        data: {
          generationStatus: 'FAILED',
          generationError: err.message.slice(0, 1000),
        },
      });
      if (count === 0) {
        this.logger.warn(
          `Goal ${goalId} no longer in GENERATING; cannot mark failed`,
        );
      }
    } catch (updateErr) {
      if (
        updateErr instanceof Prisma.PrismaClientKnownRequestError &&
        updateErr.code === 'P2025'
      ) {
        this.logger.warn(`Goal ${goalId} no longer exists; cannot mark failed`);
        return;
      }
      throw updateErr;
    }
  }
}

class GenerationRaceLostError extends Error {
  constructor(goalId: string) {
    super(`Generation race lost for goal ${goalId}`);
    this.name = 'GenerationRaceLostError';
  }
}
