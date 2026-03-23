import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  STREAK_MILESTONES,
  CHECKIN_MILESTONES,
  FIRST_CHECKIN,
} from './milestones.constants';
import type {
  StreakUpdatedPayload,
  MilestoneType,
} from './milestones.constants';

@Injectable()
export class MilestonesService {
  private readonly logger = new Logger(MilestonesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  @OnEvent('streak.updated', { async: true })
  async handleStreakUpdated(payload: StreakUpdatedPayload) {
    try {
      const milestones = this.evaluateMilestones(payload);

      for (const milestone of milestones) {
        await this.recordAndNotify(
          payload.memberId,
          milestone.type,
          milestone.value,
          milestone.title,
          milestone.body,
        );
      }
    } catch (err) {
      this.logger.error('Failed to process milestones', err);
    }
  }

  private evaluateMilestones(payload: StreakUpdatedPayload) {
    const milestones: {
      type: MilestoneType;
      value: number;
      title: string;
      body: string;
    }[] = [];

    // First check-in
    if (payload.isFirstCheckIn) {
      milestones.push({
        type: 'FIRST_CHECKIN',
        value: 1,
        title: FIRST_CHECKIN.title,
        body: FIRST_CHECKIN.body,
      });
    }

    // Weekly streak milestones
    const streakMilestone = STREAK_MILESTONES.find(
      (m) => m.value === payload.weeklyStreak,
    );
    if (streakMilestone) {
      milestones.push({
        type: 'WEEKLY_STREAK',
        value: streakMilestone.value,
        title: streakMilestone.title,
        body: streakMilestone.body,
      });
    }

    // Total check-in milestones
    const checkinMilestone = CHECKIN_MILESTONES.find(
      (m) => m.value === payload.totalCheckIns,
    );
    if (checkinMilestone) {
      milestones.push({
        type: 'TOTAL_CHECKINS',
        value: checkinMilestone.value,
        title: checkinMilestone.title,
        body: checkinMilestone.body,
      });
    }

    // Longest streak broken
    if (payload.longestStreak > payload.previousLongestStreak) {
      milestones.push({
        type: 'LONGEST_STREAK',
        value: payload.longestStreak,
        title: 'New streak record!',
        body: `You just beat your longest streak! ${payload.longestStreak} weeks and counting — new personal best!`,
      });
    }

    return milestones;
  }

  private async recordAndNotify(
    memberId: string,
    milestoneType: MilestoneType,
    milestoneValue: number,
    title: string,
    body: string,
  ) {
    try {
      await this.prisma.milestoneNotification.create({
        data: { memberId, milestoneType, milestoneValue },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      )
        return; // Already recorded — skip
      throw err;
    }

    await this.notificationsService.create({
      userId: memberId,
      title,
      body,
      type: NotificationType.MILESTONE,
      metadata: { milestoneType, milestoneValue },
    });
  }
}
