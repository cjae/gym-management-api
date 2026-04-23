/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PaymentMethod, PrismaClient } from '@prisma/client';
import { SubscriptionsService } from './subscriptions.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { DiscountCodesService } from '../discount-codes/discount-codes.service';
import { MemberPaymentMethod } from './dto/create-subscription.dto';

describe('SubscriptionsService', () => {
  let service: SubscriptionsService;
  let prisma: DeepMockProxy<PrismaClient>;

  const mockEventEmitter = { emit: jest.fn() };

  const mockNotificationsService = {
    create: jest.fn().mockResolvedValue({}),
  };

  const mockDiscountCodesService = {
    validateCode: jest.fn(),
    redeemCode: jest.fn(),
    reverseRedemption: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionsService,
        { provide: PrismaService, useValue: mockDeep<PrismaClient>() },
        { provide: EventEmitter2, useValue: mockEventEmitter },
        { provide: NotificationsService, useValue: mockNotificationsService },
        { provide: DiscountCodesService, useValue: mockDiscountCodesService },
      ],
    }).compile();

    service = module.get<SubscriptionsService>(SubscriptionsService);
    prisma = module.get(PrismaService);

    (prisma.$transaction as jest.Mock).mockImplementation((input: unknown) =>
      typeof input === 'function'
        ? (input as (tx: typeof prisma) => unknown)(prisma)
        : Promise.all(input as Promise<unknown>[]),
    );
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
      prisma.subscriptionPlan.findUnique.mockResolvedValueOnce(mockPlan as any);
      prisma.subscriptionMember.findFirst.mockResolvedValueOnce(null); // no active sub
      prisma.user.findUnique.mockResolvedValueOnce({
        firstName: 'Jane',
        lastName: 'Doe',
      } as any);
      prisma.memberSubscription.findFirst.mockResolvedValueOnce(null); // no pending sub
      prisma.memberSubscription.create.mockResolvedValueOnce({
        id: 'sub-1',
        primaryMemberId: 'user-1',
        planId: 'plan-1',
        status: 'PENDING',
        paymentMethod: 'MOBILE_MONEY',
      } as any);

      const result = await service.create('user-1', {
        planId: 'plan-1',
        paymentMethod: MemberPaymentMethod.MOBILE_MONEY,
      });

      expect(result.status).toBe('PENDING');
      expect(prisma.memberSubscription.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'PENDING',
          }),
        }),
      );
    });

    it('should update existing PENDING subscription instead of creating new one', async () => {
      prisma.subscriptionPlan.findUnique.mockResolvedValueOnce(mockPlan as any);
      prisma.subscriptionMember.findFirst.mockResolvedValueOnce(null); // no active sub
      prisma.user.findUnique.mockResolvedValueOnce({
        firstName: 'Jane',
        lastName: 'Doe',
      } as any);
      prisma.memberSubscription.findFirst.mockResolvedValueOnce({
        id: 'pending-sub-1',
        primaryMemberId: 'user-1',
        status: 'PENDING',
      } as any); // existing pending sub
      prisma.memberSubscription.update.mockResolvedValueOnce({
        id: 'pending-sub-1',
        primaryMemberId: 'user-1',
        planId: 'plan-1',
        status: 'PENDING',
        paymentMethod: 'MOBILE_MONEY',
      } as any);

      const result = await service.create('user-1', {
        planId: 'plan-1',
        paymentMethod: MemberPaymentMethod.MOBILE_MONEY,
      });

      expect(result.id).toBe('pending-sub-1');
      expect(prisma.memberSubscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'pending-sub-1' },
          data: expect.objectContaining({
            planId: 'plan-1',
          }),
        }),
      );
      expect(prisma.memberSubscription.create).not.toHaveBeenCalled();
    });

    it('should reject if plan is not active', async () => {
      prisma.subscriptionPlan.findUnique.mockResolvedValueOnce({
        ...mockPlan,
        isActive: false,
      } as any);

      await expect(
        service.create('user-1', {
          planId: 'plan-1',
          paymentMethod: MemberPaymentMethod.MOBILE_MONEY,
        }),
      ).rejects.toThrow('Subscription plan is not active');
    });

    it('should reject if member already has an active subscription', async () => {
      prisma.subscriptionPlan.findUnique.mockResolvedValueOnce(mockPlan as any);
      prisma.subscriptionMember.findFirst.mockResolvedValueOnce({
        id: 'sm-1',
      } as any); // has active

      await expect(
        service.create('user-1', {
          planId: 'plan-1',
          paymentMethod: MemberPaymentMethod.MOBILE_MONEY,
        }),
      ).rejects.toThrow('Member already has an active subscription');
    });
  });

  describe('hasActiveSubscription', () => {
    it('should return true when member has an active subscription', async () => {
      prisma.subscriptionMember.findFirst.mockResolvedValueOnce({
        id: 'sm-1',
        subscriptionId: 'sub-1',
        memberId: 'user-1',
      } as any);

      const result = await service.hasActiveSubscription('user-1');
      expect(result).toBe(true);
      expect(prisma.subscriptionMember.findFirst).toHaveBeenCalledWith({
        where: {
          memberId: 'user-1',
          subscription: {
            status: 'ACTIVE',

            endDate: { gte: expect.any(Date) },
          },
        },
      });
    });

    it('should return false when member has no active subscription', async () => {
      prisma.subscriptionMember.findFirst.mockResolvedValueOnce(null);

      const result = await service.hasActiveSubscription('user-2');
      expect(result).toBe(false);
    });
  });

  describe('findByMember', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should exclude PENDING subscriptions', async () => {
      prisma.memberSubscription.findMany.mockResolvedValueOnce([]);

      await service.findByMember('user-1');

      expect(prisma.memberSubscription.findMany).toHaveBeenCalledWith(
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
      prisma.memberSubscription.findMany.mockResolvedValueOnce([]);
      prisma.memberSubscription.count.mockResolvedValueOnce(0);

      await service.findAll(1, 20);

      const findManyCall =
        prisma.memberSubscription.findMany.mock.calls[0]?.[0];
      expect(findManyCall?.where).toEqual(
        expect.objectContaining({ status: { not: 'PENDING' } }),
      );
    });
  });

  describe('freeze', () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 30);
    const mockSubscription = {
      id: 'sub-1',
      primaryMemberId: 'user-1',
      status: 'ACTIVE',
      endDate: futureDate,
      nextBillingDate: futureDate,
      frozenDaysUsed: 0,
      freezeCount: 0,
      freezeStartDate: null,
      freezeEndDate: null,
      plan: {
        id: 'plan-1',
        name: 'Monthly',
        maxFreezeDays: 20,
        maxFreezeCount: 1,
      },
      primaryMember: { firstName: 'John', lastName: 'Doe' },
    };

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should freeze an active subscription', async () => {
      prisma.memberSubscription.findUnique.mockResolvedValueOnce(
        mockSubscription as any,
      );
      prisma.memberSubscription.update.mockResolvedValueOnce({
        ...mockSubscription,
        status: 'FROZEN',
      } as any);

      const result = await service.freeze('sub-1', 'user-1', 'MEMBER', 10);
      expect(result.status).toBe('FROZEN');
    });

    it('should reject freeze when plan does not support it', async () => {
      prisma.memberSubscription.findUnique.mockResolvedValueOnce({
        ...mockSubscription,
        plan: { ...mockSubscription.plan, maxFreezeDays: 0 },
      } as any);

      await expect(
        service.freeze('sub-1', 'user-1', 'MEMBER', 5),
      ).rejects.toThrow('This plan does not support freezing');
    });

    it('should reject freeze when days exceed remaining freeze days', async () => {
      prisma.memberSubscription.findUnique.mockResolvedValueOnce(
        mockSubscription as any,
      );

      await expect(
        service.freeze('sub-1', 'user-1', 'MEMBER', 25),
      ).rejects.toThrow('Freeze duration cannot exceed 20 remaining days');
    });

    it('should reject freeze when days exceed remaining after partial use', async () => {
      prisma.memberSubscription.findUnique.mockResolvedValueOnce({
        ...mockSubscription,
        frozenDaysUsed: 15,
        freezeCount: 1,
        freezeCycleAnchor: futureDate,
        plan: { ...mockSubscription.plan, maxFreezeCount: 3 },
      } as any);

      await expect(
        service.freeze('sub-1', 'user-1', 'MEMBER', 10),
      ).rejects.toThrow('Freeze duration cannot exceed 5 remaining days');
    });

    it('should reject freeze when freeze count exhausted', async () => {
      prisma.memberSubscription.findUnique.mockResolvedValueOnce({
        ...mockSubscription,
        freezeCount: 1,
        freezeCycleAnchor: futureDate,
      } as any);

      await expect(
        service.freeze('sub-1', 'user-1', 'MEMBER', 5),
      ).rejects.toThrow('Maximum freeze count (1) reached this billing cycle');
    });

    it('should allow second freeze when plan allows multiple', async () => {
      prisma.memberSubscription.findUnique.mockResolvedValueOnce({
        ...mockSubscription,
        frozenDaysUsed: 5,
        freezeCount: 1,
        freezeCycleAnchor: futureDate,
        plan: { ...mockSubscription.plan, maxFreezeCount: 3 },
      } as any);
      prisma.memberSubscription.update.mockResolvedValueOnce({
        ...mockSubscription,
        status: 'FROZEN',
      } as any);

      const result = await service.freeze('sub-1', 'user-1', 'MEMBER', 10);
      expect(result.status).toBe('FROZEN');
    });

    it('should reject freeze on non-active subscription', async () => {
      prisma.memberSubscription.findUnique.mockResolvedValueOnce({
        ...mockSubscription,
        status: 'EXPIRED',
      } as any);

      await expect(
        service.freeze('sub-1', 'user-1', 'MEMBER', 5),
      ).rejects.toThrow('Only active subscriptions can be frozen');
    });

    it('should allow admin to freeze another members subscription', async () => {
      prisma.memberSubscription.findUnique.mockResolvedValueOnce(
        mockSubscription as any,
      );
      prisma.memberSubscription.update.mockResolvedValueOnce({
        ...mockSubscription,
        status: 'FROZEN',
      } as any);

      const result = await service.freeze('sub-1', 'admin-1', 'ADMIN', 10);
      expect(result.status).toBe('FROZEN');
    });

    it('should reject freeze when duration exceeds days until expiry', async () => {
      const nearExpiry = new Date();
      nearExpiry.setDate(nearExpiry.getDate() + 3);
      prisma.memberSubscription.findUnique.mockResolvedValueOnce({
        ...mockSubscription,
        endDate: nearExpiry,
      } as any);

      await expect(
        service.freeze('sub-1', 'user-1', 'MEMBER', 10),
      ).rejects.toThrow('Freeze duration cannot exceed 3 days');
    });

    it('should reject freeze from non-owner non-admin', async () => {
      prisma.memberSubscription.findUnique.mockResolvedValueOnce(
        mockSubscription as any,
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
        freezeCount: 0,
        freezeStartDate: freezeStart,
        freezeEndDate: freezeEnd,
        plan: {
          id: 'plan-1',
          name: 'Monthly',
          maxFreezeDays: 20,
          maxFreezeCount: 1,
        },
        primaryMember: { firstName: 'John', lastName: 'Doe' },
      };

      prisma.memberSubscription.findUnique.mockResolvedValueOnce(
        frozenSub as any,
      );
      prisma.memberSubscription.update.mockResolvedValueOnce({
        ...frozenSub,
        status: 'ACTIVE',
        freezeStartDate: null,
        freezeEndDate: null,
        frozenDaysUsed: 5,
      } as any);

      const result = await service.unfreeze('sub-1', 'user-1', 'MEMBER');
      expect(result.status).toBe('ACTIVE');
      expect(result.frozenDaysUsed).toBeGreaterThanOrEqual(5);
      expect(prisma.memberSubscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            freezeCount: { increment: 1 },
            frozenDaysUsed: { increment: expect.any(Number) },
          }),
        }),
      );
    });

    it('should reject unfreeze on non-frozen subscription', async () => {
      prisma.memberSubscription.findUnique.mockResolvedValueOnce({
        id: 'sub-1',
        primaryMemberId: 'user-1',
        status: 'ACTIVE',
        plan: { maxFreezeDays: 20 },
        primaryMember: { firstName: 'John', lastName: 'Doe' },
      } as any);

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
      status: 'ACTIVE',
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
      paymentMethod: PaymentMethod.MOBILE_MONEY_IN_PERSON,
      paymentReference: 'MPESA-TXN-ABC123',
    };

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should create ACTIVE subscription with PAID payment record', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(mockMember as any);
      prisma.subscriptionPlan.findUnique.mockResolvedValueOnce(
        mockPlanActive as any,
      );
      prisma.subscriptionMember.findFirst.mockResolvedValueOnce(null); // no active sub
      prisma.memberSubscription.findFirst.mockResolvedValueOnce(null); // no pending sub

      const createdSub = {
        id: 'sub-1',
        primaryMemberId: 'member-1',
        planId: 'plan-1',
        status: 'ACTIVE',
        paymentMethod: 'MOBILE_MONEY_IN_PERSON',
        plan: mockPlanActive,
        members: [{ memberId: 'member-1' }],
      };
      prisma.memberSubscription.create.mockResolvedValueOnce(createdSub as any);
      prisma.payment.create.mockResolvedValueOnce({ id: 'pay-1' } as any);

      const result = await service.adminCreate(adminId, baseDto);

      expect(result.status).toBe('ACTIVE');
      expect(prisma.memberSubscription.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'ACTIVE',
            primaryMemberId: 'member-1',
            createdBy: adminId,
            autoRenew: false,
          }),
        }),
      );
      expect(prisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            amount: 5000,
            status: 'PAID',
            paymentMethod: 'MOBILE_MONEY_IN_PERSON',
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
      prisma.user.findUnique.mockResolvedValueOnce(mockMember as any);
      prisma.subscriptionPlan.findUnique.mockResolvedValueOnce(
        mockPlanActive as any,
      );
      prisma.subscriptionMember.findFirst.mockResolvedValueOnce(null); // no active sub
      prisma.memberSubscription.findFirst.mockResolvedValueOnce({
        id: 'pending-sub-1',
        primaryMemberId: 'member-1',
        status: 'PENDING',
      } as any); // existing pending sub

      const updatedSub = {
        id: 'pending-sub-1',
        primaryMemberId: 'member-1',
        planId: 'plan-1',
        status: 'ACTIVE',
        paymentMethod: 'MOBILE_MONEY_IN_PERSON',
        plan: mockPlanActive,
        members: [{ memberId: 'member-1' }],
      };
      prisma.memberSubscription.update.mockResolvedValueOnce(updatedSub as any);
      prisma.payment.create.mockResolvedValueOnce({ id: 'pay-1' } as any);

      const result = await service.adminCreate(adminId, baseDto);

      expect(result.id).toBe('pending-sub-1');
      expect(result.status).toBe('ACTIVE');
      expect(prisma.memberSubscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'pending-sub-1' },
          data: expect.objectContaining({
            status: 'ACTIVE',
            createdBy: adminId,
          }),
        }),
      );
      expect(prisma.memberSubscription.create).not.toHaveBeenCalled();
      expect(prisma.payment.create).toHaveBeenCalled();
    });

    it('should reject if target user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(null);

      await expect(service.adminCreate(adminId, baseDto)).rejects.toThrow(
        `User with id ${baseDto.memberId} not found`,
      );
    });

    it('should reject if target user is not a MEMBER', async () => {
      prisma.user.findUnique.mockResolvedValueOnce({
        ...mockMember,
        role: 'TRAINER',
      } as any);

      await expect(service.adminCreate(adminId, baseDto)).rejects.toThrow(
        'Can only create subscriptions for users with MEMBER role',
      );
    });

    it('should reject if member is INACTIVE', async () => {
      prisma.user.findUnique.mockResolvedValueOnce({
        ...mockMember,
        status: 'INACTIVE',
      } as any);

      await expect(service.adminCreate(adminId, baseDto)).rejects.toThrow(
        'Cannot create subscription for an inactive or suspended member',
      );
    });

    it('should reject if member is SUSPENDED', async () => {
      prisma.user.findUnique.mockResolvedValueOnce({
        ...mockMember,
        status: 'SUSPENDED',
      } as any);

      await expect(service.adminCreate(adminId, baseDto)).rejects.toThrow(
        'Cannot create subscription for an inactive or suspended member',
      );
    });

    it('should reject if member already has an active subscription', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(mockMember as any);
      prisma.subscriptionPlan.findUnique.mockResolvedValueOnce(
        mockPlanActive as any,
      );
      prisma.subscriptionMember.findFirst.mockResolvedValueOnce({
        id: 'sm-1',
      } as any); // has active

      await expect(service.adminCreate(adminId, baseDto)).rejects.toThrow(
        'Member already has an active subscription',
      );
    });

    it('should reject if plan is not active', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(mockMember as any);
      prisma.subscriptionPlan.findUnique.mockResolvedValueOnce({
        ...mockPlanActive,
        isActive: false,
      } as any);

      await expect(service.adminCreate(adminId, baseDto)).rejects.toThrow(
        'Subscription plan is not active',
      );
    });

    it('should set amount to 0 for COMPLIMENTARY payment', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(mockMember as any);
      prisma.subscriptionPlan.findUnique.mockResolvedValueOnce(
        mockPlanActive as any,
      );
      prisma.subscriptionMember.findFirst.mockResolvedValueOnce(null);

      const createdSub = {
        id: 'sub-1',
        primaryMemberId: 'member-1',
        planId: 'plan-1',
        status: 'ACTIVE',
        paymentMethod: 'COMPLIMENTARY',
        plan: mockPlanActive,
        members: [{ memberId: 'member-1' }],
      };
      prisma.memberSubscription.create.mockResolvedValueOnce(createdSub as any);
      prisma.payment.create.mockResolvedValueOnce({ id: 'pay-2' } as any);

      await service.adminCreate(adminId, {
        ...baseDto,
        paymentMethod: PaymentMethod.COMPLIMENTARY,
      });

      expect(prisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            amount: 0,
          }),
        }),
      );
    });

    it('should create subscription without paymentReference', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(mockMember as any);
      prisma.subscriptionPlan.findUnique.mockResolvedValueOnce(
        mockPlanActive as any,
      );
      prisma.subscriptionMember.findFirst.mockResolvedValueOnce(null);
      prisma.memberSubscription.findFirst.mockResolvedValueOnce(null);

      const createdSub = {
        id: 'sub-1',
        primaryMemberId: 'member-1',
        planId: 'plan-1',
        status: 'ACTIVE',
        paymentMethod: 'MOBILE_MONEY_IN_PERSON',
        plan: mockPlanActive,
        members: [{ memberId: 'member-1' }],
      };
      prisma.memberSubscription.create.mockResolvedValueOnce(createdSub as any);
      prisma.payment.create.mockResolvedValueOnce({ id: 'pay-1' } as any);

      const dto = {
        memberId: 'member-1',
        planId: 'plan-1',
        paymentMethod: PaymentMethod.MOBILE_MONEY_IN_PERSON,
        // no paymentReference
      };

      const result = await service.adminCreate(adminId, dto);

      expect(result.status).toBe('ACTIVE');
      expect(prisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            paystackReference: undefined,
          }),
        }),
      );
    });
  });

  describe('create with discount code', () => {
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

    it('should create subscription with discount code', async () => {
      const discountResult = {
        discountCode: {
          id: 'dc-1',
          discountType: 'PERCENTAGE',
          discountValue: 20,
          maxUses: null,
        },
        finalPrice: 4000,
        originalPrice: 5000,
      };
      mockDiscountCodesService.validateCode.mockResolvedValueOnce(
        discountResult,
      );
      mockDiscountCodesService.redeemCode.mockResolvedValueOnce({});

      prisma.subscriptionPlan.findUnique.mockResolvedValueOnce(mockPlan as any);
      prisma.subscriptionMember.findFirst.mockResolvedValueOnce(null);
      prisma.user.findUnique.mockResolvedValueOnce({
        firstName: 'Jane',
        lastName: 'Doe',
      } as any);
      prisma.memberSubscription.findFirst.mockResolvedValueOnce(null);
      prisma.memberSubscription.create.mockResolvedValueOnce({
        id: 'sub-1',
        primaryMemberId: 'user-1',
        planId: 'plan-1',
        status: 'PENDING',
        discountCodeId: 'dc-1',
        discountAmount: 1000,
      } as any);

      const result = await service.create('user-1', {
        planId: 'plan-1',
        paymentMethod: MemberPaymentMethod.MOBILE_MONEY,
        discountCode: 'SAVE20',
      });

      expect(mockDiscountCodesService.validateCode).toHaveBeenCalledWith(
        'SAVE20',
        'plan-1',
        'user-1',
      );
      expect(result.discountCodeId).toBe('dc-1');
      expect(result.discountAmount).toBe(1000);
      expect(prisma.memberSubscription.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            discountCodeId: 'dc-1',
            discountAmount: 1000,
          }),
        }),
      );
      expect(mockDiscountCodesService.redeemCode).toHaveBeenCalled();
    });
  });

  describe('adminCreate complimentary', () => {
    const adminId = 'admin-1';

    it('should create complimentary subscription with zero amount', async () => {
      const mockMember = {
        id: 'member-1',
        firstName: 'Jane',
        lastName: 'Doe',
        role: 'MEMBER',
        status: 'ACTIVE',
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

      prisma.user.findUnique.mockResolvedValueOnce(mockMember as any);
      prisma.subscriptionPlan.findUnique.mockResolvedValueOnce(
        mockPlanActive as any,
      );
      prisma.subscriptionMember.findFirst.mockResolvedValueOnce(null);
      prisma.memberSubscription.findFirst.mockResolvedValueOnce(null);
      prisma.memberSubscription.create.mockResolvedValueOnce({
        id: 'sub-1',
        primaryMemberId: 'member-1',
        planId: 'plan-1',
        status: 'ACTIVE',
        paymentMethod: 'COMPLIMENTARY',
        plan: mockPlanActive,
        members: [{ memberId: 'member-1' }],
      } as any);
      prisma.payment.create.mockResolvedValueOnce({ id: 'pay-1' } as any);

      await service.adminCreate(adminId, {
        memberId: 'member-1',
        planId: 'plan-1',
        paymentMethod: PaymentMethod.COMPLIMENTARY,
      });

      expect(prisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            amount: 0,
          }),
        }),
      );
    });
  });

  describe('updatePaymentReference', () => {
    const subscriptionId = 'sub-1';
    const paymentReference = 'MPESA-TXN-NEW123';

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should update payment reference on the latest payment', async () => {
      prisma.memberSubscription.findUnique.mockResolvedValueOnce({
        id: subscriptionId,
        paymentMethod: 'MOBILE_MONEY_IN_PERSON',
      } as any);
      prisma.payment.findFirst.mockResolvedValueOnce({
        id: 'pay-1',
        subscriptionId,
        paystackReference: null,
      } as any);
      prisma.payment.update.mockResolvedValueOnce({
        id: 'pay-1',
        paystackReference: paymentReference,
      } as any);

      const result = await service.updatePaymentReference(
        subscriptionId,
        paymentReference,
      );

      expect(result.paystackReference).toBe(paymentReference);
      expect(prisma.payment.update).toHaveBeenCalledWith({
        where: { id: 'pay-1' },
        data: { paystackReference: paymentReference },
        select: expect.objectContaining({
          id: true,
          paystackReference: true,
        }),
      });
    });

    it('should throw NotFoundException if subscription not found', async () => {
      prisma.memberSubscription.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.updatePaymentReference(subscriptionId, paymentReference),
      ).rejects.toThrow('Subscription with id sub-1 not found');
    });

    it('should throw BadRequestException for non-offline payment method', async () => {
      prisma.memberSubscription.findUnique.mockResolvedValueOnce({
        id: subscriptionId,
        paymentMethod: 'CARD',
      } as any);

      await expect(
        service.updatePaymentReference(subscriptionId, paymentReference),
      ).rejects.toThrow(
        'Payment reference can only be updated for offline/in-person subscriptions',
      );
    });

    it('should throw NotFoundException if no payment found for subscription', async () => {
      prisma.memberSubscription.findUnique.mockResolvedValueOnce({
        id: subscriptionId,
        paymentMethod: 'BANK_TRANSFER_IN_PERSON',
      } as any);
      prisma.payment.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.updatePaymentReference(subscriptionId, paymentReference),
      ).rejects.toThrow('No payment found for subscription sub-1');
    });
  });

  describe('cleanupPendingSubscriptions', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      // jest.clearAllMocks wipes the $transaction implementation set in
      // the outer beforeEach, so re-install it for this describe block.
      (prisma.$transaction as jest.Mock).mockImplementation((input: unknown) =>
        typeof input === 'function'
          ? (input as (tx: typeof prisma) => unknown)(prisma)
          : Promise.all(input as Promise<unknown>[]),
      );
    });

    it('should delete PENDING subscriptions older than 1 hour and their payments', async () => {
      const staleSubscriptions = [{ id: 'sub-1' }, { id: 'sub-2' }];

      prisma.memberSubscription.findMany.mockResolvedValueOnce(
        staleSubscriptions as any,
      );
      // Cleanup runs one tx per stale id; each tx deletes payments,
      // subscriptionMembers, and status-guarded deletes the subscription.
      prisma.payment.deleteMany.mockResolvedValue({ count: 1 });
      prisma.subscriptionMember.deleteMany.mockResolvedValue({
        count: 1,
      } as any);
      prisma.memberSubscription.deleteMany.mockResolvedValue({
        count: 1,
      } as any);

      await service.cleanupPendingSubscriptions();

      expect(prisma.memberSubscription.findMany).toHaveBeenCalledWith({
        where: {
          status: 'PENDING',
          createdAt: { lt: expect.any(Date) },
        },
        select: { id: true },
      });

      // One reverseRedemption + one delete trio per id.
      expect(mockDiscountCodesService.reverseRedemption).toHaveBeenCalledTimes(
        2,
      );
      expect(prisma.payment.deleteMany).toHaveBeenCalledWith({
        where: { subscriptionId: 'sub-1' },
      });
      expect(prisma.payment.deleteMany).toHaveBeenCalledWith({
        where: { subscriptionId: 'sub-2' },
      });
      expect(prisma.subscriptionMember.deleteMany).toHaveBeenCalledWith({
        where: { subscriptionId: 'sub-1' },
      });
      expect(prisma.subscriptionMember.deleteMany).toHaveBeenCalledWith({
        where: { subscriptionId: 'sub-2' },
      });
      // Status-guarded atomic claim on the subscription itself.
      expect(prisma.memberSubscription.deleteMany).toHaveBeenCalledWith({
        where: { id: 'sub-1', status: 'PENDING' },
      });
      expect(prisma.memberSubscription.deleteMany).toHaveBeenCalledWith({
        where: { id: 'sub-2', status: 'PENDING' },
      });
    });

    it('should do nothing when no stale pending subscriptions exist', async () => {
      prisma.memberSubscription.findMany.mockResolvedValueOnce([]);

      await service.cleanupPendingSubscriptions();

      expect(prisma.payment.deleteMany).not.toHaveBeenCalled();
    });
  });
});
