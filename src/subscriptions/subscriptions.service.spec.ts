import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SubscriptionsService } from './subscriptions.service';
import { PrismaService } from '../prisma/prisma.service';

describe('SubscriptionsService', () => {
  let service: SubscriptionsService;
  let prisma: PrismaService;

  const mockEventEmitter = { emit: jest.fn() };

  const mockPrisma = {
    subscriptionPlan: {
      findUnique: jest.fn(),
    },
    memberSubscription: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    subscriptionMember: {
      create: jest.fn(),
      findFirst: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventEmitter2, useValue: mockEventEmitter },
      ],
    }).compile();

    service = module.get<SubscriptionsService>(SubscriptionsService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('hasActiveSubscription', () => {
    it('should return true when member has an active subscription', async () => {
      mockPrisma.subscriptionMember.findFirst.mockResolvedValueOnce({
        id: 'sm-1',
        subscriptionId: 'sub-1',
        memberId: 'user-1',
      });

      const result = await service.hasActiveSubscription('user-1');
      expect(result).toBe(true);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(prisma.subscriptionMember.findFirst).toHaveBeenCalledWith({
        where: {
          memberId: 'user-1',
          subscription: {
            status: 'ACTIVE',
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            endDate: { gte: expect.any(Date) },
          },
        },
      });
    });

    it('should return false when member has no active subscription', async () => {
      mockPrisma.subscriptionMember.findFirst.mockResolvedValueOnce(null);

      const result = await service.hasActiveSubscription('user-2');
      expect(result).toBe(false);
    });
  });

  describe('freeze', () => {
    const mockSubscription = {
      id: 'sub-1',
      primaryMemberId: 'user-1',
      status: 'ACTIVE',
      endDate: new Date('2026-04-01'),
      nextBillingDate: new Date('2026-04-01'),
      frozenDaysUsed: 0,
      freezeStartDate: null,
      freezeEndDate: null,
      plan: { id: 'plan-1', name: 'Monthly', maxFreezeDays: 20 },
      primaryMember: { firstName: 'John', lastName: 'Doe' },
    };

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should freeze an active subscription', async () => {
      mockPrisma.memberSubscription.findUnique.mockResolvedValueOnce(
        mockSubscription,
      );
      mockPrisma.memberSubscription.update.mockResolvedValueOnce({
        ...mockSubscription,
        status: 'FROZEN',
      });

      const result = await service.freeze('sub-1', 'user-1', 'MEMBER', 10);
      expect(result.status).toBe('FROZEN');
    });

    it('should reject freeze when plan does not support it', async () => {
      mockPrisma.memberSubscription.findUnique.mockResolvedValueOnce({
        ...mockSubscription,
        plan: { ...mockSubscription.plan, maxFreezeDays: 0 },
      });

      await expect(
        service.freeze('sub-1', 'user-1', 'MEMBER', 5),
      ).rejects.toThrow('This plan does not support freezing');
    });

    it('should reject freeze when days exceed plan max', async () => {
      mockPrisma.memberSubscription.findUnique.mockResolvedValueOnce(
        mockSubscription,
      );

      await expect(
        service.freeze('sub-1', 'user-1', 'MEMBER', 25),
      ).rejects.toThrow('Freeze duration cannot exceed 20 days');
    });

    it('should reject freeze when already used this cycle', async () => {
      mockPrisma.memberSubscription.findUnique.mockResolvedValueOnce({
        ...mockSubscription,
        frozenDaysUsed: 10,
      });

      await expect(
        service.freeze('sub-1', 'user-1', 'MEMBER', 5),
      ).rejects.toThrow('Freeze already used this billing cycle');
    });

    it('should reject freeze on non-active subscription', async () => {
      mockPrisma.memberSubscription.findUnique.mockResolvedValueOnce({
        ...mockSubscription,
        status: 'EXPIRED',
      });

      await expect(
        service.freeze('sub-1', 'user-1', 'MEMBER', 5),
      ).rejects.toThrow('Only active subscriptions can be frozen');
    });

    it('should allow admin to freeze another members subscription', async () => {
      mockPrisma.memberSubscription.findUnique.mockResolvedValueOnce(
        mockSubscription,
      );
      mockPrisma.memberSubscription.update.mockResolvedValueOnce({
        ...mockSubscription,
        status: 'FROZEN',
      });

      const result = await service.freeze('sub-1', 'admin-1', 'ADMIN', 10);
      expect(result.status).toBe('FROZEN');
    });

    it('should reject freeze from non-owner non-admin', async () => {
      mockPrisma.memberSubscription.findUnique.mockResolvedValueOnce(
        mockSubscription,
      );

      await expect(
        service.freeze('sub-1', 'other-user', 'MEMBER', 5),
      ).rejects.toThrow('Only the subscription owner or an admin can freeze');
    });
  });

  describe('unfreeze', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should unfreeze and extend end date by actual frozen days', async () => {
      const freezeStart = new Date();
      freezeStart.setDate(freezeStart.getDate() - 5);
      const freezeEnd = new Date();
      freezeEnd.setDate(freezeEnd.getDate() + 5);

      const frozenSub = {
        id: 'sub-1',
        primaryMemberId: 'user-1',
        status: 'FROZEN',
        endDate: new Date('2026-04-01'),
        nextBillingDate: new Date('2026-04-01'),
        frozenDaysUsed: 0,
        freezeStartDate: freezeStart,
        freezeEndDate: freezeEnd,
        plan: { id: 'plan-1', name: 'Monthly', maxFreezeDays: 20 },
        primaryMember: { firstName: 'John', lastName: 'Doe' },
      };

      mockPrisma.memberSubscription.findUnique.mockResolvedValueOnce(frozenSub);
      mockPrisma.memberSubscription.update.mockImplementationOnce(
        ({ data }) => {
          return Promise.resolve({ ...frozenSub, ...data });
        },
      );

      const result = await service.unfreeze('sub-1', 'user-1', 'MEMBER');
      expect(result.status).toBe('ACTIVE');
      expect(result.frozenDaysUsed).toBeGreaterThanOrEqual(5);
    });

    it('should reject unfreeze on non-frozen subscription', async () => {
      mockPrisma.memberSubscription.findUnique.mockResolvedValueOnce({
        id: 'sub-1',
        primaryMemberId: 'user-1',
        status: 'ACTIVE',
        plan: { maxFreezeDays: 20 },
        primaryMember: { firstName: 'John', lastName: 'Doe' },
      });

      await expect(
        service.unfreeze('sub-1', 'user-1', 'MEMBER'),
      ).rejects.toThrow('Only frozen subscriptions can be unfrozen');
    });
  });
});
