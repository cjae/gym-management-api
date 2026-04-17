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
import { sanitizeGoal } from './goals.sanitizer';
import { UpdateGoalDto } from './dto/update-goal.dto';

const NON_TERMINAL = [GoalStatus.ACTIVE, GoalStatus.PAUSED];

const ALLOWED_TRANSITIONS: Record<GoalStatus, GoalStatus[]> = {
  ACTIVE: [GoalStatus.PAUSED, GoalStatus.ABANDONED, GoalStatus.COMPLETED],
  PAUSED: [GoalStatus.ACTIVE],
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
    const cap = settings.maxActiveGoalsPerMember ?? 3;

    const active = await this.prisma.goal.count({
      where: { memberId, status: { in: NON_TERMINAL } },
    });
    if (active >= cap) {
      throw new BadRequestException(
        `You have ${active} active goals. Complete or abandon one to create another.`,
      );
    }

    const currentGymFrequency = await this.attendance.getAvgDaysPerWeek(
      memberId,
      4,
    );

    const goal = await this.prisma.goal.create({
      data: {
        memberId,
        title: dto.title,
        category: dto.category,
        metric: dto.metric,
        currentValue: new Prisma.Decimal(dto.currentValue),
        targetValue: new Prisma.Decimal(dto.targetValue),
        currentGymFrequency,
        userDeadline: dto.userDeadline ?? null,
        recommendedGymFrequency: dto.requestedFrequency ?? null,
        status: GoalStatus.ACTIVE,
        generationStatus: 'GENERATING',
      },
    });

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
      ...(query.status ? { status: query.status } : {}),
    };
    const [rows, total, activeCount, settings] = await Promise.all([
      this.prisma.goal.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.goal.count({ where }),
      this.prisma.goal.count({
        where: { memberId, status: { in: NON_TERMINAL } },
      }),
      this.settings.getCachedSettings(),
    ]);
    return {
      data: rows.map((g) => sanitizeGoal(g)),
      total,
      page,
      limit,
      activeCount,
      cap: settings.maxActiveGoalsPerMember ?? 3,
    };
  }

  async findOne(memberId: string, goalId: string) {
    const goal = await this.prisma.goal.findFirst({
      where: { id: goalId, memberId },
      include: {
        planItems: { orderBy: [{ weekNumber: 'asc' }, { dayLabel: 'asc' }] },
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

    const updated = await this.prisma.goal.update({
      where: { id: goalId },
      data: { ...dto },
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
}
