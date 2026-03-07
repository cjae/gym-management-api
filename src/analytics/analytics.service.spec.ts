import { Test, TestingModule } from '@nestjs/testing';
import { AnalyticsService } from './analytics.service';
import { PrismaService } from '../prisma/prisma.service';
import { Granularity } from './dto/analytics-query.dto';

describe('AnalyticsService', () => {
  let service: AnalyticsService;

  const now = new Date('2026-03-08T12:00:00Z');

  const mockPrisma = {
    user: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
    memberSubscription: {
      count: jest.fn(),
      findMany: jest.fn(),
      groupBy: jest.fn(),
    },
    attendance: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
    payment: {
      count: jest.fn(),
      aggregate: jest.fn(),
      findMany: jest.fn(),
    },
    staffSalaryRecord: {
      aggregate: jest.fn(),
      count: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<AnalyticsService>(AnalyticsService);
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(now);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('getDashboard', () => {
    beforeEach(() => {
      // Member stats mocks
      mockPrisma.user.count
        .mockResolvedValueOnce(100) // total
        .mockResolvedValueOnce(80) // active
        .mockResolvedValueOnce(10) // inactive
        .mockResolvedValueOnce(5) // suspended
        .mockResolvedValueOnce(15); // newThisMonth

      // Subscription stats mocks
      mockPrisma.memberSubscription.count
        .mockResolvedValueOnce(60) // active
        .mockResolvedValueOnce(8) // expiringSoon
        .mockResolvedValueOnce(5); // expiredThisMonth

      mockPrisma.memberSubscription.groupBy.mockResolvedValue([
        { planId: 'plan-1', _count: { id: 30 } },
        { planId: 'plan-2', _count: { id: 20 } },
      ]);

      // First call: getRecentActivity subscriptions, second call: byPlan resolution
      mockPrisma.memberSubscription.findMany
        .mockResolvedValueOnce([]) // getRecentActivity
        .mockResolvedValueOnce([
          // byPlan name resolution
          { plan: { name: 'Basic' }, planId: 'plan-1' },
          { plan: { name: 'Premium' }, planId: 'plan-2' },
        ]);

      // Attendance stats mocks
      mockPrisma.attendance.count
        .mockResolvedValueOnce(45) // today
        .mockResolvedValueOnce(250) // thisWeek
        .mockResolvedValueOnce(900); // last30Days (for avg calculation)

      mockPrisma.attendance.findMany.mockResolvedValue([]);

      // Payment stats mocks
      mockPrisma.payment.count
        .mockResolvedValueOnce(3) // pendingLast30Days
        .mockResolvedValueOnce(2); // failedLast30Days

      // Recent activity mocks
      mockPrisma.user.findMany.mockResolvedValue([]);
      mockPrisma.payment.findMany.mockResolvedValue([]);
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
      mockPrisma.payment.aggregate
        .mockResolvedValueOnce({ _sum: { amount: 500000 } }) // revenueThisMonth
        .mockResolvedValueOnce({ _sum: { amount: 450000 } }); // revenueLastMonth

      mockPrisma.staffSalaryRecord.aggregate.mockResolvedValue({
        _sum: { amount: 200000 },
      });
      mockPrisma.staffSalaryRecord.count.mockResolvedValue(2);

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

  describe('getRecentActivity', () => {
    it('should return merged and sorted activity feed', async () => {
      const t1 = new Date('2026-03-08T11:00:00Z');
      const t2 = new Date('2026-03-08T10:00:00Z');
      const t3 = new Date('2026-03-08T09:00:00Z');
      const t4 = new Date('2026-03-08T08:00:00Z');

      mockPrisma.user.findMany.mockResolvedValue([
        {
          id: 'u1',
          firstName: 'John',
          lastName: 'Doe',
          createdAt: t2,
        },
      ]);

      mockPrisma.attendance.findMany.mockResolvedValue([
        {
          id: 'a1',
          memberId: 'u1',
          checkInTime: t1,
          member: { firstName: 'John', lastName: 'Doe' },
        },
      ]);

      mockPrisma.payment.findMany.mockResolvedValue([
        {
          id: 'p1',
          amount: 5000,
          currency: 'KES',
          status: 'PAID',
          createdAt: t3,
          subscription: {
            primaryMember: { firstName: 'Jane', lastName: 'Smith' },
          },
        },
      ]);

      mockPrisma.memberSubscription.findMany.mockResolvedValue([
        {
          id: 's1',
          status: 'ACTIVE',
          createdAt: t4,
          primaryMember: { firstName: 'John', lastName: 'Doe' },
          plan: { name: 'Basic' },
        },
      ]);

      const result = await service.getRecentActivity(20);

      expect(result).toHaveLength(4);
      // Should be sorted by timestamp descending
      expect(result[0].type).toBe('CHECK_IN');
      expect(result[0].timestamp).toEqual(t1);
      expect(result[1].type).toBe('NEW_MEMBER');
      expect(result[1].timestamp).toEqual(t2);
      expect(result[2].type).toBe('PAYMENT');
      expect(result[2].timestamp).toEqual(t3);
      expect(result[3].type).toBe('SUBSCRIPTION');
      expect(result[3].timestamp).toEqual(t4);

      // Check message format
      expect(result[0].message).toContain('John Doe');
      expect(result[2].message).toContain('5000');
    });
  });

  describe('getRevenueTrends', () => {
    it('should return revenue series grouped by period', async () => {
      mockPrisma.payment.findMany.mockResolvedValue([
        {
          amount: 5000,
          status: 'PAID',
          paymentMethod: 'CARD',
          createdAt: new Date('2026-03-01T10:00:00Z'),
        },
        {
          amount: 3000,
          status: 'PAID',
          paymentMethod: 'MPESA',
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
          paymentMethod: 'MPESA',
          createdAt: new Date('2026-02-15T10:00:00Z'),
        },
      ]);

      const result = await service.getRevenueTrends({
        from: '2026-02-01',
        to: '2026-03-31',
        granularity: Granularity.MONTHLY,
      });

      expect(result.series).toHaveLength(2);
      // February bucket
      expect(result.series[0].period).toBe('2026-02');
      expect(result.series[0].total).toBe(1000);
      expect(result.series[0].pending).toBe(1000);
      expect(result.series[0].byMethod.mpesa).toBe(1000);
      // March bucket
      expect(result.series[1].period).toBe('2026-03');
      expect(result.series[1].total).toBe(10000);
      expect(result.series[1].paid).toBe(8000);
      expect(result.series[1].failed).toBe(2000);
      expect(result.series[1].byMethod.card).toBe(7000);
      expect(result.series[1].byMethod.mpesa).toBe(3000);
    });

    it('should filter by paymentMethod when provided', async () => {
      mockPrisma.payment.findMany.mockResolvedValue([]);

      await service.getRevenueTrends(
        { from: '2026-01-01', to: '2026-03-31' },
        'CARD',
      );

      expect(mockPrisma.payment.findMany).toHaveBeenCalledWith(
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

      mockPrisma.attendance.findMany.mockResolvedValue([
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
      ]);

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
  });

  describe('getSubscriptionTrends', () => {
    it('should return subscription series with churn rate', async () => {
      mockPrisma.memberSubscription.findMany.mockResolvedValue([
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
          paymentMethod: 'MPESA',
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
          paymentMethod: 'MPESA',
        },
      ]);

      mockPrisma.memberSubscription.count.mockResolvedValue(50);

      const result = await service.getSubscriptionTrends({
        from: '2026-03-01',
        to: '2026-03-31',
        granularity: Granularity.MONTHLY,
      });

      expect(result.series).toHaveLength(1);
      expect(result.series[0].newSubscriptions).toBe(2);
      expect(result.series[0].cancellations).toBe(1);
      expect(result.series[0].expirations).toBe(1);
      expect(result.byPlan).toEqual({ Basic: 1, Premium: 1 });
      expect(result.byPaymentMethod).toEqual({ CARD: 1, MPESA: 1 });
      // churnRate = (1 + 1) / 50 * 100 = 4
      expect(result.churnRate).toBe(4);
    });
  });

  describe('getMemberTrends', () => {
    it('should return member series with running totals and breakdowns', async () => {
      mockPrisma.user.findMany.mockResolvedValue([
        {
          role: 'MEMBER',
          status: 'ACTIVE',
          createdAt: new Date('2026-03-01T10:00:00Z'),
        },
        {
          role: 'MEMBER',
          status: 'ACTIVE',
          createdAt: new Date('2026-03-05T10:00:00Z'),
        },
        {
          role: 'TRAINER',
          status: 'ACTIVE',
          createdAt: new Date('2026-03-10T10:00:00Z'),
        },
        {
          role: 'MEMBER',
          status: 'INACTIVE',
          createdAt: new Date('2026-02-15T10:00:00Z'),
        },
      ]);

      // 10 users created before the from date
      mockPrisma.user.count.mockResolvedValue(10);

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
      // March: 3 new, running total = 11 + 3 = 14
      expect(result.series[1].period).toBe('2026-03');
      expect(result.series[1].newMembers).toBe(3);
      expect(result.series[1].totalMembers).toBe(14);

      expect(result.byRole).toEqual({
        MEMBER: 3,
        TRAINER: 1,
        ADMIN: 0,
        SUPER_ADMIN: 0,
      });
      expect(result.byStatus).toEqual({
        ACTIVE: 3,
        INACTIVE: 1,
        SUSPENDED: 0,
      });
    });
  });
});
