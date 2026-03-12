import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { getNextBillingDate } from '../common/utils/billing.util';

@Injectable()
export class SubscriptionsService {
  constructor(
    private prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async create(memberId: string, dto: CreateSubscriptionDto) {
    const plan = await this.prisma.subscriptionPlan.findUnique({
      where: { id: dto.planId },
    });
    if (!plan) {
      throw new NotFoundException(
        `Subscription plan with id ${dto.planId} not found`,
      );
    }

    const startDate = new Date();
    const endDate = getNextBillingDate(startDate, plan.billingInterval);

    const member = await this.prisma.user.findUnique({
      where: { id: memberId },
      select: { firstName: true, lastName: true },
    });

    const subscription = await this.prisma.memberSubscription.create({
      data: {
        primaryMemberId: memberId,
        planId: dto.planId,
        startDate,
        endDate,
        paymentMethod: dto.paymentMethod,
        nextBillingDate: endDate,
        members: {
          create: {
            memberId,
          },
        },
      },
      include: {
        plan: true,
        members: true,
      },
    });

    const memberName = member
      ? `${member.firstName} ${member.lastName}`
      : 'Unknown member';
    const planName = plan.name;

    this.eventEmitter.emit('activity.subscription', {
      type: 'subscription',
      description: `${memberName} started a ${planName} subscription`,
      timestamp: new Date().toISOString(),
      metadata: {
        subscriptionId: subscription.id,
        planName,
        status: SubscriptionStatus.ACTIVE,
      },
    });

    return subscription;
  }

  async addDuoMember(
    subscriptionId: string,
    memberEmail: string,
    requesterId: string,
  ) {
    const subscription = await this.prisma.memberSubscription.findUnique({
      where: { id: subscriptionId },
      include: { plan: true, members: true },
    });

    if (!subscription) {
      throw new NotFoundException(
        `Subscription with id ${subscriptionId} not found`,
      );
    }

    if (subscription.primaryMemberId !== requesterId) {
      throw new ForbiddenException(
        'Only the subscription owner can add duo members',
      );
    }

    if (subscription.members.length >= subscription.plan.maxMembers) {
      throw new BadRequestException(
        `This plan allows a maximum of ${subscription.plan.maxMembers} member(s)`,
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { email: memberEmail },
    });
    if (!user) {
      throw new NotFoundException(`User with email ${memberEmail} not found`);
    }

    return this.prisma.subscriptionMember.create({
      data: {
        subscriptionId,
        memberId: user.id,
      },
    });
  }

  async hasActiveSubscription(memberId: string): Promise<boolean> {
    const now = new Date();
    const member = await this.prisma.subscriptionMember.findFirst({
      where: {
        memberId,
        subscription: {
          status: SubscriptionStatus.ACTIVE,
          endDate: { gte: now },
        },
      },
    });
    return !!member;
  }

  async findByMember(memberId: string) {
    const subscriptions = await this.prisma.memberSubscription.findMany({
      where: {
        members: {
          some: { memberId },
        },
      },
      include: {
        plan: true,
        members: {
          include: {
            member: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        },
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    return subscriptions.map(({ paystackAuthorizationCode, ...sub }) => sub);
  }

  async findAll(page: number = 1, limit: number = 20) {
    const include = {
      primaryMember: {
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
        },
      },
      plan: true,
      members: {
        include: {
          member: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      },
    };

    const [subscriptions, total] = await Promise.all([
      this.prisma.memberSubscription.findMany({
        include,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.memberSubscription.count(),
    ]);

    const data = subscriptions.map(
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      ({ paystackAuthorizationCode, ...sub }) => sub,
    );
    return { data, total, page, limit };
  }

  async findOne(subscriptionId: string) {
    const subscription = await this.prisma.memberSubscription.findUnique({
      where: { id: subscriptionId },
      include: {
        primaryMember: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
          },
        },
        plan: true,
        members: {
          include: {
            member: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        },
      },
    });

    if (!subscription) {
      throw new NotFoundException(
        `Subscription with id ${subscriptionId} not found`,
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { paystackAuthorizationCode, ...result } = subscription;
    return result;
  }

  async cancel(
    subscriptionId: string,
    requesterId: string,
    requesterRole: string,
  ) {
    const subscription = await this.prisma.memberSubscription.findUnique({
      where: { id: subscriptionId },
      include: {
        plan: true,
        primaryMember: {
          select: { firstName: true, lastName: true },
        },
      },
    });

    if (!subscription) {
      throw new NotFoundException(
        `Subscription with id ${subscriptionId} not found`,
      );
    }

    const isOwner = subscription.primaryMemberId === requesterId;
    const isAdmin =
      requesterRole === 'ADMIN' || requesterRole === 'SUPER_ADMIN';
    if (!isOwner && !isAdmin) {
      throw new ForbiddenException(
        'Only the subscription owner or an admin can cancel the subscription',
      );
    }

    const result = await this.prisma.memberSubscription.update({
      where: { id: subscriptionId },
      data: { autoRenew: false },
    });

    const memberName = `${subscription.primaryMember.firstName} ${subscription.primaryMember.lastName}`;
    const planName = subscription.plan.name;

    this.eventEmitter.emit('activity.subscription', {
      type: 'subscription',
      description: `${memberName} cancelled their ${planName} subscription`,
      timestamp: new Date().toISOString(),
      metadata: {
        subscriptionId,
        planName,
        status: SubscriptionStatus.CANCELLED,
      },
    });

    return result;
  }

  async freeze(
    subscriptionId: string,
    requesterId: string,
    requesterRole: string,
    days: number,
  ) {
    const subscription = await this.prisma.memberSubscription.findUnique({
      where: { id: subscriptionId },
      include: {
        plan: true,
        primaryMember: { select: { firstName: true, lastName: true } },
      },
    });

    if (!subscription) {
      throw new NotFoundException(
        `Subscription with id ${subscriptionId} not found`,
      );
    }

    const isOwner = subscription.primaryMemberId === requesterId;
    const isAdmin =
      requesterRole === 'ADMIN' || requesterRole === 'SUPER_ADMIN';
    if (!isOwner && !isAdmin) {
      throw new ForbiddenException(
        'Only the subscription owner or an admin can freeze the subscription',
      );
    }

    if (subscription.status !== 'ACTIVE') {
      throw new BadRequestException('Only active subscriptions can be frozen');
    }

    if (subscription.plan.maxFreezeDays === 0) {
      throw new BadRequestException('This plan does not support freezing');
    }

    if (days > subscription.plan.maxFreezeDays) {
      throw new BadRequestException(
        `Freeze duration cannot exceed ${subscription.plan.maxFreezeDays} days`,
      );
    }

    if (subscription.frozenDaysUsed > 0) {
      throw new BadRequestException('Freeze already used this billing cycle');
    }

    const freezeStartDate = new Date();
    const freezeEndDate = new Date();
    freezeEndDate.setDate(freezeEndDate.getDate() + days);

    const result = await this.prisma.memberSubscription.update({
      where: { id: subscriptionId },
      data: {
        status: SubscriptionStatus.FROZEN,
        freezeStartDate,
        freezeEndDate,
      },
      include: { plan: true },
    });

    const memberName = `${subscription.primaryMember.firstName} ${subscription.primaryMember.lastName}`;
    this.eventEmitter.emit('activity.subscription', {
      type: 'subscription',
      description: `${memberName} froze their ${subscription.plan.name} subscription for ${days} days`,
      timestamp: new Date().toISOString(),
      metadata: {
        subscriptionId,
        planName: subscription.plan.name,
        status: SubscriptionStatus.FROZEN,
        days,
      },
    });

    return result;
  }

  async unfreeze(
    subscriptionId: string,
    requesterId: string,
    requesterRole: string,
  ) {
    const subscription = await this.prisma.memberSubscription.findUnique({
      where: { id: subscriptionId },
      include: {
        plan: true,
        primaryMember: { select: { firstName: true, lastName: true } },
      },
    });

    if (!subscription) {
      throw new NotFoundException(
        `Subscription with id ${subscriptionId} not found`,
      );
    }

    const isOwner = subscription.primaryMemberId === requesterId;
    const isAdmin =
      requesterRole === 'ADMIN' || requesterRole === 'SUPER_ADMIN';
    if (!isOwner && !isAdmin) {
      throw new ForbiddenException(
        'Only the subscription owner or an admin can unfreeze the subscription',
      );
    }

    if (subscription.status !== 'FROZEN') {
      throw new BadRequestException(
        'Only frozen subscriptions can be unfrozen',
      );
    }

    const actualFrozenDays = Math.ceil(
      (new Date().getTime() - subscription.freezeStartDate!.getTime()) /
        (1000 * 60 * 60 * 24),
    );
    const frozenDays = Math.max(1, actualFrozenDays);

    const newEndDate = new Date(subscription.endDate);
    newEndDate.setDate(newEndDate.getDate() + frozenDays);

    const newNextBillingDate = subscription.nextBillingDate
      ? new Date(subscription.nextBillingDate)
      : null;
    if (newNextBillingDate) {
      newNextBillingDate.setDate(newNextBillingDate.getDate() + frozenDays);
    }

    const result = await this.prisma.memberSubscription.update({
      where: { id: subscriptionId },
      data: {
        status: SubscriptionStatus.ACTIVE,
        endDate: newEndDate,
        nextBillingDate: newNextBillingDate,
        freezeStartDate: null,
        freezeEndDate: null,
        frozenDaysUsed: frozenDays,
      },
      include: { plan: true },
    });

    const memberName = `${subscription.primaryMember.firstName} ${subscription.primaryMember.lastName}`;
    this.eventEmitter.emit('activity.subscription', {
      type: 'subscription',
      description: `${memberName} unfroze their ${subscription.plan.name} subscription (${frozenDays} days used)`,
      timestamp: new Date().toISOString(),
      metadata: {
        subscriptionId,
        planName: subscription.plan.name,
        status: SubscriptionStatus.ACTIVE,
        frozenDays,
      },
    });

    return result;
  }
}
