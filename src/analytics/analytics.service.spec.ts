import { Test, TestingModule } from '@nestjs/testing';
import { AnalyticsService } from './analytics.service';
import { PrismaService } from '../prisma/prisma.service';

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
});
