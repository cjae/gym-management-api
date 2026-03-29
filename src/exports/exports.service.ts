import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ExportMembersQueryDto } from './dto/export-members-query.dto';
import { ExportPaymentsQueryDto } from './dto/export-payments-query.dto';
import { ExportSubscriptionsQueryDto } from './dto/export-subscriptions-query.dto';
import { Prisma } from '@prisma/client';

const EXPORT_LIMIT = 10_000;

@Injectable()
export class ExportsService {
  constructor(private readonly prisma: PrismaService) {}

  async getMembers(query: Omit<ExportMembersQueryDto, 'format'>) {
    const where: Prisma.UserWhereInput = {
      deletedAt: null,
    };

    if (query.status) where.status = query.status;
    if (query.role) where.role = query.role;
    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) where.createdAt.gte = new Date(query.startDate);
      if (query.endDate)
        where.createdAt.lte = new Date(query.endDate + 'T23:59:59.999Z');
    }

    const users = await this.prisma.user.findMany({
      where,
      take: EXPORT_LIMIT,
      select: {
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        gender: true,
        birthday: true,
        status: true,
        createdAt: true,
        subscriptionsOwned: {
          where: { status: 'ACTIVE' },
          take: 1,
          orderBy: { createdAt: 'desc' },
          select: {
            status: true,
            endDate: true,
            paymentMethod: true,
            plan: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return users.map((user) => {
      const sub = user.subscriptionsOwned[0];
      return {
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone || '',
        gender: user.gender || '',
        birthday: user.birthday
          ? user.birthday.toISOString().split('T')[0]
          : '',
        status: user.status,
        joinDate: user.createdAt.toISOString().split('T')[0],
        currentPlan: sub?.plan?.name || '',
        subscriptionStatus: sub?.status || '',
        subscriptionEndDate: sub?.endDate
          ? sub.endDate.toISOString().split('T')[0]
          : '',
        paymentMethod: sub?.paymentMethod || '',
      };
    });
  }

  async getPayments(query: Omit<ExportPaymentsQueryDto, 'format'>) {
    const where: Prisma.PaymentWhereInput = {};

    if (query.status) where.status = query.status;
    if (query.paymentMethod) where.paymentMethod = query.paymentMethod;
    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) where.createdAt.gte = new Date(query.startDate);
      if (query.endDate)
        where.createdAt.lte = new Date(query.endDate + 'T23:59:59.999Z');
    }

    const payments = await this.prisma.payment.findMany({
      where,
      take: EXPORT_LIMIT,
      select: {
        amount: true,
        status: true,
        paymentMethod: true,
        paystackReference: true,
        createdAt: true,
        subscription: {
          select: {
            primaryMember: {
              select: {
                firstName: true,
                lastName: true,
                email: true,
              },
            },
            plan: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return payments.map((payment) => {
      const member = payment.subscription?.primaryMember;
      return {
        memberName: member ? `${member.firstName} ${member.lastName}` : '',
        memberEmail: member?.email || '',
        planName: payment.subscription?.plan?.name || '',
        amount: payment.amount,
        paymentStatus: payment.status,
        paymentMethod: payment.paymentMethod,
        reference: payment.paystackReference || '',
        date: payment.createdAt.toISOString().split('T')[0],
      };
    });
  }

  async getSubscriptions(query: Omit<ExportSubscriptionsQueryDto, 'format'>) {
    const where: Prisma.MemberSubscriptionWhereInput = {};

    if (query.status) where.status = query.status;
    if (query.planId) where.planId = query.planId;
    if (query.startDate || query.endDate) {
      where.startDate = {};
      if (query.startDate) where.startDate.gte = new Date(query.startDate);
      if (query.endDate)
        where.startDate.lte = new Date(query.endDate + 'T23:59:59.999Z');
    }

    const subscriptions = await this.prisma.memberSubscription.findMany({
      where,
      take: EXPORT_LIMIT,
      select: {
        primaryMemberId: true,
        status: true,
        startDate: true,
        endDate: true,
        autoRenew: true,
        paymentMethod: true,
        primaryMember: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        plan: {
          select: {
            name: true,
            price: true,
            billingInterval: true,
          },
        },
        members: {
          select: {
            memberId: true,
            member: {
              select: {
                firstName: true,
                lastName: true,
                email: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return subscriptions.map((sub) => {
      const duoMember = sub.members.find(
        (m) => m.memberId !== sub.primaryMemberId,
      );
      return {
        primaryMember: `${sub.primaryMember.firstName} ${sub.primaryMember.lastName}`,
        primaryEmail: sub.primaryMember.email,
        duoMember: duoMember
          ? `${duoMember.member.firstName} ${duoMember.member.lastName}`
          : '',
        duoEmail: duoMember?.member.email || '',
        plan: sub.plan.name,
        price: sub.plan.price,
        billingInterval: sub.plan.billingInterval,
        status: sub.status,
        startDate: sub.startDate.toISOString().split('T')[0],
        endDate: sub.endDate.toISOString().split('T')[0],
        autoRenew: sub.autoRenew ? 'Yes' : 'No',
        paymentMethod: sub.paymentMethod,
        frozen: sub.status === 'FROZEN' ? 'Yes' : 'No',
      };
    });
  }
}
