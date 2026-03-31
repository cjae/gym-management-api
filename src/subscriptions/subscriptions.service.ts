import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  NotificationType,
  PaymentMethod,
  Role,
  SubscriptionStatus,
  UserStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { DiscountCodesService } from '../discount-codes/discount-codes.service';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { AdminCreateSubscriptionDto } from './dto/admin-create-subscription.dto';
import { getNextBillingDate } from '../common/utils/billing.util';
import { ADMIN_PAYMENT_METHODS } from '../common/constants/payment-methods';

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    private prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly notificationsService: NotificationsService,
    private readonly discountCodesService: DiscountCodesService,
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
    if (!plan.isActive) {
      throw new BadRequestException('Subscription plan is not active');
    }

    const hasActive = await this.hasActiveSubscription(memberId);
    if (hasActive) {
      throw new BadRequestException(
        'Member already has an active subscription',
      );
    }

    const startDate = new Date();
    const endDate = getNextBillingDate(startDate, plan.billingInterval);

    const member = await this.prisma.user.findUnique({
      where: { id: memberId },
      select: { firstName: true, lastName: true },
    });

    // Check for existing PENDING subscription — update it instead of creating a new one
    const existingPending = await this.prisma.memberSubscription.findFirst({
      where: {
        primaryMemberId: memberId,
        status: SubscriptionStatus.PENDING,
      },
    });

    const include = { plan: true, members: true } as const;

    const subscription = await this.prisma.$transaction(async (tx) => {
      // Reverse any prior discount redemption on existing PENDING subscription
      if (existingPending) {
        await this.discountCodesService.reverseRedemption(
          tx,
          existingPending.id,
        );
      }

      // Validate discount code inside transaction to prevent TOCTOU race
      let discountResult: {
        discountCode: {
          id: string;
          discountType: string;
          discountValue: number;
          maxUses: number | null;
          maxUsesPerMember: number | null;
        };
        finalPrice: number;
        originalPrice: number;
      } | null = null;

      if (dto.discountCode) {
        discountResult = await this.discountCodesService.validateCode(
          dto.discountCode,
          dto.planId,
          memberId,
        );
      }

      const discountCodeId = discountResult?.discountCode.id ?? null;
      const discountAmount = discountResult
        ? discountResult.originalPrice - discountResult.finalPrice
        : null;

      const sub = existingPending
        ? await tx.memberSubscription.update({
            where: { id: existingPending.id },
            data: {
              planId: dto.planId,
              startDate,
              endDate,
              paymentMethod: dto.paymentMethod,
              nextBillingDate: endDate,
              discountCodeId,
              discountAmount,
              originalPlanPrice: plan.price,
            },
            include,
          })
        : await tx.memberSubscription.create({
            data: {
              primaryMemberId: memberId,
              planId: dto.planId,
              startDate,
              endDate,
              status: SubscriptionStatus.PENDING,
              paymentMethod: dto.paymentMethod,
              nextBillingDate: endDate,
              discountCodeId,
              discountAmount,
              originalPlanPrice: plan.price,
              members: {
                create: {
                  memberId,
                },
              },
            },
            include,
          });

      if (discountResult) {
        await this.discountCodesService.redeemCode(
          tx,
          discountResult.discountCode.id,
          memberId,
          sub.id,
          discountResult.originalPrice,
          discountResult.finalPrice,
          discountResult.discountCode.maxUses,
          discountResult.discountCode.maxUsesPerMember,
        );
      }

      return sub;
    });

    const memberName = member
      ? `${member.firstName} ${member.lastName}`
      : 'Unknown member';
    const planName = plan.name;

    this.eventEmitter.emit('activity.subscription', {
      type: 'subscription',
      description: `${memberName} started a ${planName} subscription (pending payment)`,
      timestamp: new Date().toISOString(),
      metadata: {
        subscriptionId: subscription.id,
        planName,
        status: SubscriptionStatus.PENDING,
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { paystackAuthorizationCode, ...safe } = subscription;
    return safe;
  }

  async adminCreate(adminId: string, dto: AdminCreateSubscriptionDto) {
    // Validate target user exists and is a MEMBER
    const member = await this.prisma.user.findUnique({
      where: { id: dto.memberId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        role: true,
        status: true,
      },
    });
    if (!member) {
      throw new NotFoundException(`User with id ${dto.memberId} not found`);
    }
    if (member.role !== Role.MEMBER) {
      throw new BadRequestException(
        'Can only create subscriptions for users with MEMBER role',
      );
    }
    if (
      member.status === UserStatus.INACTIVE ||
      member.status === UserStatus.SUSPENDED
    ) {
      throw new BadRequestException(
        'Cannot create subscription for an inactive or suspended member',
      );
    }

    // Validate plan exists and is active
    const plan = await this.prisma.subscriptionPlan.findUnique({
      where: { id: dto.planId },
    });
    if (!plan) {
      throw new NotFoundException(
        `Subscription plan with id ${dto.planId} not found`,
      );
    }
    if (!plan.isActive) {
      throw new BadRequestException('Subscription plan is not active');
    }

    // Check member doesn't already have an active subscription
    const hasActive = await this.hasActiveSubscription(dto.memberId);
    if (hasActive) {
      throw new BadRequestException(
        'Member already has an active subscription',
      );
    }

    const startDate = new Date();
    const endDate = getNextBillingDate(startDate, plan.billingInterval);

    // Check for existing PENDING subscription — update it instead of creating a new one
    const existingPending = await this.prisma.memberSubscription.findFirst({
      where: {
        primaryMemberId: dto.memberId,
        status: SubscriptionStatus.PENDING,
      },
    });

    const txInclude = { plan: true, members: true } as const;

    const amount =
      dto.paymentMethod === PaymentMethod.COMPLIMENTARY ? 0 : plan.price;

    const subscription = await this.prisma.$transaction(async (tx) => {
      // Reverse any prior discount redemption on existing PENDING subscription
      if (existingPending) {
        await this.discountCodesService.reverseRedemption(
          tx,
          existingPending.id,
        );
      }

      const txData = {
        planId: dto.planId,
        startDate,
        endDate,
        status: SubscriptionStatus.ACTIVE,
        paymentMethod: dto.paymentMethod,
        nextBillingDate: endDate,
        autoRenew: false,
        createdBy: adminId,
        paymentNote: dto.paymentNote,
      };

      const sub = existingPending
        ? await tx.memberSubscription.update({
            where: { id: existingPending.id },
            data: txData,
            include: txInclude,
          })
        : await tx.memberSubscription.create({
            data: {
              ...txData,
              primaryMemberId: dto.memberId,
              members: {
                create: {
                  memberId: dto.memberId,
                },
              },
            },
            include: txInclude,
          });

      await tx.payment.create({
        data: {
          subscriptionId: sub.id,
          amount,
          paymentMethod: dto.paymentMethod,
          status: 'PAID',
          paystackReference: dto.paymentReference,
          paymentNote: dto.paymentNote,
        },
      });

      return sub;
    });

    const memberName = `${member.firstName} ${member.lastName}`;
    this.eventEmitter.emit('activity.subscription', {
      type: 'subscription',
      description: `Admin created a ${plan.name} subscription for ${memberName}`,
      timestamp: new Date().toISOString(),
      metadata: {
        subscriptionId: subscription.id,
        planName: plan.name,
        status: SubscriptionStatus.ACTIVE,
        createdBy: adminId,
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { paystackAuthorizationCode, ...safe } = subscription;
    return safe;
  }

  async updatePaymentReference(
    subscriptionId: string,
    paymentReference: string,
  ) {
    const subscription = await this.prisma.memberSubscription.findUnique({
      where: { id: subscriptionId },
      select: { id: true, paymentMethod: true },
    });

    if (!subscription) {
      throw new NotFoundException(
        `Subscription with id ${subscriptionId} not found`,
      );
    }

    if (!ADMIN_PAYMENT_METHODS.includes(subscription.paymentMethod as any)) {
      throw new BadRequestException(
        'Payment reference can only be updated for offline/in-person subscriptions',
      );
    }

    const payment = await this.prisma.payment.findFirst({
      where: { subscriptionId },
      orderBy: { createdAt: 'desc' },
    });

    if (!payment) {
      throw new NotFoundException(
        `No payment found for subscription ${subscriptionId}`,
      );
    }

    return this.prisma.payment.update({
      where: { id: payment.id },
      data: { paystackReference: paymentReference },
      select: {
        id: true,
        subscriptionId: true,
        amount: true,
        currency: true,
        status: true,
        paymentMethod: true,
        paystackReference: true,
        paymentNote: true,
        createdAt: true,
        updatedAt: true,
      },
    });
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
        status: { not: 'PENDING' as SubscriptionStatus },
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
    const where = { status: { not: 'PENDING' as SubscriptionStatus } };
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
        where,
        include,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.memberSubscription.count({ where }),
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
    reason?: string,
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
      data: {
        autoRenew: false,
        ...(reason && { cancellationReason: reason }),
      },
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

    this.notificationsService
      .create({
        userId: subscription.primaryMemberId,
        title: 'Subscription Updated',
        body: 'Your subscription has been cancelled',
        type: NotificationType.STATUS_CHANGE,
        metadata: {
          subscriptionId: subscription.id,
          status: 'CANCELLED',
        },
      })
      .catch(() => {});

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { paystackAuthorizationCode, ...safe } = result;
    return safe;
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

    const remainingFreezeDays =
      subscription.plan.maxFreezeDays - subscription.frozenDaysUsed;
    if (days > remainingFreezeDays) {
      throw new BadRequestException(
        `Freeze duration cannot exceed ${remainingFreezeDays} remaining days (max ${subscription.plan.maxFreezeDays} per cycle)`,
      );
    }

    if (subscription.freezeCount >= subscription.plan.maxFreezeCount) {
      throw new BadRequestException(
        `Maximum freeze count (${subscription.plan.maxFreezeCount}) reached this billing cycle`,
      );
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

    this.notificationsService
      .create({
        userId: subscription.primaryMemberId,
        title: 'Subscription Updated',
        body: 'Your subscription has been frozen',
        type: NotificationType.STATUS_CHANGE,
        metadata: {
          subscriptionId: subscription.id,
          status: 'FROZEN',
        },
      })
      .catch(() => {});

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { paystackAuthorizationCode, ...safe } = result;
    return safe;
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
        frozenDaysUsed: { increment: frozenDays },
        freezeCount: { increment: 1 },
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

    this.notificationsService
      .create({
        userId: subscription.primaryMemberId,
        title: 'Subscription Updated',
        body: 'Your subscription has been unfrozen',
        type: NotificationType.STATUS_CHANGE,
        metadata: {
          subscriptionId: subscription.id,
          status: 'ACTIVE',
        },
      })
      .catch(() => {});

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { paystackAuthorizationCode, ...safe } = result;
    return safe;
  }

  @Cron(CronExpression.EVERY_HOUR, { timeZone: 'Africa/Nairobi' })
  async cleanupPendingSubscriptions() {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const staleSubscriptions = await this.prisma.memberSubscription.findMany({
      where: {
        status: 'PENDING' as SubscriptionStatus,
        createdAt: { lt: oneHourAgo },
      },
      select: { id: true },
    });

    if (staleSubscriptions.length === 0) return;

    const ids = staleSubscriptions.map((s) => s.id);

    // Delete in order: reverse discounts → payments → subscription members → subscriptions (FK constraints)
    await this.prisma.$transaction(async (tx) => {
      // Reverse discount redemptions (decrements currentUses and deletes records)
      for (const sub of staleSubscriptions) {
        await this.discountCodesService.reverseRedemption(tx, sub.id);
      }

      await tx.payment.deleteMany({
        where: { subscriptionId: { in: ids } },
      });
      await tx.subscriptionMember.deleteMany({
        where: { subscriptionId: { in: ids } },
      });
      await tx.memberSubscription.deleteMany({
        where: { id: { in: ids } },
      });
    });

    this.logger.log(
      `Cleaned up ${staleSubscriptions.length} stale pending subscription(s)`,
    );
  }
}
