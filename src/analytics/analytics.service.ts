import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

interface DashboardResult {
  members: {
    total: number;
    active: number;
    inactive: number;
    suspended: number;
    newThisMonth: number;
  };
  subscriptions: {
    active: number;
    expiringSoon: number;
    expiredThisMonth: number;
    byPlan: Record<string, number>;
  };
  attendance: {
    today: number;
    thisWeek: number;
    avgDailyLast30Days: number;
  };
  payments: {
    pendingLast30Days: number;
    failedLast30Days: number;
  };
  financials?: {
    revenueThisMonth: number;
    revenueLastMonth: number;
    salariesPaidThisMonth: number;
    pendingSalaries: number;
    netPositionThisMonth: number;
  };
  recentActivity: ActivityItem[];
}

interface ActivityItem {
  type: string;
  message: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboard(role: string): Promise<DashboardResult> {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    const endOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
    );
    const startOfWeek = new Date(startOfToday);
    startOfWeek.setDate(startOfToday.getDate() - startOfToday.getDay());
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(now.getDate() - 30);
    const sevenDaysFromNow = new Date(now);
    sevenDaysFromNow.setDate(now.getDate() + 7);

    const memberWhere = { role: 'MEMBER' as const };

    const [
      totalMembers,
      activeMembers,
      inactiveMembers,
      suspendedMembers,
      newThisMonth,
      activeSubscriptions,
      expiringSoon,
      expiredThisMonth,
      byPlanGroups,
      attendanceToday,
      attendanceThisWeek,
      pendingPayments,
      failedPayments,
      recentActivity,
    ] = await Promise.all([
      this.prisma.user.count({ where: memberWhere }),
      this.prisma.user.count({
        where: { ...memberWhere, status: 'ACTIVE' },
      }),
      this.prisma.user.count({
        where: { ...memberWhere, status: 'INACTIVE' },
      }),
      this.prisma.user.count({
        where: { ...memberWhere, status: 'SUSPENDED' },
      }),
      this.prisma.user.count({
        where: { ...memberWhere, createdAt: { gte: startOfMonth } },
      }),
      this.prisma.memberSubscription.count({
        where: { status: 'ACTIVE' },
      }),
      this.prisma.memberSubscription.count({
        where: {
          status: 'ACTIVE',
          endDate: { gte: now, lte: sevenDaysFromNow },
        },
      }),
      this.prisma.memberSubscription.count({
        where: {
          status: 'EXPIRED',
          endDate: { gte: startOfMonth, lte: now },
        },
      }),
      this.prisma.memberSubscription.groupBy({
        by: ['planId'],
        where: { status: 'ACTIVE' },
        _count: { id: true },
      }),
      this.prisma.attendance.count({
        where: {
          checkInDate: { gte: startOfToday, lt: endOfToday },
        },
      }),
      this.prisma.attendance.count({
        where: { checkInDate: { gte: startOfWeek } },
      }),
      this.prisma.payment.count({
        where: { status: 'PENDING', createdAt: { gte: thirtyDaysAgo } },
      }),
      this.prisma.payment.count({
        where: { status: 'FAILED', createdAt: { gte: thirtyDaysAgo } },
      }),
      this.getRecentActivity(),
    ]);

    // Resolve plan names for byPlan
    const byPlan: Record<string, number> = {};
    if (byPlanGroups.length > 0) {
      const planIds = byPlanGroups.map((g: { planId: string }) => g.planId);
      const plans = await this.prisma.memberSubscription.findMany({
        where: { planId: { in: planIds } },
        select: { planId: true, plan: { select: { name: true } } },
        distinct: ['planId'],
      });
      const planNameMap = new Map(
        plans.map((p: { planId: string; plan: { name: string } }) => [
          p.planId,
          p.plan.name,
        ]),
      );
      for (const group of byPlanGroups) {
        const name =
          planNameMap.get((group as { planId: string }).planId) || 'Unknown';
        byPlan[name] = (group as { _count: { id: number } })._count.id;
      }
    }

    // Calculate avg daily attendance last 30 days
    const daysInRange = 30;
    const attendanceLast30 = await this.prisma.attendance.count({
      where: { checkInDate: { gte: thirtyDaysAgo } },
    });
    const avgDailyLast30Days =
      Math.round((attendanceLast30 / daysInRange) * 100) / 100;

    const dashboard: DashboardResult = {
      members: {
        total: totalMembers,
        active: activeMembers,
        inactive: inactiveMembers,
        suspended: suspendedMembers,
        newThisMonth,
      },
      subscriptions: {
        active: activeSubscriptions,
        expiringSoon,
        expiredThisMonth,
        byPlan,
      },
      attendance: {
        today: attendanceToday,
        thisWeek: attendanceThisWeek,
        avgDailyLast30Days,
      },
      payments: {
        pendingLast30Days: pendingPayments,
        failedLast30Days: failedPayments,
      },
      recentActivity,
    };

