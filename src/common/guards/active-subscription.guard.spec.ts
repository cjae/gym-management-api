import { Test } from '@nestjs/testing';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ActiveSubscriptionGuard } from './active-subscription.guard';
import { SubscriptionsService } from '../../subscriptions/subscriptions.service';

describe('ActiveSubscriptionGuard', () => {
  let guard: ActiveSubscriptionGuard;
  let reflector: Reflector;
  const subscriptionsService = {
    hasActiveSubscription: jest.fn(),
  };

  const buildContext = (user: unknown): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
      getHandler: () => ({}),
      getClass: () => ({}),
    }) as unknown as ExecutionContext;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ActiveSubscriptionGuard,
        Reflector,
        { provide: SubscriptionsService, useValue: subscriptionsService },
      ],
    }).compile();
    guard = moduleRef.get(ActiveSubscriptionGuard);
    reflector = moduleRef.get(Reflector);
    jest.clearAllMocks();
  });

  it('passes when no user is attached (JwtAuthGuard will block)', async () => {
    await expect(guard.canActivate(buildContext(undefined))).resolves.toBe(
      true,
    );
  });

  it('passes when handler is marked with @AllowInactiveSubscription()', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValueOnce(true);
    await expect(
      guard.canActivate(buildContext({ id: 'u1', role: 'MEMBER' })),
    ).resolves.toBe(true);
    expect(subscriptionsService.hasActiveSubscription).not.toHaveBeenCalled();
  });

  it('passes for ADMIN role without checking subscription', async () => {
    await expect(
      guard.canActivate(buildContext({ id: 'admin', role: 'ADMIN' })),
    ).resolves.toBe(true);
    expect(subscriptionsService.hasActiveSubscription).not.toHaveBeenCalled();
  });

  it('passes for SUPER_ADMIN and TRAINER too', async () => {
    for (const role of ['SUPER_ADMIN', 'TRAINER']) {
      await expect(
        guard.canActivate(buildContext({ id: 'u', role })),
      ).resolves.toBe(true);
    }
    expect(subscriptionsService.hasActiveSubscription).not.toHaveBeenCalled();
  });

  it('passes for MEMBER with an active subscription', async () => {
    subscriptionsService.hasActiveSubscription.mockResolvedValue(true);
    await expect(
      guard.canActivate(buildContext({ id: 'm1', role: 'MEMBER' })),
    ).resolves.toBe(true);
    expect(subscriptionsService.hasActiveSubscription).toHaveBeenCalledWith(
      'm1',
    );
  });

  it('throws ForbiddenException for MEMBER without an active subscription', async () => {
    subscriptionsService.hasActiveSubscription.mockResolvedValue(false);
    await expect(
      guard.canActivate(buildContext({ id: 'm1', role: 'MEMBER' })),
    ).rejects.toThrow(ForbiddenException);
  });
});
