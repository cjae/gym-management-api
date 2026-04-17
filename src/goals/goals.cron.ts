import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotificationType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class GoalsCron {
  private readonly logger = new Logger(GoalsCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES, { timeZone: 'Africa/Nairobi' })
  async sweepStaleGenerations() {
    const cutoff = new Date(Date.now() - 10 * 60 * 1000);
    const stale = await this.prisma.goal.findMany({
      where: {
        generationStatus: 'GENERATING',
        generationStartedAt: { lt: cutoff },
      },
      select: { id: true, memberId: true },
    });
    if (stale.length === 0) return;

    await this.prisma.goal.updateMany({
      where: { id: { in: stale.map((g) => g.id) } },
      data: {
        generationStatus: 'FAILED',
        generationError: 'Generation timed out',
      },
    });

    for (const g of stale) {
      this.eventEmitter.emit('goal.plan.failed', {
        goalId: g.id,
        memberId: g.memberId,
      });
    }
    this.logger.log(`Swept ${stale.length} stale goal generations`);
  }

  @Cron('0 9 * * 1', { timeZone: 'Africa/Nairobi' })
  async sendWeeklyMotivation() {
    const activeGoals = await this.prisma.goal.findMany({
      where: { status: 'ACTIVE', generationStatus: 'READY' },
      include: {
        milestones: {
          where: { completed: false },
          orderBy: { weekNumber: 'asc' },
          take: 1,
        },
        progressLogs: { orderBy: { loggedAt: 'desc' }, take: 1 },
      },
    });
    if (activeGoals.length === 0) return;

    const byMember = new Map<string, typeof activeGoals>();
    for (const g of activeGoals) {
      if (!byMember.has(g.memberId)) byMember.set(g.memberId, []);
      byMember.get(g.memberId)!.push(g);
    }

    for (const [memberId, goals] of byMember) {
      const { title, body, goalIds } = this.buildWeeklySummary(goals);
      await this.notifications.create({
        userId: memberId,
        title,
        body,
        type: NotificationType.GOAL_WEEKLY_PULSE,
        metadata: { goalIds },
      });
    }
    this.logger.log(`Sent weekly pulse to ${byMember.size} members`);
  }

  private buildWeeklySummary(
    goals: Array<{
      id: string;
      title: string;
      milestones: { weekNumber: number }[];
      progressLogs: { loggedAt: Date }[];
    }>,
  ) {
    const leadGoal = goals[0];
    const others = goals.length - 1;
    const title = 'Weekly fitness check-in';
    const body =
      others > 0
        ? `Keep up the momentum on "${leadGoal.title}" and ${others} other goal${others > 1 ? 's' : ''}.`
        : `Keep up the momentum on "${leadGoal.title}".`;
    return { title, body, goalIds: goals.map((g) => g.id) };
  }

  @Cron('0 3 * * 0', { timeZone: 'Africa/Nairobi' })
  async cleanupAbandoned() {
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - 90);
    const { count } = await this.prisma.goal.deleteMany({
      where: { status: 'ABANDONED', updatedAt: { lt: cutoff } },
    });
    this.logger.log(`Deleted ${count} abandoned goals older than 90 days`);
  }
}
