# Analytics Module Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an analytics module with a dashboard summary endpoint and granular drill-down endpoints for revenue, attendance, subscriptions, and members.

**Architecture:** New `src/analytics/` module following the existing controller → service → Prisma pattern. One shared DTO for date range + granularity query params. The dashboard endpoint conditionally includes financial data based on user role. All data is derived from existing tables — no schema changes.

**Tech Stack:** NestJS, Prisma aggregation queries, class-validator, class-transformer, Jest

---

### Task 1: Create AnalyticsQueryDto and Granularity Enum

**Files:**
- Create: `src/analytics/dto/analytics-query.dto.ts`

**Step 1: Create the shared query DTO**

```typescript
import { IsDateString, IsEnum, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

export enum Granularity {
  DAILY = 'daily',
  WEEKLY = 'weekly',
  MONTHLY = 'monthly',
}

export class AnalyticsQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsEnum(Granularity)
  granularity?: Granularity = Granularity.MONTHLY;
}
```

**Step 2: Commit**

```bash
git add src/analytics/dto/analytics-query.dto.ts
git commit -m "feat(analytics): add AnalyticsQueryDto and Granularity enum"
```

---

### Task 2: Create AnalyticsService — Dashboard Summary

**Files:**
- Create: `src/analytics/analytics.service.ts`
- Test: `src/analytics/analytics.service.spec.ts`

