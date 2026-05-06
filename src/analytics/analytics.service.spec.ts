import { Test, TestingModule } from '@nestjs/testing';
import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaClient } from '@prisma/client';
import { AnalyticsService } from './analytics.service';
import { PrismaService } from '../prisma/prisma.service';
import { GymSettingsService } from '../gym-settings/gym-settings.service';
import { Granularity } from './dto/analytics-query.dto';

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let prisma: DeepMockProxy<PrismaClient>;
  let gymSettingsService: { getCachedSettings: jest.Mock };

  const now = new Date('2026-03-08T12:00:00Z');

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        { provide: PrismaService, useValue: mockDeep<PrismaClient>() },
        {
          provide: GymSettingsService,
          useValue: { getCachedSettings: jest.fn().mockResolvedValue(null) },
        },
      ],
    }).compile();

    service = module.get<AnalyticsService>(AnalyticsService);
    prisma = module.get(PrismaService);
    gymSettingsService = module.get(GymSettingsService);
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(now);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('getDashboard', () => {
    beforeEach(() => {
      // Member stats mocks
      prisma.user.count
        .mockResolvedValueOnce(100) // total
        .mockResolvedValueOnce(80) // active
        .mockResolvedValueOnce(10) // inactive
        .mockResolvedValueOnce(5) // suspended
        .mockResolvedValueOnce(15); // newThisMonth

      // Subscription stats mocks
      prisma.memberSubscription.count
        .mockResolvedValueOnce(60) // active
        .mockResolvedValueOnce(8) // expiringSoon
        .mockResolvedValueOnce(5); // expiredThisMonth

      prisma.memberSubscription.groupBy.mockResolvedValue([
        { planId: 'plan-1', _count: { id: 30 } },
        { planId: 'plan-2', _count: { id: 20 } },
      ] as any);

      // byPlan name resolution
      prisma.memberSubscription.findMany.mockResolvedValue([
        { plan: { name: 'Basic' }, planId: 'plan-1' },
        { plan: { name: 'Premium' }, planId: 'plan-2' },
      ] as any);

      // Attendance stats mocks
      prisma.attendance.count
        .mockResolvedValueOnce(45) // today
        .mockResolvedValueOnce(250) // thisWeek
        .mockResolvedValueOnce(900); // last30Days (for avg calculation)

      // Payment stats mocks
      prisma.payment.count
        .mockResolvedValueOnce(3) // pendingLast30Days
        .mockResolvedValueOnce(2); // failedLast30Days
    });

    it('should return member stats', async () => {
      const result = await service.getDashboard('ADMIN');

      expect(result.members).toEqual({
        total: 100,
        active: 80,
        inactive: 10,
        suspended: 5,
        newThisMonth: 15,
      });
    });

    it('should NOT include financials for ADMIN role', async () => {
      const result = await service.getDashboard('ADMIN');

      expect(result.financials).toBeUndefined();
    });

    it('should include financials for SUPER_ADMIN role', async () => {
      // Add financial mocks
      prisma.payment.aggregate
        .mockResolvedValueOnce({ _sum: { amount: 500000 } } as any) // revenueThisMonth
        .mockResolvedValueOnce({ _sum: { amount: 450000 } } as any); // revenueLastMonth

      prisma.staffSalaryRecord.aggregate.mockResolvedValue({
        _sum: { amount: 200000 },
      } as any);
      prisma.staffSalaryRecord.count.mockResolvedValue(2);

      const result = await service.getDashboard('SUPER_ADMIN');

      expect(result.financials).toBeDefined();
      expect(result.financials).toEqual({
        revenueThisMonth: 500000,
        revenueLastMonth: 450000,
        salariesPaidThisMonth: 200000,
        pendingSalaries: 2,
        netPositionThisMonth: 300000,
      });
    });
  });

  describe('getRevenueTrends', () => {
    it('should return revenue series grouped by period', async () => {
      prisma.payment.findMany.mockResolvedValue([
        {
          amount: 5000,
          status: 'PAID',
          paymentMethod: 'CARD',
          createdAt: new Date('2026-03-01T10:00:00Z'),
        },
        {
          amount: 3000,
          status: 'PAID',
          paymentMethod: 'MOBILE_MONEY',
          createdAt: new Date('2026-03-02T10:00:00Z'),
        },
        {
          amount: 2000,
          status: 'FAILED',
          paymentMethod: 'CARD',
          createdAt: new Date('2026-03-03T10:00:00Z'),
        },
        {
          amount: 1000,
          status: 'PENDING',
          paymentMethod: 'MOBILE_MONEY',
          createdAt: new Date('2026-02-15T10:00:00Z'),
        },
      ] as any);

      const result = await service.getRevenueTrends({
        from: '2026-02-01',
        to: '2026-03-31',
        granularity: Granularity.MONTHLY,
      });

      const callArgs = prisma.payment.findMany.mock.calls[0][0];
      const toDate: Date = callArgs?.where?.createdAt?.lte as Date;
      expect(toDate.getUTCHours()).toBe(23);
      expect(toDate.getUTCMinutes()).toBe(59);
      expect(toDate.getUTCSeconds()).toBe(59);

      expect(result.series).toHaveLength(2);
      // February bucket
      expect(result.series[0].period).toBe('2026-02');
      expect(result.series[0].total).toBe(1000);
      expect(result.series[0].pending).toBe(1000);
      expect(result.series[0].byMethod.mobileMoney).toBe(1000);
      // March bucket
      expect(result.series[1].period).toBe('2026-03');
      expect(result.series[1].total).toBe(10000);
      expect(result.series[1].paid).toBe(8000);
      expect(result.series[1].failed).toBe(2000);
      expect(result.series[1].byMethod.card).toBe(7000);
      expect(result.series[1].byMethod.mobileMoney).toBe(3000);
    });

    it('should filter by paymentMethod when provided', async () => {
      prisma.payment.findMany.mockResolvedValue([] as any);

      await service.getRevenueTrends(
        { from: '2026-01-01', to: '2026-03-31' },
        'CARD',
      );

      expect(prisma.payment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ paymentMethod: 'CARD' }) as Record<
            string,
            unknown
          >,
        }),
      );
    });
  });

  describe('getAttendanceTrends', () => {
    it('should return attendance series with peak data', async () => {
      // Monday March 2, 2026 and Wednesday March 4, 2026
      const monday = new Date('2026-03-02T08:00:00Z');
      const wednesday = new Date('2026-03-04T17:00:00Z');
      const wednesday2 = new Date('2026-03-04T09:00:00Z');

      prisma.attendance.findMany.mockResolvedValue([
        {
          checkInDate: monday,
          checkInTime: monday,
          memberId: 'u1',
        },
        {
          checkInDate: wednesday,
          checkInTime: wednesday,
          memberId: 'u2',
        },
        {
          checkInDate: wednesday,
          checkInTime: wednesday2,
          memberId: 'u3',
        },
      ] as any);

      const result = await service.getAttendanceTrends({
        from: '2026-03-01',
        to: '2026-03-31',
        granularity: Granularity.MONTHLY,
      });

      expect(result.series).toHaveLength(1);
      expect(result.series[0].checkIns).toBe(3);
      expect(result.series[0].uniqueMembers).toBe(3);
      // Wednesday (day 3) has 2 check-ins, Monday (day 1) has 1
      expect(result.peakDayOfWeek).toBe('Wednesday');
      expect(typeof result.peakHour).toBe('number');
    });

    it('should bucket peak hour in the gym timezone, not UTC', async () => {
      // 03:00 UTC = 06:00 Africa/Nairobi (UTC+3)
      // 04:00 UTC = 07:00 Africa/Nairobi — two check-ins here, so peak hour must be 7
      const checkInDate = new Date('2026-03-02T00:00:00Z');
      const at0300utc = new Date('2026-03-02T03:00:00Z');
      const at0400utc_1 = new Date('2026-03-02T04:00:00Z');
      const at0400utc_2 = new Date('2026-03-02T04:00:00Z');

      gymSettingsService.getCachedSettings.mockResolvedValue({
        timezone: 'Africa/Nairobi',
      });

      prisma.attendance.findMany.mockResolvedValue([
        { checkInDate, checkInTime: at0300utc, memberId: 'u1' },
        { checkInDate, checkInTime: at0400utc_1, memberId: 'u2' },
        { checkInDate, checkInTime: at0400utc_2, memberId: 'u3' },
      ] as any);

      const result = await service.getAttendanceTrends({
        from: '2026-03-01',
        to: '2026-03-31',
        granularity: Granularity.MONTHLY,
      });

      // Peak is 07:00 Nairobi (04:00 UTC), not 03:00 or 04:00 UTC
      expect(result.peakHour).toBe(7);
    });
  });

  describe('getSubscriptionTrends', () => {
    it('should return subscription series with churn rate', async () => {
      // First findMany: subscriptions created in period
      // Second findMany: churned subscriptions (by updatedAt)
      prisma.memberSubscription.findMany
        .mockResolvedValueOnce([
          {
            status: 'ACTIVE',
            createdAt: new Date('2026-03-01T10:00:00Z'),
            plan: { name: 'Basic' },
            paymentMethod: 'CARD',
          },
          {
            status: 'ACTIVE',
            createdAt: new Date('2026-03-02T10:00:00Z'),
            plan: { name: 'Premium' },
            paymentMethod: 'MOBILE_MONEY',
          },
          {
            status: 'CANCELLED',
            createdAt: new Date('2026-03-03T10:00:00Z'),
            plan: { name: 'Basic' },
            paymentMethod: 'CARD',
          },
          {
            status: 'EXPIRED',
            createdAt: new Date('2026-03-04T10:00:00Z'),
            plan: { name: 'Basic' },
            paymentMethod: 'MOBILE_MONEY',
          },
        ] as any)
        .mockResolvedValueOnce([
          {
            status: 'CANCELLED',
            updatedAt: new Date('2026-03-15T10:00:00Z'),
          },
          {
            status: 'EXPIRED',
            updatedAt: new Date('2026-03-20T10:00:00Z'),
          },
        ] as any);

      // Only count call: subscribersAtStart = 48
      prisma.memberSubscription.count.mockResolvedValueOnce(48);

      const result = await service.getSubscriptionTrends({
        from: '2026-03-01',
        to: '2026-03-31',
        granularity: Granularity.MONTHLY,
      });

      // Verify churn query uses updatedAt, not createdAt
      expect(prisma.memberSubscription.findMany).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          where: expect.objectContaining({
            status: { in: ['CANCELLED', 'EXPIRED'] },
            updatedAt: {
              gte: expect.any(Date),
              lte: expect.any(Date),
            },
          }),
        }),
      );

      // Verify subscribersAtStart excludes pre-period churned subs via OR condition
      expect(prisma.memberSubscription.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: { lt: expect.any(Date) },
            endDate: { gte: expect.any(Date) },
            OR: [
              {
                status: { in: ['ACTIVE', 'FROZEN'] },
              },
              {
                status: { in: ['CANCELLED', 'EXPIRED'] },
                updatedAt: { gte: expect.any(Date) },
              },
            ],
          }),
        }),
      );

      expect(result.series).toHaveLength(1);
      // All 4 non-PENDING subscriptions count as new in the period
      expect(result.series[0].newSubscriptions).toBe(4);
      // Churn bucketed by updatedAt from the second findMany
      expect(result.series[0].cancellations).toBe(1);
      expect(result.series[0].expirations).toBe(1);
      expect(result.byPlan).toEqual({ Basic: 1, Premium: 1 });
      expect(result.byPaymentMethod).toEqual({ CARD: 1, MOBILE_MONEY: 1 });
      // churnRate = 2 / (48 + 4) * 100 = 3.85
      expect(result.churnRate).toBe(3.85);
    });
  });

  describe('getExpiringMemberships', () => {
    it('should return memberships expiring within 14 days sorted by urgency', async () => {
      const fiveDaysFromNow = new Date(now);
      fiveDaysFromNow.setDate(now.getDate() + 5);
      const tenDaysFromNow = new Date(now);
      tenDaysFromNow.setDate(now.getDate() + 10);

      prisma.memberSubscription.findMany.mockResolvedValue([
        {
          id: 'sub-1',
          endDate: fiveDaysFromNow,
          primaryMember: { id: 'u1', firstName: 'Jane', lastName: 'Muthoni' },
          plan: { name: 'Premium Monthly' },
        },
        {
          id: 'sub-2',
          endDate: tenDaysFromNow,
          primaryMember: { id: 'u2', firstName: 'John', lastName: 'Kamau' },
          plan: { name: 'Basic Monthly' },
        },
      ] as any);

      const result = await service.getExpiringMemberships();

      expect(result.memberships).toHaveLength(2);
      expect(result.memberships[0]).toEqual({
        memberId: 'u1',
        memberName: 'Jane Muthoni',
        planName: 'Premium Monthly',
        expiresAt: fiveDaysFromNow,
        daysUntilExpiry: 5,
      });
      expect(result.memberships[1].daysUntilExpiry).toBe(10);
    });
  });

  describe('getMemberTrends', () => {
    it('should return member series with running totals and status breakdown', async () => {
      prisma.user.findMany.mockResolvedValue([
        {
          status: 'ACTIVE',
          createdAt: new Date('2026-03-01T10:00:00Z'),
        },
        {
          status: 'ACTIVE',
          createdAt: new Date('2026-03-05T10:00:00Z'),
        },
        {
          status: 'INACTIVE',
          createdAt: new Date('2026-02-15T10:00:00Z'),
        },
      ] as any);

      // 10 members created before the from date
      prisma.user.count.mockResolvedValue(10);

      const result = await service.getMemberTrends({
        from: '2026-02-01',
        to: '2026-03-31',
        granularity: Granularity.MONTHLY,
      });

      expect(result.series).toHaveLength(2);
      // February: 1 new, running total = 10 + 1 = 11
      expect(result.series[0].period).toBe('2026-02');
      expect(result.series[0].newMembers).toBe(1);
      expect(result.series[0].totalMembers).toBe(11);
      // March: 2 new, running total = 11 + 2 = 13
      expect(result.series[1].period).toBe('2026-03');
      expect(result.series[1].newMembers).toBe(2);
      expect(result.series[1].totalMembers).toBe(13);

      expect(result.byStatus).toEqual({
        ACTIVE: 2,
        INACTIVE: 1,
        SUSPENDED: 0,
      });
    });
  });

  describe('getShopAnalytics', () => {
    const mockOrderItems = [
      {
        shopItemId: 'item-1',
        quantity: 3,
        unitPrice: 5000,
        item: { name: 'Gym Bag' },
      },
      {
        shopItemId: 'item-1',
        quantity: 2,
        unitPrice: 5000,
        item: { name: 'Gym Bag' },
      },
      {
        shopItemId: 'item-2',
        quantity: 1,
        unitPrice: 3000,
        item: { name: 'Water Bottle' },
      },
    ];

    beforeEach(() => {
      prisma.shopOrder.count
        .mockResolvedValueOnce(10) // total
        .mockResolvedValueOnce(2) // pending
        .mockResolvedValueOnce(5) // paid
        .mockResolvedValueOnce(2) // collected
        .mockResolvedValueOnce(1); // cancelled
      prisma.shopOrder.aggregate
        .mockResolvedValueOnce({ _sum: { totalAmount: 50000 } } as any) // allTime
        .mockResolvedValueOnce({ _sum: { totalAmount: 10000 } } as any) // thisMonth
        .mockResolvedValueOnce({ _sum: { totalAmount: 8000 } } as any); // lastMonth
      prisma.shopOrderItem.findMany.mockResolvedValue(mockOrderItems as any);
      prisma.shopItem.count.mockResolvedValue(2);
      prisma.shopItemVariant.count.mockResolvedValue(1);
    });

    it('returns order counts by status', async () => {
      const result = await service.getShopAnalytics();
      expect(result.orders).toEqual({
        total: 10,
        pending: 2,
        paid: 5,
        collected: 2,
        cancelled: 1,
      });
    });

    it('returns revenue figures for all-time, this month, and last month', async () => {
      const result = await service.getShopAnalytics();
      expect(result.revenue).toEqual({
        allTime: 50000,
        thisMonth: 10000,
        lastMonth: 8000,
      });
    });

    it('computes avgOrderValue from completed orders (paid + collected)', async () => {
      const result = await service.getShopAnalytics();
      // 5 paid + 2 collected = 7 completed; 50000 / 7 ≈ 7142.86
      expect(result.avgOrderValue).toBeCloseTo(50000 / 7, 2);
    });

    it('sums unitsSold from order items of completed orders', async () => {
      const result = await service.getShopAnalytics();
      expect(result.unitsSold).toBe(6); // 3 + 2 + 1
    });

    it('returns top 5 items sorted by revenue descending', async () => {
      const result = await service.getShopAnalytics();
      expect(result.topItems).toHaveLength(2);
      expect(result.topItems[0]).toMatchObject({
        itemId: 'item-1',
        name: 'Gym Bag',
        revenue: 25000,
        unitsSold: 5,
      });
      expect(result.topItems[1]).toMatchObject({
        itemId: 'item-2',
        name: 'Water Bottle',
        revenue: 3000,
        unitsSold: 1,
      });
    });

    it('sums low stock items and variants into lowStockCount', async () => {
      const result = await service.getShopAnalytics();
      expect(result.lowStockCount).toBe(3); // 2 items + 1 variant
    });

    it('returns avgOrderValue of 0 when no completed orders exist', async () => {
      prisma.shopOrder.count.mockReset();
      prisma.shopOrder.aggregate.mockReset();
      prisma.shopOrderItem.findMany.mockReset();
      prisma.shopItem.count.mockReset();
      prisma.shopItemVariant.count.mockReset();
      prisma.shopOrder.count
        .mockResolvedValueOnce(1) // total
        .mockResolvedValueOnce(1) // pending
        .mockResolvedValueOnce(0) // paid
        .mockResolvedValueOnce(0) // collected
        .mockResolvedValueOnce(0); // cancelled
      prisma.shopOrder.aggregate.mockResolvedValue({
        _sum: { totalAmount: null },
      } as any);
      prisma.shopOrderItem.findMany.mockResolvedValue([]);
      prisma.shopItem.count.mockResolvedValue(0);
      prisma.shopItemVariant.count.mockResolvedValue(0);

      const result = await service.getShopAnalytics();
      expect(result.avgOrderValue).toBe(0);
      expect(result.unitsSold).toBe(0);
      expect(result.topItems).toHaveLength(0);
    });
  });

  describe('getShopRevenueTrends', () => {
    it('buckets PAID and COLLECTED orders by monthly period and payment method', async () => {
      prisma.shopOrder.findMany.mockResolvedValue([
        {
          totalAmount: 5000,
          paymentMethod: 'CARD',
          createdAt: new Date('2026-03-15'),
        },
        {
          totalAmount: 3000,
          paymentMethod: 'MOBILE_MONEY',
          createdAt: new Date('2026-03-20'),
        },
        {
          totalAmount: 2000,
          paymentMethod: 'CARD',
          createdAt: new Date('2026-04-01'),
        },
      ] as any);

      const result = await service.getShopRevenueTrends({
        granularity: Granularity.MONTHLY,
      });

      expect(result.series).toHaveLength(2);
      const march = result.series.find((s) => s.period === '2026-03')!;
      expect(march.revenue).toBe(8000);
      expect(march.orders).toBe(2);
      expect(march.byMethod.card).toBe(5000);
      expect(march.byMethod.mobileMoney).toBe(3000);
      expect(march.byMethod.bankTransfer).toBe(0);
    });

    it('returns series sorted chronologically', async () => {
      prisma.shopOrder.findMany.mockResolvedValue([
        {
          totalAmount: 1000,
          paymentMethod: 'CARD',
          createdAt: new Date('2026-04-01'),
        },
        {
          totalAmount: 2000,
          paymentMethod: 'CARD',
          createdAt: new Date('2026-02-01'),
        },
      ] as any);

      const result = await service.getShopRevenueTrends({
        granularity: Granularity.MONTHLY,
      });

      expect(result.series[0].period).toBe('2026-02');
      expect(result.series[1].period).toBe('2026-04');
    });

    it('returns empty series when no completed orders exist in range', async () => {
      prisma.shopOrder.findMany.mockResolvedValue([]);

      const result = await service.getShopRevenueTrends({});
      expect(result.series).toHaveLength(0);
    });

    it('passes the date range filter to Prisma', async () => {
      prisma.shopOrder.findMany.mockResolvedValue([]);

      await service.getShopRevenueTrends({
        from: '2026-01-01',
        to: '2026-03-31',
        granularity: Granularity.MONTHLY,
      });

      const shopCallArgs = prisma.shopOrder.findMany.mock.calls[0][0];
      const shopToDate: Date = shopCallArgs?.where?.createdAt?.lte as Date;
      expect(shopToDate.getUTCHours()).toBe(23);
      expect(shopToDate.getUTCMinutes()).toBe(59);
      expect(shopToDate.getUTCSeconds()).toBe(59);
      expect(shopCallArgs?.where?.createdAt?.gte).toEqual(
        new Date('2026-01-01'),
      );
    });

    it('folds *_IN_PERSON variants into base buckets and routes COMPLIMENTARY correctly', async () => {
      prisma.shopOrder.findMany.mockResolvedValue([
        {
          totalAmount: 1000,
          paymentMethod: 'CARD_IN_PERSON',
          createdAt: new Date('2026-03-01'),
        },
        {
          totalAmount: 2000,
          paymentMethod: 'MOBILE_MONEY_IN_PERSON',
          createdAt: new Date('2026-03-01'),
        },
        {
          totalAmount: 3000,
          paymentMethod: 'BANK_TRANSFER_IN_PERSON',
          createdAt: new Date('2026-03-01'),
        },
        {
          totalAmount: 500,
          paymentMethod: 'COMPLIMENTARY',
          createdAt: new Date('2026-03-01'),
        },
      ] as any);

      const result = await service.getShopRevenueTrends({
        granularity: Granularity.MONTHLY,
      });

      expect(result.series).toHaveLength(1);
      const period = result.series[0];
      expect(period.revenue).toBe(6500);
      expect(period.byMethod.card).toBe(1000);
      expect(period.byMethod.mobileMoney).toBe(2000);
      expect(period.byMethod.bankTransfer).toBe(3000);
      expect(period.byMethod.complimentary).toBe(500);
    });
  });
});
