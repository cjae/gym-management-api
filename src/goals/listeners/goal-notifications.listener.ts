import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationType } from '@prisma/client';
import { NotificationsService } from '../../notifications/notifications.service';

@Injectable()
export class GoalNotificationsListener {
  constructor(private readonly notifications: NotificationsService) {}

  @OnEvent('goal.plan.ready', { async: true })
  async handleReady(payload: {
    memberId: string;
    goalId: string;
    title: string;
  }) {
    await this.notifications.create({
      userId: payload.memberId,
      title: 'Your plan is ready',
      body: `Your ${payload.title} plan is ready — open to view.`,
      type: NotificationType.GOAL_PLAN_READY,
      metadata: { goalId: payload.goalId },
    });
  }

  @OnEvent('goal.plan.failed', { async: true })
  async handleFailed(payload: { memberId: string; goalId: string }) {
    await this.notifications.create({
      userId: payload.memberId,
      title: 'Plan generation failed',
      body: `We couldn't generate your plan. Tap to retry.`,
      type: NotificationType.GOAL_PLAN_FAILED,
      metadata: { goalId: payload.goalId },
    });
  }
}
