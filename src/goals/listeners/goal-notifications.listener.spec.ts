import { Test } from '@nestjs/testing';
import { GoalNotificationsListener } from './goal-notifications.listener';
import { NotificationsService } from '../../notifications/notifications.service';
import { NotificationType } from '@prisma/client';

describe('GoalNotificationsListener', () => {
  let listener: GoalNotificationsListener;
  const notifications = { create: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        GoalNotificationsListener,
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();
    listener = moduleRef.get(GoalNotificationsListener);
  });

  it('creates GOAL_PLAN_READY notification when plan is ready', async () => {
    await listener.handleReady({
      memberId: 'm1',
      goalId: 'g1',
      title: 'Bench 120kg',
    });
    expect(notifications.create).toHaveBeenCalledWith({
      userId: 'm1',
      title: 'Your plan is ready',
      body: expect.stringContaining('Bench 120kg'),
      type: NotificationType.GOAL_PLAN_READY,
      metadata: { goalId: 'g1' },
    });
  });

  it('creates GOAL_PLAN_FAILED notification when plan fails', async () => {
    await listener.handleFailed({ memberId: 'm1', goalId: 'g1' });
    expect(notifications.create).toHaveBeenCalledWith({
      userId: 'm1',
      title: 'Plan generation failed',
      body: expect.any(String),
      type: NotificationType.GOAL_PLAN_FAILED,
      metadata: { goalId: 'g1' },
    });
  });
});
