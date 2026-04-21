import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { GoalStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AttendanceService } from '../attendance/attendance.service';
import { GymSettingsService } from '../gym-settings/gym-settings.service';
import { CreateGoalDto } from './dto/create-goal.dto';
import { ListGoalsQueryDto } from './dto/list-goals-query.dto';
import {
  sanitizeGoal,
  sanitizeMilestone,
  sanitizePlanItem,
} from './goals.sanitizer';
import { UpdateGoalDto } from './dto/update-goal.dto';
import { CreateProgressLogDto } from './dto/create-progress-log.dto';
import {
  CreatePlanItemDto,
  UpdatePlanItemDto,
} from './dto/upsert-plan-item.dto';
import {
  CreateMilestoneDto,
  UpdateMilestoneDto,
} from './dto/upsert-milestone.dto';

const NON_TERMINAL = [GoalStatus.ACTIVE, GoalStatus.PAUSED];

const ALLOWED_TRANSITIONS: Record<GoalStatus, GoalStatus[]> = {
  ACTIVE: [GoalStatus.PAUSED, GoalStatus.ABANDONED, GoalStatus.COMPLETED],
  PAUSED: [GoalStatus.ACTIVE, GoalStatus.ABANDONED, GoalStatus.COMPLETED],
  COMPLETED: [],
  ABANDONED: [],
};