**Step 1: Write the failing test for getDashboard**

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { AnalyticsService } from './analytics.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      user: {
        count: jest.fn(),
      },
      memberSubscription: {
        count: jest.fn(),
        findMany: jest.fn(),
      },
      attendance: {
        count: jest.fn(),
      },
      payment: {
        count: jest.fn(),
        aggregate: jest.fn(),
      },
      staffSalaryRecord: {
        aggregate: jest.fn(),
        count: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<AnalyticsService>(AnalyticsService);
    jest.clearAllMocks();
  });

  describe('getDashboard', () => {
    it('should return member stats', async () => {
      prisma.user.count
        .mockResolvedValueOnce(100) // total
        .mockResolvedValueOnce(80)  // active
        .mockResolvedValueOnce(10)  // inactive
        .mockResolvedValueOnce(5)   // suspended
        .mockResolvedValueOnce(15); // new this month
      prisma.memberSubscription.count
        .mockResolvedValueOnce(60)  // active subs
        .mockResolvedValueOnce(5)   // expiring soon
        .mockResolvedValueOnce(3);  // expired this month
      prisma.memberSubscription.findMany.mockResolvedValue([]);
      prisma.attendance.count
        .mockResolvedValueOnce(25)  // today
        .mockResolvedValueOnce(120); // this week
      prisma.payment.count
        .mockResolvedValueOnce(2)   // pending
        .mockResolvedValueOnce(1);  // failed
      // recent activity queries
      prisma.user.count.mockResolvedValue(0);
      prisma.payment.aggregate
        .mockResolvedValueOnce({ _sum: { amount: 50000 } })  // this month revenue
        .mockResolvedValueOnce({ _sum: { amount: 45000 } }); // last month revenue
      prisma.staffSalaryRecord.aggregate
        .mockResolvedValueOnce({ _sum: { amount: 20000 } }); // paid salaries
      prisma.staffSalaryRecord.count
        .mockResolvedValueOnce(2); // pending salaries

      const result = await service.getDashboard('SUPER_ADMIN');

      expect(result.members).toBeDefined();
      expect(result.subscriptions).toBeDefined();
      expect(result.attendance).toBeDefined();
      expect(result.payments).toBeDefined();
      expect(result.financials).toBeDefined();
    });

    it('should NOT include financials for ADMIN role', async () => {
      prisma.user.count.mockResolvedValue(0);
      prisma.memberSubscription.count.mockResolvedValue(0);
      prisma.memberSubscription.findMany.mockResolvedValue([]);
      prisma.attendance.count.mockResolvedValue(0);
      prisma.payment.count.mockResolvedValue(0);
      prisma.payment.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
      prisma.staffSalaryRecord.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
      prisma.staffSalaryRecord.count.mockResolvedValue(0);

      const result = await service.getDashboard('ADMIN');

      expect(result.financials).toBeUndefined();
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `yarn test -- --testPathPattern=analytics.service`
Expected: FAIL — cannot find module `./analytics.service`

**Step 3: Write the service implementation**

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AnalyticsQueryDto, Granularity } from './dto/analytics-query.dto';

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboard(role: string) {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - today.getDay());
    const sevenDaysFromNow = new Date(today);
    sevenDaysFromNow.setDate(today.getDate() + 7);

    const [
      totalMembers,
      activeMembers,
      inactiveMembers,
      suspendedMembers,
      newMembersThisMonth,
      activeSubscriptions,
      expiringSoon,
      expiredThisMonth,
      subscriptionsByPlan,
      checkInsToday,
      checkInsThisWeek,
      pendingPayments,
      failedPayments,
    ] = await Promise.all([
      this.prisma.user.count({ where: { role: 'MEMBER' } }),
      this.prisma.user.count({ where: { role: 'MEMBER', status: 'ACTIVE' } }),
      this.prisma.user.count({ where: { role: 'MEMBER', status: 'INACTIVE' } }),
      this.prisma.user.count({ where: { role: 'MEMBER', status: 'SUSPENDED' } }),
      this.prisma.user.count({ where: { role: 'MEMBER', createdAt: { gte: startOfMonth } } }),
      this.prisma.memberSubscription.count({ where: { status: 'ACTIVE' } }),
      this.prisma.memberSubscription.count({ where: { status: 'ACTIVE', endDate: { lte: sevenDaysFromNow, gte: today } } }),
      this.prisma.memberSubscription.count({ where: { status: 'EXPIRED', updatedAt: { gte: startOfMonth } } }),
      this.prisma.memberSubscription.findMany({
        where: { status: 'ACTIVE' },
        select: { plan: { select: { name: true } } },
      }),
      this.prisma.attendance.count({ where: { checkInDate: today } }),
      this.prisma.attendance.count({ where: { checkInDate: { gte: startOfWeek } } }),
      this.prisma.payment.count({ where: { status: 'PENDING', createdAt: { gte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) } } }),
      this.prisma.payment.count({ where: { status: 'FAILED', createdAt: { gte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) } } }),
    ]);

    // Count subscriptions by plan name
    const planCounts: Record<string, number> = {};
    for (const sub of subscriptionsByPlan) {
      const name = sub.plan.name;
      planCounts[name] = (planCounts[name] || 0) + 1;
    }

    // Attendance average (last 30 days)
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const totalCheckInsLast30 = await this.prisma.attendance.count({
      where: { checkInDate: { gte: thirtyDaysAgo } },
    });
    const avgDailyCheckIns = Math.round((totalCheckInsLast30 / 30) * 10) / 10;

    const dashboard: Record<string, any> = {
      members: {
        total: totalMembers,
        active: activeMembers,
        inactive: inactiveMembers,
        suspended: suspendedMembers,
        newThisMonth: newMembersThisMonth,
      },
      subscriptions: {
        active: activeSubscriptions,
        expiringSoon,
        expiredThisMonth,
        byPlan: planCounts,
      },
      attendance: {
        today: checkInsToday,
        thisWeek: checkInsThisWeek,
        avgDailyLast30Days: avgDailyCheckIns,
      },
      payments: {
        pendingLast30Days: pendingPayments,
        failedLast30Days: failedPayments,
      },
    };

    if (role === 'SUPER_ADMIN') {
      const [revenueThisMonth, revenueLastMonth, salariesPaid, pendingSalaries] =
        await Promise.all([
          this.prisma.payment.aggregate({
            where: { status: 'PAID', createdAt: { gte: startOfMonth } },
            _sum: { amount: true },
          }),
          this.prisma.payment.aggregate({
            where: { status: 'PAID', createdAt: { gte: startOfLastMonth, lte: endOfLastMonth } },
            _sum: { amount: true },
          }),
          this.prisma.staffSalaryRecord.aggregate({
            where: { status: 'PAID', paidAt: { gte: startOfMonth } },
            _sum: { amount: true },
          }),
          this.prisma.staffSalaryRecord.count({
            where: { status: 'PENDING' },
          }),
        ]);

      const revenue = revenueThisMonth._sum.amount || 0;
      const expenses = salariesPaid._sum.amount || 0;

      dashboard.financials = {
        revenueThisMonth: revenue,
        revenueLastMonth: revenueLastMonth._sum.amount || 0,
        salariesPaidThisMonth: expenses,
        pendingSalaries,
        netPositionThisMonth: revenue - expenses,
      };
    }

    return dashboard;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `yarn test -- --testPathPattern=analytics.service`
Expected: PASS (2 tests)

**Step 5: Commit**

```bash
git add src/analytics/analytics.service.ts src/analytics/analytics.service.spec.ts
git commit -m "feat(analytics): add dashboard summary service with tests"
```

---

### Task 3: Add Recent Activity Feed to Dashboard

**Files:**
- Modify: `src/analytics/analytics.service.ts`
- Modify: `src/analytics/analytics.service.spec.ts`

**Step 1: Add mocks for activity feed queries to the test**

Add to the `prisma` mock in `beforeEach`:

```typescript
prisma.user.findMany = jest.fn();
prisma.attendance.findMany = jest.fn();
prisma.payment.findMany = jest.fn();
prisma.memberSubscription.findMany = jest.fn();
```

Add a new test:

```typescript
describe('getRecentActivity', () => {
  it('should return merged and sorted activity feed', async () => {
    const now = new Date();
    prisma.user.findMany.mockResolvedValue([
      { id: '1', firstName: 'John', lastName: 'Doe', createdAt: new Date(now.getTime() - 1000) },
    ]);
    prisma.attendance.findMany.mockResolvedValue([
      { id: '2', checkInTime: new Date(now.getTime() - 2000), member: { firstName: 'Jane', lastName: 'Smith' } },
    ]);
    prisma.payment.findMany.mockResolvedValue([
      { id: '3', amount: 5000, status: 'PAID', createdAt: new Date(now.getTime() - 3000), subscription: { primaryMember: { firstName: 'Bob', lastName: 'Lee' } } },
    ]);
    prisma.memberSubscription.findMany.mockResolvedValue([]);

    const result = await service.getRecentActivity();

    expect(result).toHaveLength(3);
    expect(result[0].type).toBe('registration');
    expect(result[1].type).toBe('check_in');
    expect(result[2].type).toBe('payment');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `yarn test -- --testPathPattern=analytics.service`
Expected: FAIL — `service.getRecentActivity is not a function`

**Step 3: Add getRecentActivity to the service**

Add this method to `AnalyticsService`:

```typescript
async getRecentActivity(limit = 20) {
  const [newMembers, recentCheckIns, recentPayments, recentSubscriptions] =
    await Promise.all([
      this.prisma.user.findMany({
        where: { role: 'MEMBER' },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: { id: true, firstName: true, lastName: true, createdAt: true },
      }),
      this.prisma.attendance.findMany({
        orderBy: { checkInTime: 'desc' },
        take: limit,
        select: {
          id: true,
          checkInTime: true,
          member: { select: { firstName: true, lastName: true } },
        },
      }),
      this.prisma.payment.findMany({
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: {
          id: true,
          amount: true,
          status: true,
          createdAt: true,
          subscription: {
            select: { primaryMember: { select: { firstName: true, lastName: true } } },
          },
        },
      }),
      this.prisma.memberSubscription.findMany({
        where: { status: { in: ['ACTIVE', 'CANCELLED'] } },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: {
          id: true,
          status: true,
          createdAt: true,
          primaryMember: { select: { firstName: true, lastName: true } },
          plan: { select: { name: true } },
        },
      }),
    ]);

  const events: { type: string; message: string; timestamp: Date; metadata: Record<string, any> }[] = [];

  for (const m of newMembers) {
    events.push({
      type: 'registration',
      message: `${m.firstName} ${m.lastName} registered`,
      timestamp: m.createdAt,
      metadata: { userId: m.id },
    });
  }

  for (const a of recentCheckIns) {
    events.push({
      type: 'check_in',
      message: `${a.member.firstName} ${a.member.lastName} checked in`,
      timestamp: a.checkInTime,
      metadata: { attendanceId: a.id },
    });
  }

  for (const p of recentPayments) {
    const name = `${p.subscription.primaryMember.firstName} ${p.subscription.primaryMember.lastName}`;
    events.push({
      type: 'payment',
      message: `${name} payment ${p.status.toLowerCase()} — KES ${p.amount}`,
      timestamp: p.createdAt,
      metadata: { paymentId: p.id, amount: p.amount, status: p.status },
    });
  }

  for (const s of recentSubscriptions) {
    const name = `${s.primaryMember.firstName} ${s.primaryMember.lastName}`;
    const action = s.status === 'CANCELLED' ? 'cancelled' : 'started';
    events.push({
      type: 'subscription',
      message: `${name} ${action} ${s.plan.name}`,
      timestamp: s.createdAt,
      metadata: { subscriptionId: s.id, plan: s.plan.name, status: s.status },
    });
  }

  events.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  return events.slice(0, limit);
}
```

Update `getDashboard` to include the activity feed — add at the end before `return dashboard`:

```typescript
dashboard.recentActivity = await this.getRecentActivity();
```

**Step 4: Run test to verify it passes**

Run: `yarn test -- --testPathPattern=analytics.service`
Expected: PASS

**Step 5: Commit**

```bash
git add src/analytics/analytics.service.ts src/analytics/analytics.service.spec.ts
git commit -m "feat(analytics): add recent activity feed to dashboard"
```

---

### Task 4: Add Revenue Drill-Down Endpoint

**Files:**
- Modify: `src/analytics/analytics.service.ts`
- Modify: `src/analytics/analytics.service.spec.ts`

**Step 1: Write the failing test**

Add to mock setup in `beforeEach`:

```typescript
prisma.payment.findMany = jest.fn();
```

Add test:

```typescript
describe('getRevenueTrends', () => {
  it('should return monthly revenue series', async () => {
    prisma.payment.findMany.mockResolvedValue([
      { amount: 3000, status: 'PAID', paymentMethod: 'MPESA', createdAt: new Date('2026-01-15') },
      { amount: 2000, status: 'PAID', paymentMethod: 'CARD', createdAt: new Date('2026-01-20') },
      { amount: 1000, status: 'FAILED', paymentMethod: 'CARD', createdAt: new Date('2026-02-10') },
    ]);

    const result = await service.getRevenueTrends({
      from: '2026-01-01',
      to: '2026-03-01',
      granularity: Granularity.MONTHLY,
    });

    expect(result.series).toBeDefined();
    expect(result.series.length).toBeGreaterThan(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `yarn test -- --testPathPattern=analytics.service`
Expected: FAIL — `service.getRevenueTrends is not a function`

**Step 3: Add getRevenueTrends to the service**

Add helper and method:

```typescript
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

async getRevenueTrends(query: AnalyticsQueryDto, paymentMethod?: string) {
  const { from, to } = this.getDateRange(query);
  const granularity = query.granularity || Granularity.MONTHLY;

  const where: Record<string, any> = {
    createdAt: { gte: from, lte: to },
  };
  if (paymentMethod) {
    where.paymentMethod = paymentMethod;
  }

  const payments = await this.prisma.payment.findMany({
    where,
    select: { amount: true, status: true, paymentMethod: true, createdAt: true },
  });

  const buckets: Record<string, { total: number; paid: number; failed: number; pending: number; card: number; mpesa: number }> = {};

  for (const p of payments) {
    const key = this.getPeriodKey(p.createdAt, granularity);
    if (!buckets[key]) {
      buckets[key] = { total: 0, paid: 0, failed: 0, pending: 0, card: 0, mpesa: 0 };
    }
    const b = buckets[key];
    b.total += p.amount;
    if (p.status === 'PAID') b.paid += p.amount;
    if (p.status === 'FAILED') b.failed += p.amount;
    if (p.status === 'PENDING') b.pending += p.amount;
    if (p.paymentMethod === 'CARD') b.card += p.amount;
    if (p.paymentMethod === 'MPESA') b.mpesa += p.amount;
  }

  const series = Object.entries(buckets)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, data]) => ({
      period,
      total: data.total,
      paid: data.paid,
      failed: data.failed,
      pending: data.pending,
      byMethod: { card: data.card, mpesa: data.mpesa },
    }));

  return { series };
}
```

**Step 4: Run test to verify it passes**

Run: `yarn test -- --testPathPattern=analytics.service`
Expected: PASS

**Step 5: Commit**

```bash
git add src/analytics/analytics.service.ts src/analytics/analytics.service.spec.ts
git commit -m "feat(analytics): add revenue trends drill-down"
```

---

### Task 5: Add Attendance Trends Endpoint

**Files:**
- Modify: `src/analytics/analytics.service.ts`
- Modify: `src/analytics/analytics.service.spec.ts`

**Step 1: Write the failing test**

```typescript
describe('getAttendanceTrends', () => {
  it('should return attendance series with peak data', async () => {
    prisma.attendance.findMany = jest.fn().mockResolvedValue([
      { checkInDate: new Date('2026-01-15'), checkInTime: new Date('2026-01-15T08:30:00'), memberId: 'a' },
      { checkInDate: new Date('2026-01-15'), checkInTime: new Date('2026-01-15T09:00:00'), memberId: 'b' },
      { checkInDate: new Date('2026-01-16'), checkInTime: new Date('2026-01-16T17:00:00'), memberId: 'a' },
    ]);

    const result = await service.getAttendanceTrends({
      from: '2026-01-01',
      to: '2026-02-01',
      granularity: Granularity.DAILY,
    });

    expect(result.series).toBeDefined();
    expect(result.peakDayOfWeek).toBeDefined();
    expect(result.peakHour).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `yarn test -- --testPathPattern=analytics.service`
Expected: FAIL — `service.getAttendanceTrends is not a function`

**Step 3: Implement getAttendanceTrends**

```typescript
async getAttendanceTrends(query: AnalyticsQueryDto) {
  const { from, to } = this.getDateRange(query);
  const granularity = query.granularity || Granularity.MONTHLY;

  const attendances = await this.prisma.attendance.findMany({
    where: { checkInDate: { gte: from, lte: to } },
    select: { checkInDate: true, checkInTime: true, memberId: true },
  });

  // Build time series
  const buckets: Record<string, { checkIns: number; members: Set<string> }> = {};
  const dayOfWeekCounts = new Array(7).fill(0);
  const hourCounts = new Array(24).fill(0);

  for (const a of attendances) {
    const key = this.getPeriodKey(a.checkInDate, granularity);
    if (!buckets[key]) {
      buckets[key] = { checkIns: 0, members: new Set() };
    }
    buckets[key].checkIns++;
    buckets[key].members.add(a.memberId);

    dayOfWeekCounts[a.checkInTime.getDay()]++;
    hourCounts[a.checkInTime.getHours()]++;
  }

  const series = Object.entries(buckets)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, data]) => ({
      period,
      checkIns: data.checkIns,
      uniqueMembers: data.members.size,
    }));

  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const peakDayIndex = dayOfWeekCounts.indexOf(Math.max(...dayOfWeekCounts));
  const peakHour = hourCounts.indexOf(Math.max(...hourCounts));

  return {
    series,
    peakDayOfWeek: days[peakDayIndex],
    peakHour,
  };
}
```

**Step 4: Run test to verify it passes**

Run: `yarn test -- --testPathPattern=analytics.service`
Expected: PASS

**Step 5: Commit**

```bash
git add src/analytics/analytics.service.ts src/analytics/analytics.service.spec.ts
git commit -m "feat(analytics): add attendance trends drill-down"
```

---

### Task 6: Add Subscription Trends Endpoint

**Files:**
- Modify: `src/analytics/analytics.service.ts`
- Modify: `src/analytics/analytics.service.spec.ts`

**Step 1: Write the failing test**

```typescript
describe('getSubscriptionTrends', () => {
  it('should return subscription series with churn data', async () => {
    prisma.memberSubscription.findMany.mockResolvedValue([
      { status: 'ACTIVE', createdAt: new Date('2026-01-10'), plan: { name: 'Basic' }, paymentMethod: 'MPESA' },
      { status: 'CANCELLED', createdAt: new Date('2026-01-20'), plan: { name: 'Premium' }, paymentMethod: 'CARD' },
      { status: 'EXPIRED', createdAt: new Date('2026-02-05'), plan: { name: 'Basic' }, paymentMethod: 'MPESA' },
    ]);
    prisma.memberSubscription.count
      .mockResolvedValueOnce(50); // total active for churn calc

    const result = await service.getSubscriptionTrends({
      from: '2026-01-01',
      to: '2026-03-01',
      granularity: Granularity.MONTHLY,
    });

    expect(result.series).toBeDefined();
    expect(result.byPlan).toBeDefined();
    expect(result.byPaymentMethod).toBeDefined();
    expect(result.churnRate).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `yarn test -- --testPathPattern=analytics.service`
Expected: FAIL

**Step 3: Implement getSubscriptionTrends**

```typescript
async getSubscriptionTrends(query: AnalyticsQueryDto) {
  const { from, to } = this.getDateRange(query);
  const granularity = query.granularity || Granularity.MONTHLY;

  const subscriptions = await this.prisma.memberSubscription.findMany({
    where: { createdAt: { gte: from, lte: to } },
    select: {
      status: true,
      createdAt: true,
      plan: { select: { name: true } },
      paymentMethod: true,
    },
  });

  const buckets: Record<string, { newSubscriptions: number; cancellations: number; expirations: number }> = {};
  const byPlan: Record<string, number> = {};
  const byPaymentMethod: Record<string, number> = {};
  let totalCancelled = 0;
  let totalExpired = 0;

  for (const s of subscriptions) {
    const key = this.getPeriodKey(s.createdAt, granularity);
    if (!buckets[key]) {
      buckets[key] = { newSubscriptions: 0, cancellations: 0, expirations: 0 };
    }

    if (s.status === 'ACTIVE') {
      buckets[key].newSubscriptions++;
      byPlan[s.plan.name] = (byPlan[s.plan.name] || 0) + 1;
      byPaymentMethod[s.paymentMethod] = (byPaymentMethod[s.paymentMethod] || 0) + 1;
    } else if (s.status === 'CANCELLED') {
      buckets[key].cancellations++;
      totalCancelled++;
    } else if (s.status === 'EXPIRED') {
      buckets[key].expirations++;
      totalExpired++;
    }
  }

  const totalActive = await this.prisma.memberSubscription.count({
    where: { status: 'ACTIVE' },
  });

  const churnRate = totalActive > 0
    ? Math.round(((totalCancelled + totalExpired) / totalActive) * 100 * 10) / 10
    : 0;

  const series = Object.entries(buckets)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, data]) => ({
      period,
      ...data,
    }));

  return { series, byPlan, byPaymentMethod, churnRate };
}
```

**Step 4: Run test to verify it passes**

Run: `yarn test -- --testPathPattern=analytics.service`
Expected: PASS

**Step 5: Commit**

```bash
git add src/analytics/analytics.service.ts src/analytics/analytics.service.spec.ts
git commit -m "feat(analytics): add subscription trends drill-down"
```

---

### Task 7: Add Member Growth Trends Endpoint

**Files:**
- Modify: `src/analytics/analytics.service.ts`
- Modify: `src/analytics/analytics.service.spec.ts`

**Step 1: Write the failing test**

Add to mock in `beforeEach`:

```typescript
prisma.user.findMany = jest.fn();
```

Add test:

```typescript
describe('getMemberTrends', () => {
  it('should return member growth series with breakdowns', async () => {
    prisma.user.findMany.mockResolvedValue([
      { role: 'MEMBER', status: 'ACTIVE', createdAt: new Date('2026-01-05') },
      { role: 'MEMBER', status: 'ACTIVE', createdAt: new Date('2026-01-20') },
      { role: 'MEMBER', status: 'INACTIVE', createdAt: new Date('2026-02-10') },
    ]);
    prisma.user.count
      .mockResolvedValueOnce(100)  // total members for running total
      .mockResolvedValueOnce(80)   // MEMBER
      .mockResolvedValueOnce(5)    // TRAINER
      .mockResolvedValueOnce(3)    // ADMIN
      .mockResolvedValueOnce(1)    // SUPER_ADMIN
      .mockResolvedValueOnce(70)   // ACTIVE
      .mockResolvedValueOnce(15)   // INACTIVE
      .mockResolvedValueOnce(4);   // SUSPENDED

    const result = await service.getMemberTrends({
      from: '2026-01-01',
      to: '2026-03-01',
      granularity: Granularity.MONTHLY,
    });

    expect(result.series).toBeDefined();
    expect(result.byRole).toBeDefined();
    expect(result.byStatus).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `yarn test -- --testPathPattern=analytics.service`
Expected: FAIL

**Step 3: Implement getMemberTrends**

```typescript
async getMemberTrends(query: AnalyticsQueryDto) {
  const { from, to } = this.getDateRange(query);
  const granularity = query.granularity || Granularity.MONTHLY;

  const users = await this.prisma.user.findMany({
    where: { createdAt: { gte: from, lte: to } },
    select: { role: true, status: true, createdAt: true },
  });

  const buckets: Record<string, number> = {};
  for (const u of users) {
    const key = this.getPeriodKey(u.createdAt, granularity);
    buckets[key] = (buckets[key] || 0) + 1;
  }

  // Get total count of users created before the range for running total
  const priorCount = await this.prisma.user.count({
    where: { createdAt: { lt: from } },
  });

  let runningTotal = priorCount;
  const series = Object.entries(buckets)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, newMembers]) => {
      runningTotal += newMembers;
      return { period, newMembers, totalMembers: runningTotal };
    });

  const [memberCount, trainerCount, adminCount, superAdminCount, activeCount, inactiveCount, suspendedCount] =
    await Promise.all([
      this.prisma.user.count({ where: { role: 'MEMBER' } }),
      this.prisma.user.count({ where: { role: 'TRAINER' } }),
      this.prisma.user.count({ where: { role: 'ADMIN' } }),
      this.prisma.user.count({ where: { role: 'SUPER_ADMIN' } }),
      this.prisma.user.count({ where: { status: 'ACTIVE' } }),
      this.prisma.user.count({ where: { status: 'INACTIVE' } }),
      this.prisma.user.count({ where: { status: 'SUSPENDED' } }),
    ]);

  return {
    series,
    byRole: { MEMBER: memberCount, TRAINER: trainerCount, ADMIN: adminCount, SUPER_ADMIN: superAdminCount },
    byStatus: { ACTIVE: activeCount, INACTIVE: inactiveCount, SUSPENDED: suspendedCount },
  };
}
```

**Step 4: Run test to verify it passes**

Run: `yarn test -- --testPathPattern=analytics.service`
Expected: PASS

**Step 5: Commit**

```bash
git add src/analytics/analytics.service.ts src/analytics/analytics.service.spec.ts
git commit -m "feat(analytics): add member growth trends drill-down"
```

---

### Task 8: Create AnalyticsController

**Files:**
- Create: `src/analytics/analytics.controller.ts`

**Step 1: Create the controller**

```typescript
import {
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AnalyticsService } from './analytics.service';
import { AnalyticsQueryDto } from './dto/analytics-query.dto';

@ApiTags('Analytics')
@ApiBearerAuth()
@Controller('analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('dashboard')
  @Roles('ADMIN', 'SUPER_ADMIN')
  getDashboard(@CurrentUser('role') role: string) {
    return this.analyticsService.getDashboard(role);
  }

  @Get('revenue')
  @Roles('SUPER_ADMIN')
  getRevenue(
    @Query() query: AnalyticsQueryDto,
    @Query('paymentMethod') paymentMethod?: string,
  ) {
    return this.analyticsService.getRevenueTrends(query, paymentMethod);
  }

  @Get('attendance')
  @Roles('ADMIN', 'SUPER_ADMIN')
  getAttendance(@Query() query: AnalyticsQueryDto) {
    return this.analyticsService.getAttendanceTrends(query);
  }

  @Get('subscriptions')
  @Roles('ADMIN', 'SUPER_ADMIN')
  getSubscriptions(@Query() query: AnalyticsQueryDto) {
    return this.analyticsService.getSubscriptionTrends(query);
  }

  @Get('members')
  @Roles('ADMIN', 'SUPER_ADMIN')
  getMembers(@Query() query: AnalyticsQueryDto) {
    return this.analyticsService.getMemberTrends(query);
  }
}
```

**Step 2: Commit**

```bash
git add src/analytics/analytics.controller.ts
git commit -m "feat(analytics): add analytics controller with all endpoints"
```

---

### Task 9: Create AnalyticsModule and Register in AppModule

**Files:**
- Create: `src/analytics/analytics.module.ts`
- Modify: `src/app.module.ts`

**Step 1: Create the module**

```typescript
import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';

@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
})
export class AnalyticsModule {}
```

**Step 2: Register in AppModule**

In `src/app.module.ts`, add import:

```typescript
import { AnalyticsModule } from './analytics/analytics.module';
```

Add `AnalyticsModule` to the `imports` array after `BillingModule`.

**Step 3: Run all tests**

Run: `yarn test`
Expected: All tests pass (existing + new analytics tests)

**Step 4: Run lint**

Run: `yarn lint`
Expected: No errors

**Step 5: Commit**

```bash
git add src/analytics/analytics.module.ts src/app.module.ts
git commit -m "feat(analytics): register analytics module in app"
```

---

### Task 10: Verify End-to-End

**Step 1: Build the project**

Run: `yarn build`
Expected: Successful build with no errors

**Step 2: Run all tests one final time**

Run: `yarn test`
Expected: All tests pass

**Step 3: Run lint**

Run: `yarn lint`
Expected: Clean

**Step 4: Final commit if any lint fixes were needed**

```bash
git add -A
git commit -m "fix(analytics): lint fixes"
```
