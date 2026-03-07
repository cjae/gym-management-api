import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { getNextBillingDate } from '../common/utils/billing.util';

@Injectable()
export class SubscriptionsService {
  constructor(private prisma: PrismaService) {}

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

    return this.prisma.memberSubscription.create({
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
          status: 'ACTIVE',
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

  async findAll() {
    const subscriptions = await this.prisma.memberSubscription.findMany({
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
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    return subscriptions.map(({ paystackAuthorizationCode, ...sub }) => sub);
  }

  async cancel(subscriptionId: string, requesterId: string) {
    const subscription = await this.prisma.memberSubscription.findUnique({
      where: { id: subscriptionId },
    });

    if (!subscription) {
      throw new NotFoundException(
        `Subscription with id ${subscriptionId} not found`,
      );
    }

    if (subscription.primaryMemberId !== requesterId) {
      throw new ForbiddenException(
        'Only the subscription owner can cancel the subscription',
      );
    }

    return this.prisma.memberSubscription.update({
      where: { id: subscriptionId },
      data: { autoRenew: false },
    });
  }
}
