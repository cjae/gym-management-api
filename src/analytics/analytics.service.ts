import { Injectable } from '@nestjs/common';
import {
  PaymentMethod,
  ShopOrderStatus,
  SubscriptionStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { GymSettingsService } from '../gym-settings/gym-settings.service';
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
  private static readonly DEFAULT_TIMEZONE = 'Africa/Nairobi';

  constructor(
    private readonly prisma: PrismaService,
    private readonly gymSettingsService: GymSettingsService,
  ) {}

  private async getTimezone(): Promise<string> {
    const settings = await this.gymSettingsService.getCachedSettings();
    return settings?.timezone ?? AnalyticsService.DEFAULT_TIMEZONE;
  }

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
    if (query.to) {
      to.setUTCHours(23, 59, 59, 999);
    }
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
    const timezone = await this.getTimezone();

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
      const localHour = parseInt(
        attendance.checkInTime.toLocaleString('en-US', {
          timeZone: timezone,
          hour: 'numeric',
          hour12: false,
        }),
        10,
      );
      hourCounts[localHour % 24]++;
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

    // Subscriptions created during the period (for time-series buckets)
    const subscriptions = await this.prisma.memberSubscription.findMany({
      where: {
        createdAt: { gte: from, lte: to },
        status: { not: 'PENDING' as SubscriptionStatus },
      },
      select: {
        status: true,
        createdAt: true,
        plan: { select: { name: true } },
        paymentMethod: true,
      },
    });

    // Subscriptions that churned during the period (for churn rate + per-period buckets)
    // Uses updatedAt to capture when the status actually changed
    const churnedSubscriptions = await this.prisma.memberSubscription.findMany({
      where: {
        status: { in: ['CANCELLED', 'EXPIRED'] },
        updatedAt: { gte: from, lte: to },
      },
      select: {
        status: true,
        updatedAt: true,
      },
    });
    const churnedInPeriod = churnedSubscriptions.length;

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

      // Every non-PENDING subscription created in the period is a new subscription
      bucket.newSubscriptions++;

      // Active breakdown by plan and payment method
      if (sub.status === 'ACTIVE' || sub.status === 'FROZEN') {
        byPlan[sub.plan.name] = (byPlan[sub.plan.name] || 0) + 1;
        byPaymentMethod[sub.paymentMethod] =
          (byPaymentMethod[sub.paymentMethod] || 0) + 1;
      }
    }

    // Bucket churn events by when they actually happened (updatedAt)
    for (const sub of churnedSubscriptions) {
      const period = this.getPeriodKey(sub.updatedAt, granularity);
      if (!buckets.has(period)) {
        buckets.set(period, {
          newSubscriptions: 0,
          cancellations: 0,
          expirations: 0,
        });
      }
      const bucket = buckets.get(period)!;
      if (sub.status === 'CANCELLED') bucket.cancellations++;
      else bucket.expirations++;
    }

    // Subscribers at the start of the period: created before the period,
    // still valid (endDate >= from), and either currently active/frozen
    // OR churned during the period (were active at period start)
    const subscribersAtStart = await this.prisma.memberSubscription.count({
      where: {
        createdAt: { lt: from },
        endDate: { gte: from },
        OR: [
          { status: { in: ['ACTIVE', 'FROZEN'] as SubscriptionStatus[] } },
          {
            status: {
              in: ['CANCELLED', 'EXPIRED'] as SubscriptionStatus[],
            },
            updatedAt: { gte: from },
          },
        ],
      },
    });

    // Total base = existing subscribers + all new subscriptions in the period
    const totalBase = subscribersAtStart + subscriptions.length;

    const churnRate =
      totalBase > 0
        ? Math.round((churnedInPeriod / totalBase) * 100 * 100) / 100
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

  async getShopAnalytics() {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(
      now.getFullYear(),
      now.getMonth(),
      0,
      23,
      59,
      59,
      999,
    );

    const completedWhere = {
      status: { in: [ShopOrderStatus.PAID, ShopOrderStatus.COLLECTED] },
    };

    const [
      totalOrders,
      pendingOrders,
      paidOrders,
      collectedOrders,
      cancelledOrders,
      allTimeRevenueAgg,
      thisMonthRevenueAgg,
      lastMonthRevenueAgg,
      orderItems,
      lowStockItems,
      lowStockVariants,
    ] = await Promise.all([
      this.prisma.shopOrder.count(),
      this.prisma.shopOrder.count({
        where: { status: ShopOrderStatus.PENDING },
      }),
      this.prisma.shopOrder.count({ where: { status: ShopOrderStatus.PAID } }),
      this.prisma.shopOrder.count({
        where: { status: ShopOrderStatus.COLLECTED },
      }),
      this.prisma.shopOrder.count({
        where: { status: ShopOrderStatus.CANCELLED },
      }),
      this.prisma.shopOrder.aggregate({
        _sum: { totalAmount: true },
        where: completedWhere,
      }),
      this.prisma.shopOrder.aggregate({
        _sum: { totalAmount: true },
        where: { ...completedWhere, createdAt: { gte: startOfMonth } },
      }),
      this.prisma.shopOrder.aggregate({
        _sum: { totalAmount: true },
        where: {
          ...completedWhere,
          createdAt: { gte: lastMonthStart, lte: lastMonthEnd },
        },
      }),
      this.prisma.shopOrderItem.findMany({
        where: {
          order: {
            status: { in: [ShopOrderStatus.PAID, ShopOrderStatus.COLLECTED] },
          },
        },
        select: {
          shopItemId: true,
          quantity: true,
          unitPrice: true,
          item: { select: { name: true } },
        },
      }),
      this.prisma.shopItem.count({
        where: { stock: 0, isActive: true, variants: { none: {} } },
      }),
      this.prisma.shopItemVariant.count({
        where: { stock: 0, item: { isActive: true } },
      }),
    ]);

    const allTimeRevenue = allTimeRevenueAgg._sum?.totalAmount ?? 0;
    const completedCount = paidOrders + collectedOrders;

    const itemMap = new Map<
      string,
      { name: string; revenue: number; unitsSold: number }
    >();
    let unitsSold = 0;
    for (const oi of orderItems) {
      const entry = itemMap.get(oi.shopItemId) ?? {
        name: oi.item.name,
        revenue: 0,
        unitsSold: 0,
      };
      entry.revenue += oi.unitPrice * oi.quantity;
      entry.unitsSold += oi.quantity;
      itemMap.set(oi.shopItemId, entry);
      unitsSold += oi.quantity;
    }

    const topItems = Array.from(itemMap.entries())
      .map(([itemId, data]) => ({ itemId, ...data }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);

    return {
      orders: {
        total: totalOrders,
        pending: pendingOrders,
        paid: paidOrders,
        collected: collectedOrders,
        cancelled: cancelledOrders,
      },
      revenue: {
        allTime: allTimeRevenue,
        thisMonth: thisMonthRevenueAgg._sum?.totalAmount ?? 0,
        lastMonth: lastMonthRevenueAgg._sum?.totalAmount ?? 0,
      },
      avgOrderValue:
        completedCount > 0
          ? Math.round((allTimeRevenue / completedCount) * 100) / 100
          : 0,
      unitsSold,
      topItems,
      lowStockCount: lowStockItems + lowStockVariants,
    };
  }

  async getShopRevenueTrends(query: AnalyticsQueryDto) {
    const { from, to } = this.getDateRange(query);
    const granularity = query.granularity ?? Granularity.MONTHLY;

    const orders = await this.prisma.shopOrder.findMany({
      where: {
        status: { in: [ShopOrderStatus.PAID, ShopOrderStatus.COLLECTED] },
        createdAt: { gte: from, lte: to },
      },
      select: { totalAmount: true, paymentMethod: true, createdAt: true },
    });

    const buckets = new Map<
      string,
      {
        revenue: number;
        orders: number;
        card: number;
        mobileMoney: number;
        bankTransfer: number;
        complimentary: number;
      }
    >();

    for (const order of orders) {
      const period = this.getPeriodKey(order.createdAt, granularity);
      if (!buckets.has(period)) {
        buckets.set(period, {
          revenue: 0,
          orders: 0,
          card: 0,
          mobileMoney: 0,
          bankTransfer: 0,
          complimentary: 0,
        });
      }
      const bucket = buckets.get(period)!;
      bucket.revenue += order.totalAmount;
      bucket.orders++;

      if (
        order.paymentMethod === PaymentMethod.CARD ||
        order.paymentMethod === PaymentMethod.CARD_IN_PERSON
      )
        bucket.card += order.totalAmount;
      else if (
        order.paymentMethod === PaymentMethod.MOBILE_MONEY ||
        order.paymentMethod === PaymentMethod.MOBILE_MONEY_IN_PERSON
      )
        bucket.mobileMoney += order.totalAmount;
      else if (
        order.paymentMethod === PaymentMethod.BANK_TRANSFER ||
        order.paymentMethod === PaymentMethod.BANK_TRANSFER_IN_PERSON
      )
        bucket.bankTransfer += order.totalAmount;
      else if (order.paymentMethod === PaymentMethod.COMPLIMENTARY)
        bucket.complimentary += order.totalAmount;
    }

    const series = Array.from(buckets.entries())
      .map(([period, data]) => ({
        period,
        revenue: data.revenue,
        orders: data.orders,
        byMethod: {
          card: data.card,
          mobileMoney: data.mobileMoney,
          bankTransfer: data.bankTransfer,
          complimentary: data.complimentary,
        },
      }))
      .sort((a, b) => a.period.localeCompare(b.period));

    return { series };
  }
}