    if (role === 'SUPER_ADMIN') {
      const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastMonthEnd = new Date(
        now.getFullYear(),
        now.getMonth(),
        0,
        23,
        59,
        59,
      );
      const currentMonth = now.getMonth() + 1;
      const currentYear = now.getFullYear();

      const [
        revenueThisMonthAgg,
        revenueLastMonthAgg,
        salariesPaidAgg,
        pendingSalaries,
      ] = await Promise.all([
        this.prisma.payment.aggregate({
          _sum: { amount: true },
          where: { status: 'PAID', createdAt: { gte: startOfMonth } },
        }),
        this.prisma.payment.aggregate({
          _sum: { amount: true },
          where: {
            status: 'PAID',
            createdAt: { gte: lastMonthStart, lte: lastMonthEnd },
          },
        }),
        this.prisma.staffSalaryRecord.aggregate({
          _sum: { amount: true },
          where: {
            status: 'PAID',
            month: currentMonth,
            year: currentYear,
          },
        }),
        this.prisma.staffSalaryRecord.count({
          where: {
            status: 'PENDING',
            month: currentMonth,
            year: currentYear,
          },
        }),
      ]);

      const revenueThisMonth = revenueThisMonthAgg._sum.amount || 0;
      const revenueLastMonth = revenueLastMonthAgg._sum.amount || 0;
      const salariesPaidThisMonth = salariesPaidAgg._sum.amount || 0;

      dashboard.financials = {
        revenueThisMonth,
        revenueLastMonth,
        salariesPaidThisMonth,
        pendingSalaries,
        netPositionThisMonth: revenueThisMonth - salariesPaidThisMonth,
      };
    }

    return dashboard;
  }

  async getRecentActivity(limit = 20): Promise<ActivityItem[]> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [newMembers, checkIns, payments, subscriptions] = await Promise.all([
      this.prisma.user.findMany({
        where: {
          role: 'MEMBER',
          createdAt: { gte: thirtyDaysAgo },
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      this.prisma.attendance.findMany({
        where: { checkInTime: { gte: thirtyDaysAgo } },
        select: {
          id: true,
          memberId: true,
          checkInTime: true,
          member: {
            select: { firstName: true, lastName: true },
          },
        },
        orderBy: { checkInTime: 'desc' },
        take: limit,
      }),
      this.prisma.payment.findMany({
        where: { createdAt: { gte: thirtyDaysAgo } },
        select: {
          id: true,
          amount: true,
          currency: true,
          status: true,
          createdAt: true,
          subscription: {
            select: {
              primaryMember: {
                select: { firstName: true, lastName: true },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      this.prisma.memberSubscription.findMany({
        where: { createdAt: { gte: thirtyDaysAgo } },
        select: {
          id: true,
          status: true,
          createdAt: true,
          primaryMember: {
            select: { firstName: true, lastName: true },
          },
          plan: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
    ]);

    const activities: ActivityItem[] = [];

    for (const member of newMembers) {
      activities.push({
        type: 'NEW_MEMBER',
        message: `${member.firstName} ${member.lastName} registered as a new member`,
        timestamp: member.createdAt,
        metadata: { memberId: member.id },
      });
    }

    for (const checkIn of checkIns) {
      activities.push({
        type: 'CHECK_IN',
        message: `${checkIn.member.firstName} ${checkIn.member.lastName} checked in`,
        timestamp: checkIn.checkInTime,
        metadata: { memberId: checkIn.memberId },
      });
    }

    for (const payment of payments) {
      const name = `${payment.subscription.primaryMember.firstName} ${payment.subscription.primaryMember.lastName}`;
      activities.push({
        type: 'PAYMENT',
        message: `${name} made a ${payment.status} payment of ${payment.amount} ${payment.currency}`,
        timestamp: payment.createdAt,
        metadata: {
          paymentId: payment.id,
          amount: payment.amount,
          status: payment.status,
        },
      });
    }

    for (const sub of subscriptions) {
      const name = `${sub.primaryMember.firstName} ${sub.primaryMember.lastName}`;
      const action = sub.status === 'CANCELLED' ? 'cancelled' : 'started';
      activities.push({
        type: 'SUBSCRIPTION',
        message: `${name} ${action} a ${sub.plan.name} subscription`,
        timestamp: sub.createdAt,
        metadata: {
          subscriptionId: sub.id,
          planName: sub.plan.name,
          status: sub.status,
        },
      });
    }

    activities.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    return activities.slice(0, limit);
  }
}
