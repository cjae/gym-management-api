import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { PrismaService } from '../prisma/prisma.service';
import { AdminPaymentMethod } from './dto/admin-create-subscription.dto';

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
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
      deleteMany: jest.fn(),
    },
    subscriptionMember: {
      create: jest.fn(),
      findFirst: jest.fn(),
      deleteMany: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    payment: {
      create: jest.fn(),
      deleteMany: jest.fn(),
    },
    $transaction: jest.fn((input) =>
      typeof input === 'function' ? input(mockPrisma) : Promise.all(input),
    ),
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

  describe('create', () => {
    const mockPlan = {
      id: 'plan-1',
      name: 'Monthly',
      billingInterval: 'MONTHLY',
      price: 5000,
      maxMembers: 1,
      maxFreezeDays: 0,
      isActive: true,
    };

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should create subscription with PENDING status', async () => {
      mockPrisma.subscriptionPlan.findUnique.mockResolvedValueOnce(mockPlan);
      mockPrisma.subscriptionMember.findFirst.mockResolvedValueOnce(null); // no active sub
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        firstName: 'Jane',
        lastName: 'Doe',
      });
      mockPrisma.memberSubscription.findFirst.mockResolvedValueOnce(null); // no pending sub
      mockPrisma.memberSubscription.create.mockResolvedValueOnce({
        id: 'sub-1',
        primaryMemberId: 'user-1',
        planId: 'plan-1',
        status: 'PENDING',
        paymentMethod: 'MPESA',
      });

      const result = await service.create('user-1', {
        planId: 'plan-1',
        paymentMethod: 'MPESA' as any,
      });

      expect(result.status).toBe('PENDING');
      expect(mockPrisma.memberSubscription.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'PENDING',
          }),
        }),
      );
    });

    it('should update existing PENDING subscription instead of creating new one', async () => {
      mockPrisma.subscriptionPlan.findUnique.mockResolvedValueOnce(mockPlan);
      mockPrisma.subscriptionMember.findFirst.mockResolvedValueOnce(null); // no active sub
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        firstName: 'Jane',
        lastName: 'Doe',
      });
      mockPrisma.memberSubscription.findFirst.mockResolvedValueOnce({
        id: 'pending-sub-1',
        primaryMemberId: 'user-1',
        status: 'PENDING',
      }); // existing pending sub
      mockPrisma.memberSubscription.update.mockResolvedValueOnce({
        id: 'pending-sub-1',
        primaryMemberId: 'user-1',
        planId: 'plan-1',
        status: 'PENDING',
        paymentMethod: 'MPESA',
      });

      const result = await service.create('user-1', {
        planId: 'plan-1',
        paymentMethod: 'MPESA' as any,
      });

      expect(result.id).toBe('pending-sub-1');
      expect(mockPrisma.memberSubscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'pending-sub-1' },
          data: expect.objectContaining({
            planId: 'plan-1',
          }),
        }),
      );
      expect(mockPrisma.memberSubscription.create).not.toHaveBeenCalled();
    });

    it('should reject if plan is not active', async () => {
      mockPrisma.subscriptionPlan.findUnique.mockResolvedValueOnce({
        ...mockPlan,
        isActive: false,
      });

      await expect(
        service.create('user-1', { planId: 'plan-1', paymentMethod: 'MPESA' as any }),
      ).rejects.toThrow('Subscription plan is not active');
    });

    it('should reject if member already has an active subscription', async () => {
      mockPrisma.subscriptionPlan.findUnique.mockResolvedValueOnce(mockPlan);
      mockPrisma.subscriptionMember.findFirst.mockResolvedValueOnce({ id: 'sm-1' }); // has active

      await expect(
        service.create('user-1', { planId: 'plan-1', paymentMethod: 'MPESA' as any }),
      ).rejects.toThrow('Member already has an active subscription');
    });
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

  describe('findByMember', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should exclude PENDING subscriptions', async () => {
      mockPrisma.memberSubscription.findMany.mockResolvedValueOnce([]);

      await service.findByMember('user-1');

      expect(mockPrisma.memberSubscription.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: { not: 'PENDING' },
          }),
        }),
      );
    });
  });

  describe('findAll', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should exclude PENDING subscriptions', async () => {
      mockPrisma.memberSubscription.findMany.mockResolvedValueOnce([]);
      mockPrisma.memberSubscription.count.mockResolvedValueOnce(0);

      await service.findAll(1, 20);

      const findManyCall =
        mockPrisma.memberSubscription.findMany.mock.calls[0][0];
      expect(findManyCall.where).toEqual(
        expect.objectContaining({ status: { not: 'PENDING' } }),
      );
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

  describe('adminCreate', () => {
    const adminId = 'admin-1';
    const mockMember = {
      id: 'member-1',
      firstName: 'Jane',
      lastName: 'Doe',
      role: 'MEMBER',
    };
    const mockPlanActive = {
      id: 'plan-1',
      name: 'Monthly',
      billingInterval: 'MONTHLY',
      price: 5000,
      maxMembers: 1,
      maxFreezeDays: 0,
      isActive: true,
    };
    const baseDto = {
      memberId: 'member-1',
      planId: 'plan-1',
      paymentMethod: AdminPaymentMethod.MPESA_OFFLINE,
      paymentReference: 'MPESA-TXN-ABC123',
    };

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should create ACTIVE subscription with PAID payment record', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(mockMember);
      mockPrisma.subscriptionPlan.findUnique.mockResolvedValueOnce(
        mockPlanActive,
      );
      mockPrisma.subscriptionMember.findFirst.mockResolvedValueOnce(null); // no active sub
      mockPrisma.memberSubscription.findFirst.mockResolvedValueOnce(null); // no pending sub

      const createdSub = {
        id: 'sub-1',
        primaryMemberId: 'member-1',
        planId: 'plan-1',
        status: 'ACTIVE',
        paymentMethod: 'MPESA_OFFLINE',
        plan: mockPlanActive,
        members: [{ memberId: 'member-1' }],
      };
      mockPrisma.memberSubscription.create.mockResolvedValueOnce(createdSub);
      mockPrisma.payment.create.mockResolvedValueOnce({ id: 'pay-1' });

      const result = await service.adminCreate(adminId, baseDto);

      expect(result.status).toBe('ACTIVE');
      expect(mockPrisma.memberSubscription.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'ACTIVE',
            primaryMemberId: 'member-1',
            createdBy: adminId,
            autoRenew: false,
          }),
        }),
      );
      expect(mockPrisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            amount: 5000,
            status: 'PAID',
            paymentMethod: 'MPESA_OFFLINE',
            paystackReference: 'MPESA-TXN-ABC123',
          }),
        }),
      );
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'activity.subscription',
        expect.objectContaining({
          type: 'subscription',
        }),
      );
    });

    it('should update existing PENDING subscription to ACTIVE instead of creating new one', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(mockMember);
      mockPrisma.subscriptionPlan.findUnique.mockResolvedValueOnce(
        mockPlanActive,
      );
      mockPrisma.subscriptionMember.findFirst.mockResolvedValueOnce(null); // no active sub
      mockPrisma.memberSubscription.findFirst.mockResolvedValueOnce({
        id: 'pending-sub-1',
        primaryMemberId: 'member-1',
        status: 'PENDING',
      }); // existing pending sub

      const updatedSub = {
        id: 'pending-sub-1',
        primaryMemberId: 'member-1',
        planId: 'plan-1',
        status: 'ACTIVE',
        paymentMethod: 'MPESA_OFFLINE',
        plan: mockPlanActive,
        members: [{ memberId: 'member-1' }],
      };
      mockPrisma.memberSubscription.update.mockResolvedValueOnce(updatedSub);
      mockPrisma.payment.create.mockResolvedValueOnce({ id: 'pay-1' });

      const result = await service.adminCreate(adminId, baseDto);

      expect(result.id).toBe('pending-sub-1');
      expect(result.status).toBe('ACTIVE');
      expect(mockPrisma.memberSubscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'pending-sub-1' },
          data: expect.objectContaining({
            status: 'ACTIVE',
            createdBy: adminId,
          }),
        }),
      );
      expect(mockPrisma.memberSubscription.create).not.toHaveBeenCalled();
      expect(mockPrisma.payment.create).toHaveBeenCalled();
    });

    it('should reject if target user does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);

      await expect(service.adminCreate(adminId, baseDto)).rejects.toThrow(
        `User with id ${baseDto.memberId} not found`,
      );
    });

    it('should reject if target user is not a MEMBER', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        ...mockMember,
        role: 'TRAINER',
      });

      await expect(service.adminCreate(adminId, baseDto)).rejects.toThrow(
        'Can only create subscriptions for users with MEMBER role',
      );
    });

    it('should reject if member already has an active subscription', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(mockMember);
      mockPrisma.subscriptionPlan.findUnique.mockResolvedValueOnce(
        mockPlanActive,
      );
      mockPrisma.subscriptionMember.findFirst.mockResolvedValueOnce({
        id: 'sm-1',
      }); // has active

      await expect(service.adminCreate(adminId, baseDto)).rejects.toThrow(
        'Member already has an active subscription',
      );
    });

    it('should reject if plan is not active', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(mockMember);
      mockPrisma.subscriptionPlan.findUnique.mockResolvedValueOnce({
        ...mockPlanActive,
        isActive: false,
      });

      await expect(service.adminCreate(adminId, baseDto)).rejects.toThrow(
        'Subscription plan is not active',
      );
    });

    it('should set amount to 0 for COMPLIMENTARY payment', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(mockMember);
      mockPrisma.subscriptionPlan.findUnique.mockResolvedValueOnce(
        mockPlanActive,
      );
      mockPrisma.subscriptionMember.findFirst.mockResolvedValueOnce(null);

      const createdSub = {
        id: 'sub-1',
        primaryMemberId: 'member-1',
        planId: 'plan-1',
        status: 'ACTIVE',
        paymentMethod: 'COMPLIMENTARY',
        plan: mockPlanActive,
        members: [{ memberId: 'member-1' }],
      };
      mockPrisma.memberSubscription.create.mockResolvedValueOnce(createdSub);
      mockPrisma.payment.create.mockResolvedValueOnce({ id: 'pay-2' });

      await service.adminCreate(adminId, {
        ...baseDto,
        paymentMethod: AdminPaymentMethod.COMPLIMENTARY,
      });

      expect(mockPrisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            amount: 0,
          }),
        }),
      );
    });
  });

  describe('cleanupPendingSubscriptions', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should delete PENDING subscriptions older than 1 hour and their payments', async () => {
      const staleSubscriptions = [{ id: 'sub-1' }, { id: 'sub-2' }];

      mockPrisma.memberSubscription.findMany.mockResolvedValueOnce(
        staleSubscriptions,
      );
      mockPrisma.payment.deleteMany.mockResolvedValueOnce({ count: 2 });
      mockPrisma.subscriptionMember.deleteMany.mockResolvedValueOnce({
        count: 2,
      });
      mockPrisma.memberSubscription.deleteMany.mockResolvedValueOnce({
        count: 2,
      });

      await service.cleanupPendingSubscriptions();

      expect(mockPrisma.memberSubscription.findMany).toHaveBeenCalledWith({
        where: {
          status: 'PENDING',
          createdAt: { lt: expect.any(Date) },
        },
        select: { id: true },
      });

      expect(mockPrisma.payment.deleteMany).toHaveBeenCalledWith({
        where: { subscriptionId: { in: ['sub-1', 'sub-2'] } },
      });
      expect(mockPrisma.subscriptionMember.deleteMany).toHaveBeenCalledWith({
        where: { subscriptionId: { in: ['sub-1', 'sub-2'] } },
      });
      expect(mockPrisma.memberSubscription.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['sub-1', 'sub-2'] } },
      });
    });

    it('should do nothing when no stale pending subscriptions exist', async () => {
      mockPrisma.memberSubscription.findMany.mockResolvedValueOnce([]);

      await service.cleanupPendingSubscriptions();

      expect(mockPrisma.payment.deleteMany).not.toHaveBeenCalled();
    });
  });
});