@Injectable()
export class GoalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly attendance: AttendanceService,
    private readonly settings: GymSettingsService,
  ) {}

  async create(memberId: string, dto: CreateGoalDto) {
    const settings = await this.settings.getCachedSettings();
    const cap = settings?.maxActiveGoalsPerMember ?? 3;

    if (dto.userDeadline && new Date(dto.userDeadline) <= new Date()) {
      throw new BadRequestException('userDeadline must be a future date');
    }

    const member = await this.prisma.user.findUnique({
      where: { id: memberId },
      select: { onboardingCompletedAt: true },
    });
    if (!member?.onboardingCompletedAt) {
      throw new BadRequestException(
        'Complete onboarding before creating a goal',
      );
    }

    const currentGymFrequency = await this.attendance.getAvgDaysPerWeek(
      memberId,
      4,
    );

    const goal = await this.prisma.$transaction(
      async (tx) => {
        const active = await tx.goal.count({
          where: { memberId, status: { in: NON_TERMINAL } },
        });
        if (active >= cap) {
          throw new BadRequestException(
            `You have ${active} active goals. Complete or abandon one to create another.`,
          );
        }
        return tx.goal.create({
          data: {
            memberId,
            title: dto.title,
            category: dto.category,
            metric: dto.metric,
            startingValue: new Prisma.Decimal(dto.startingValue),
            targetValue: new Prisma.Decimal(dto.targetValue),
            currentGymFrequency,
            userDeadline: dto.userDeadline ? new Date(dto.userDeadline) : null,
            userRequestedFrequency: dto.requestedFrequency ?? null,
            status: GoalStatus.ACTIVE,
            generationStatus: 'GENERATING',
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    this.eventEmitter.emit('goal.generation.requested', {
      goalId: goal.id,
      memberId,
      requestedFrequency: dto.requestedFrequency ?? null,
    });

    return sanitizeGoal(goal);
  }

  async list(memberId: string, query: ListGoalsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.GoalWhereInput = {
      memberId,
      ...(query.status?.length ? { status: { in: query.status } } : {}),
    };
    const [rows, total, activeCount, settings] = await Promise.all([
      this.prisma.goal.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          progressLogs: { orderBy: { loggedAt: 'desc' }, take: 1 },
        },
      }),
      this.prisma.goal.count({ where }),
      this.prisma.goal.count({
        where: { memberId, status: { in: NON_TERMINAL } },
      }),
      this.settings.getCachedSettings(),
    ]);
    return {
      data: rows.map((g) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { planItems, milestones, progressLogs, ...rest } =
          sanitizeGoal(g);
        return rest;
      }),
      total,
      page,
      limit,
      activeCount,
      cap: settings?.maxActiveGoalsPerMember ?? 3,
    };
  }

  async findOne(memberId: string, goalId: string) {
    const goal = await this.prisma.goal.findFirst({
      where: { id: goalId, memberId },
      include: {
        planItems: {
          orderBy: [
            { weekNumber: 'asc' },
            { dayLabel: 'asc' },
            { exerciseOrder: 'asc' },
          ],
        },
        milestones: { orderBy: { weekNumber: 'asc' } },
        progressLogs: { orderBy: { loggedAt: 'desc' }, take: 50 },
      },
    });
    if (!goal) throw new NotFoundException('Goal not found');
    return sanitizeGoal(goal, { includeError: true });
  }

  async update(memberId: string, goalId: string, dto: UpdateGoalDto) {
    const goal = await this.prisma.goal.findFirst({
      where: { id: goalId, memberId },
    });
    if (!goal) throw new NotFoundException('Goal not found');

    if (dto.status && dto.status !== goal.status) {
      const allowed = ALLOWED_TRANSITIONS[goal.status];
      if (!allowed.includes(dto.status)) {
        throw new BadRequestException(
          `Cannot transition from ${goal.status} to ${dto.status}`,
        );
      }
    }

    if (dto.userDeadline && new Date(dto.userDeadline) <= new Date()) {
      throw new BadRequestException('userDeadline must be a future date');
    }

    const updated = await this.prisma.goal.update({
      where: { id: goalId },
      data: {
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.userDeadline !== undefined && {
          userDeadline: dto.userDeadline ? new Date(dto.userDeadline) : null,
        }),
      },
    });
    return sanitizeGoal(updated);
  }

  async remove(memberId: string, goalId: string) {
    const { count } = await this.prisma.goal.deleteMany({
      where: { id: goalId, memberId },
    });
    if (count === 0) throw new NotFoundException('Goal not found');
    return { deleted: true };
  }

  async assertOwnership(memberId: string, goalId: string) {
    const goal = await this.prisma.goal.findFirst({
      where: { id: goalId, memberId },
      select: { id: true },
    });
    if (!goal) throw new ForbiddenException('Access denied');
  }

  async addProgressLog(
    memberId: string,
    goalId: string,
    dto: CreateProgressLogDto,
  ) {
    const goal = await this.prisma.goal.findFirst({
      where: { id: goalId, memberId },
      select: { id: true, category: true },
    });
    if (!goal) throw new NotFoundException('Goal not found');

    const log = await this.prisma.$transaction(async (tx) => {
      const created = await tx.goalProgressLog.create({
        data: {
          goalId,
          value: new Prisma.Decimal(dto.value),
          note: dto.note ?? null,
        },
      });

      const milestones = await tx.goalMilestone.findMany({
        where: { goalId, completed: false, targetValue: { not: null } },
      });
      const weightLoss = goal.category === 'WEIGHT_LOSS';
      const toComplete = milestones.filter((m) =>
        weightLoss
          ? Number(m.targetValue) >= dto.value
          : Number(m.targetValue) <= dto.value,
      );
      if (toComplete.length > 0) {
        await tx.goalMilestone.updateMany({
          where: { id: { in: toComplete.map((m) => m.id) } },
          data: { completed: true, completedAt: new Date() },
        });
      }

      return created;
    });

    return {
      id: log.id,
      value: Number(log.value),
      note: log.note,
      loggedAt: log.loggedAt,
    };
  }

  async removeProgressLog(memberId: string, goalId: string, logId: string) {
    await this.assertOwnership(memberId, goalId);
    const { count } = await this.prisma.goalProgressLog.deleteMany({
      where: { id: logId, goalId },
    });
    if (count === 0) throw new NotFoundException('Progress log not found');
    return { deleted: true };
  }

  async addPlanItem(memberId: string, goalId: string, dto: CreatePlanItemDto) {
    await this.assertOwnership(memberId, goalId);
    const item = await this.prisma.goalPlanItem.create({
      data: {
        goalId,
        weekNumber: dto.weekNumber,
        dayLabel: dto.dayLabel,
        exerciseOrder: dto.exerciseOrder,
        description: dto.description,
        workoutType: dto.workoutType ?? null,
        muscleGroup: dto.muscleGroup ?? null,
        sets: dto.sets ?? null,
        reps: dto.reps ?? null,
        weight: dto.weight != null ? new Prisma.Decimal(dto.weight) : null,
        duration: dto.duration ?? null,
        restSeconds: dto.restSeconds ?? null,
        distanceKm:
          dto.distanceKm != null ? new Prisma.Decimal(dto.distanceKm) : null,
        paceMinPerKm:
          dto.paceMinPerKm != null
            ? new Prisma.Decimal(dto.paceMinPerKm)
            : null,
        notes: dto.notes ?? null,
      },
    });
    return sanitizePlanItem(item);
  }

  async updatePlanItem(
    memberId: string,
    goalId: string,
    itemId: string,
    dto: UpdatePlanItemDto,
  ) {
    await this.assertOwnership(memberId, goalId);
    const { completed, ...rest } = dto;
    const data: Record<string, unknown> = { ...rest };
    if (completed !== undefined) {
      data.completed = completed;
      data.completedAt = completed ? new Date() : null;
    }
    if (dto.weight !== undefined) {
      data.weight = dto.weight != null ? new Prisma.Decimal(dto.weight) : null;
    }
    if (dto.distanceKm !== undefined) {
      data.distanceKm =
        dto.distanceKm != null ? new Prisma.Decimal(dto.distanceKm) : null;
    }
    if (dto.paceMinPerKm !== undefined) {
      data.paceMinPerKm =
        dto.paceMinPerKm != null ? new Prisma.Decimal(dto.paceMinPerKm) : null;
    }
    const item = await this.prisma.goalPlanItem.update({
      where: { id: itemId, goalId },
      data,
    });
    return sanitizePlanItem(item);
  }

  async removePlanItem(memberId: string, goalId: string, itemId: string) {
    await this.assertOwnership(memberId, goalId);
    const { count } = await this.prisma.goalPlanItem.deleteMany({
      where: { id: itemId, goalId },
    });
    if (count === 0) throw new NotFoundException('Plan item not found');
    return { deleted: true };
  }

  async addMilestone(
    memberId: string,
    goalId: string,
    dto: CreateMilestoneDto,
  ) {
    await this.assertOwnership(memberId, goalId);
    const milestone = await this.prisma.goalMilestone.create({
      data: {
        goalId,
        weekNumber: dto.weekNumber,
        description: dto.description,
        targetValue:
          dto.targetValue != null ? new Prisma.Decimal(dto.targetValue) : null,
      },
    });
    return sanitizeMilestone(milestone);
  }

  async updateMilestone(
    memberId: string,
    goalId: string,
    milestoneId: string,
    dto: UpdateMilestoneDto,
  ) {
    await this.assertOwnership(memberId, goalId);
    const { completed, targetValue, ...rest } = dto;
    const data: Record<string, unknown> = { ...rest };
    if (completed !== undefined) {
      data.completed = completed;
      data.completedAt = completed ? new Date() : null;
    }
    if (targetValue !== undefined) {
      data.targetValue =
        targetValue != null ? new Prisma.Decimal(targetValue) : null;
    }
    const milestone = await this.prisma.goalMilestone.update({
      where: { id: milestoneId, goalId },
      data,
    });
    return sanitizeMilestone(milestone);
  }

  async retryGeneration(memberId: string, goalId: string) {
    const { count } = await this.prisma.goal.updateMany({
      where: { id: goalId, memberId, generationStatus: 'FAILED' },
      data: {
        generationStatus: 'GENERATING',
        generationError: null,
        generationStartedAt: new Date(),
      },
    });

    if (count === 0) {
      const goal = await this.prisma.goal.findFirst({
        where: { id: goalId, memberId },
        select: { id: true, generationStatus: true },
      });
      if (!goal) throw new NotFoundException('Goal not found');
      throw new BadRequestException('Only FAILED goals can be retried');
    }

    const updated = await this.prisma.goal.findFirstOrThrow({
      where: { id: goalId, memberId },
    });

    this.eventEmitter.emit('goal.generation.requested', {
      goalId,
      memberId,
      requestedFrequency: updated.userRequestedFrequency ?? null,
    });
    return sanitizeGoal(updated, { includeError: true });
  }

  async removeMilestone(memberId: string, goalId: string, milestoneId: string) {
    await this.assertOwnership(memberId, goalId);
    const { count } = await this.prisma.goalMilestone.deleteMany({
      where: { id: milestoneId, goalId },
    });
    if (count === 0) throw new NotFoundException('Milestone not found');
    return { deleted: true };
  }
}
