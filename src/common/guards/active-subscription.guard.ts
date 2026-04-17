import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ALLOW_INACTIVE_SUBSCRIPTION_KEY } from '../decorators/allow-inactive-subscription.decorator';
import { SubscriptionsService } from '../../subscriptions/subscriptions.service';

const STAFF_ROLES = new Set(['ADMIN', 'SUPER_ADMIN', 'TRAINER']);

@Injectable()
export class ActiveSubscriptionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      user?: { id: string; role: string };
    }>();
    const user = request.user;

    if (!user) return false;

    const allowInactive = this.reflector.getAllAndOverride<boolean>(
      ALLOW_INACTIVE_SUBSCRIPTION_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (allowInactive) return true;

    if (STAFF_ROLES.has(user.role)) return true;

    const active = await this.subscriptionsService.hasActiveSubscription(
      user.id,
    );
    if (!active) {
      throw new ForbiddenException('Active subscription required');
    }
    return true;
  }
}
