import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AnalyticsQueryDto } from './dto/analytics-query.dto';
import { Granularity } from './dto/analytics-query.dto';

export interface DashboardResult {
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
    todayCheckIns: number;
    thisWeekCheckIns: number;
    avgDaily30Days: number;
  };
  payments: {
    pendingCount30Days: number;
    failedCount30Days: number;
  };
  financials?: {
    revenueThisMonth: number;
    revenueLastMonth: number;
    salariesPaidThisMonth: number;
    pendingSalaries: number;
    netPositionThisMonth: number;
  };
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

    const memberWhere = { role: 'MEMBER' as const, deletedAt: null };

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
    const avgDaily30Days =
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
        todayCheckIns: attendanceToday,
        thisWeekCheckIns: attendanceThisWeek,
        avgDaily30Days,
      },
      payments: {
        pendingCount30Days: pendingPayments,
        failedCount30Days: failedPayments,
      },
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

  private getDateRange(query: AnalyticsQueryDto) {
    const to = query.to ? new Date(query.to) : new Date();
    const from = query.from
      ? new Date(query.from)
      : new Date(to.getFullYear() - 1, to.getMonth(), to.getDate());
    return { from, to };
  }

  private getPeriodKey(date: Date, granularity: Granularity): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    switch (granularity) {
      case Granularity.DAILY:
        return `${year}-${month}-${day}`;
      case Granularity.WEEKLY: {
        const startOfWeek = new Date(date);
        startOfWeek.setDate(date.getDate() - date.getDay());
        const wMonth = String(startOfWeek.getMonth() + 1).padStart(2, '0');
        const wDay = String(startOfWeek.getDate()).padStart(2, '0');
        return `${startOfWeek.getFullYear()}-${wMonth}-${wDay}`;
      }
      case Granularity.MONTHLY:
        return `${year}-${month}`;
    }
  }

  async getExpiringMemberships() {
    const now = new Date();
    const sevenDaysFromNow = new Date(now);
    sevenDaysFromNow.setDate(now.getDate() + 7);

    const subscriptions = await this.prisma.memberSubscription.findMany({
      where: {
        status: 'ACTIVE',
        endDate: { gte: now, lte: sevenDaysFromNow },
      },
      select: {
        endDate: true,
        primaryMember: {
          select: { id: true, firstName: true, lastName: true },
        },
        plan: { select: { name: true } },
      },
      orderBy: { endDate: 'asc' },
      take: 20,
    });

    const memberships = subscriptions.map((sub) => {
      const diffMs = sub.endDate.getTime() - now.getTime();
      const daysUntilExpiry = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
      return {
        memberId: sub.primaryMember.id,
        memberName: `${sub.primaryMember.firstName} ${sub.primaryMember.lastName}`,
        planName: sub.plan.name,
        expiresAt: sub.endDate,
        daysUntilExpiry,
      };
    });

    return { memberships };
  }

  async getRevenueTrends(query: AnalyticsQueryDto, paymentMethod?: string) {
    const { from, to } = this.getDateRange(query);
    const granularity = query.granularity || Granularity.MONTHLY;

    const where: Record<string, unknown> = {
      createdAt: { gte: from, lte: to },
    };
    if (paymentMethod) {
      where.paymentMethod = paymentMethod;
    }

    const payments = await this.prisma.payment.findMany({
      where,
      select: {
        amount: true,
        status: true,
        paymentMethod: true,
        createdAt: true,
      },
    });

    const buckets = new Map<
      string,
      {
        total: number;
        paid: number;
        failed: number;
        pending: number;
        card: number;
        mobileMoney: number;
      }
    >();

    for (const payment of payments) {
      const period = this.getPeriodKey(payment.createdAt, granularity);
      if (!buckets.has(period)) {
        buckets.set(period, {
          total: 0,
          paid: 0,
          failed: 0,
          pending: 0,
          card: 0,
          mobileMoney: 0,
        });
      }
      const bucket = buckets.get(period)!;
      bucket.total += payment.amount;

      if (payment.status === 'PAID') bucket.paid += payment.amount;
      else if (payment.status === 'FAILED') bucket.failed += payment.amount;
      else if (payment.status === 'PENDING') bucket.pending += payment.amount;

      if (payment.paymentMethod === 'CARD') bucket.card += payment.amount;
      else if (payment.paymentMethod === 'MOBILE_MONEY')
        bucket.mobileMoney += payment.amount;
    }

    const series = Array.from(buckets.entries())
      .map(([period, data]) => ({
        period,
        total: data.total,
        paid: data.paid,
        failed: data.failed,
        pending: data.pending,
        byMethod: { card: data.card, mobileMoney: data.mobileMoney },
      }))
      .sort((a, b) => a.period.localeCompare(b.period));

    return { series };
  }

  async getAttendanceTrends(query: AnalyticsQueryDto) {
    const { from, to } = this.getDateRange(query);
    const granularity = query.granularity || Granularity.MONTHLY;

    const attendances = await this.prisma.attendance.findMany({
      where: {
        checkInDate: { gte: from, lte: to },
      },
      select: {
        checkInDate: true,
        checkInTime: true,
        memberId: true,
      },
    });

    const buckets = new Map<
      string,
      { checkIns: number; members: Set<string> }
    >();
    const dayOfWeekCounts = new Array(7).fill(0);
    const hourCounts = new Array(24).fill(0);

    for (const attendance of attendances) {
      const period = this.getPeriodKey(attendance.checkInDate, granularity);
      if (!buckets.has(period)) {
        buckets.set(period, { checkIns: 0, members: new Set() });
      }
      const bucket = buckets.get(period)!;
      bucket.checkIns++;
      bucket.members.add(attendance.memberId);

      dayOfWeekCounts[attendance.checkInDate.getDay()]++;
      hourCounts[attendance.checkInTime.getHours()]++;
    }

    const days = [
      'Sunday',
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
    ];
    const peakDayIndex = dayOfWeekCounts.indexOf(
      Math.max(...(dayOfWeekCounts as number[])),
    );
    const peakHour = hourCounts.indexOf(Math.max(...(hourCounts as number[])));

    const series = Array.from(buckets.entries())
      .map(([period, data]) => ({
        period,
        checkIns: data.checkIns,
        uniqueMembers: data.members.size,
      }))
      .sort((a, b) => a.period.localeCompare(b.period));

    return {
      series,
      peakDayOfWeek: days[peakDayIndex],
      peakHour,
    };
  }

  async getSubscriptionTrends(query: AnalyticsQueryDto) {
    const { from, to } = this.getDateRange(query);
    const granularity = query.granularity || Granularity.MONTHLY;

    const subscriptions = await this.prisma.memberSubscription.findMany({
      where: {
        createdAt: { gte: from, lte: to },
      },
      select: {
        status: true,
        createdAt: true,
        plan: { select: { name: true } },
        paymentMethod: true,
      },
    });

    const buckets = new Map<
      string,
      { newSubscriptions: number; cancellations: number; expirations: number }
    >();
    const byPlan: Record<string, number> = {};
    const byPaymentMethod: Record<string, number> = {};

    for (const sub of subscriptions) {
      const period = this.getPeriodKey(sub.createdAt, granularity);
      if (!buckets.has(period)) {
        buckets.set(period, {
          newSubscriptions: 0,
          cancellations: 0,
          expirations: 0,
        });
      }
      const bucket = buckets.get(period)!;

      if (sub.status === 'ACTIVE' || sub.status === 'FROZEN') {
        bucket.newSubscriptions++;
        byPlan[sub.plan.name] = (byPlan[sub.plan.name] || 0) + 1;
        byPaymentMethod[sub.paymentMethod] =
          (byPaymentMethod[sub.paymentMethod] || 0) + 1;
      } else if (sub.status === 'CANCELLED') {
        bucket.cancellations++;
      } else if (sub.status === 'EXPIRED') {
        bucket.expirations++;
      }
    }

    // Count subscribers that existed at the start of the period
    // (created before period start, not yet expired/cancelled before period start)
    const subscribersAtStart = await this.prisma.memberSubscription.count({
      where: {
        createdAt: { lt: from },
        status: { in: ['ACTIVE', 'FROZEN', 'CANCELLED', 'EXPIRED'] },
        OR: [
          { endDate: { gte: from } },
          { status: { in: ['CANCELLED', 'EXPIRED'] } },
        ],
      },
    });

    // Also count new subscriptions created during the period
    const newInPeriod = subscriptions.filter(
      (s) => s.status === 'ACTIVE' || s.status === 'FROZEN',
    ).length;

    const totalBase = subscribersAtStart + newInPeriod;

    const totalCancelled = subscriptions.filter(
      (s) => s.status === 'CANCELLED',
    ).length;
    const totalExpired = subscriptions.filter(
      (s) => s.status === 'EXPIRED',
    ).length;
    const churnRate =
      totalBase > 0
        ? Math.round(
            ((totalCancelled + totalExpired) / totalBase) * 100 * 100,
          ) / 100
        : 0;

    const series = Array.from(buckets.entries())
      .map(([period, data]) => ({
        period,
        ...data,
      }))
      .sort((a, b) => a.period.localeCompare(b.period));

    return {
      series,
      byPlan,
      byPaymentMethod,
      churnRate,
    };
  }

  async getMemberTrends(query: AnalyticsQueryDto) {
    const { from, to } = this.getDateRange(query);
    const granularity = query.granularity || Granularity.MONTHLY;

    const memberWhere = { role: 'MEMBER' as const, deletedAt: null };

    const users = await this.prisma.user.findMany({
      where: {
        ...memberWhere,
        createdAt: { gte: from, lte: to },
      },
      select: {
        status: true,
        createdAt: true,
      },
    });

    const priorCount = await this.prisma.user.count({
      where: {
        ...memberWhere,
        createdAt: { lt: from },
      },
    });

    const buckets = new Map<string, number>();
    const byStatus: Record<string, number> = {
      ACTIVE: 0,
      INACTIVE: 0,
      SUSPENDED: 0,
    };

    for (const user of users) {
      const period = this.getPeriodKey(user.createdAt, granularity);
      buckets.set(period, (buckets.get(period) || 0) + 1);

      if (user.status in byStatus) byStatus[user.status]++;
    }

    let runningTotal = priorCount;
    const series = Array.from(buckets.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([period, newMembers]) => {
        runningTotal += newMembers;
        return { period, newMembers, totalMembers: runningTotal };
      });

    return {
      series,
      byStatus,
    };
  }
}
