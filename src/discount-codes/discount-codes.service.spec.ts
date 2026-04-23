/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaClient, DiscountType } from '@prisma/client';
import { DiscountCodesService } from './discount-codes.service';
import { PrismaService } from '../prisma/prisma.service';

describe('DiscountCodesService', () => {
  let service: DiscountCodesService;
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DiscountCodesService,
        { provide: PrismaService, useValue: mockDeep<PrismaClient>() },
      ],
    }).compile();

    service = module.get<DiscountCodesService>(DiscountCodesService);
    prisma = module.get(PrismaService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    const baseDto = {
      code: 'SUMMER20',
      description: '20% summer discount',
      discountType: DiscountType.PERCENTAGE,
      discountValue: 20,
      startDate: '2026-01-01',
      endDate: '2026-12-31',
    };

    it('should create a discount code', async () => {
      prisma.discountCode.findUnique.mockResolvedValueOnce(null);
      prisma.discountCode.create.mockResolvedValueOnce({
        id: 'dc-1',
        code: 'SUMMER20',
        discountType: DiscountType.PERCENTAGE,
        discountValue: 20,
        isActive: true,
        plans: [],
      } as any);

      const result = await service.create(baseDto as any);

      expect(result.code).toBe('SUMMER20');
      expect(prisma.discountCode.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            code: 'SUMMER20',
            discountType: DiscountType.PERCENTAGE,
            discountValue: 20,
          }),
        }),
      );
    });

    it('should reject duplicate code', async () => {
      prisma.discountCode.findUnique.mockResolvedValueOnce({
        id: 'dc-1',
        code: 'SUMMER20',
      } as any);

      await expect(service.create(baseDto as any)).rejects.toThrow(
        ConflictException,
      );
    });

    it('should reject percentage > 100', async () => {
      prisma.discountCode.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.create({ ...baseDto, discountValue: 150 } as any),
      ).rejects.toThrow('Percentage discount cannot exceed 100');
    });

    it('should reject endDate before startDate', async () => {
      prisma.discountCode.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.create({
          ...baseDto,
          startDate: '2026-12-31',
          endDate: '2026-01-01',
        } as any),
      ).rejects.toThrow('endDate must be after startDate');
    });
  });

  describe('findOne', () => {
    it('should return a discount code by id', async () => {
      const mockCode = {
        id: 'dc-1',
        code: 'SUMMER20',
        plans: [],
        _count: { redemptions: 5 },
      };
      prisma.discountCode.findUnique.mockResolvedValueOnce(mockCode as any);

      const result = await service.findOne('dc-1');

      expect(result).toEqual(mockCode);
      expect(prisma.discountCode.findUnique).toHaveBeenCalledWith({
        where: { id: 'dc-1' },
        include: {
          plans: { include: { plan: true } },
          _count: { select: { redemptions: true } },
        },
      });
    });

    it('should throw NotFoundException for missing code', async () => {
      prisma.discountCode.findUnique.mockResolvedValueOnce(null);

      await expect(service.findOne('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findAll', () => {
    it('should return paginated results', async () => {
      const mockData = [{ id: 'dc-1', code: 'SUMMER20' }];
      prisma.discountCode.findMany.mockResolvedValueOnce(mockData as any);
      prisma.discountCode.count.mockResolvedValueOnce(1);

      const result = await service.findAll(1, 20);

      expect(result).toEqual({
        data: mockData,
        total: 1,
        page: 1,
        limit: 20,
      });
    });
  });

  describe('update', () => {
    it('should reject updates on expired codes', async () => {
      const expiredCode = {
        id: 'dc-1',
        code: 'EXPIRED',
        endDate: new Date('2020-01-01'),
        startDate: new Date('2019-01-01'),
        plans: [],
        _count: { redemptions: 0 },
      };
      prisma.discountCode.findUnique.mockResolvedValueOnce(expiredCode as any);

      await expect(
        service.update('dc-1', { description: 'updated' } as any),
      ).rejects.toThrow('Cannot update an expired discount code');
    });

    it('should reject maxUses below current redemption count', async () => {
      const activeCode = {
        id: 'dc-1',
        code: 'POPULAR',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
        currentUses: 5,
        plans: [],
        _count: { redemptions: 5 },
      };
      prisma.discountCode.findUnique.mockResolvedValueOnce(activeCode as any);

      await expect(
        service.update('dc-1', { maxUses: 3 } as any),
      ).rejects.toThrow(
        'maxUses cannot be less than current redemption count (5)',
      );
    });

    it('should allow maxUses equal to current redemption count', async () => {
      const activeCode = {
        id: 'dc-1',
        code: 'POPULAR',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
        currentUses: 5,
        plans: [],
        _count: { redemptions: 5 },
      };
      prisma.discountCode.findUnique.mockResolvedValueOnce(activeCode as any);
      prisma.discountCode.update.mockResolvedValueOnce({
        ...activeCode,
        maxUses: 5,
      } as any);

      const result = await service.update('dc-1', { maxUses: 5 } as any);

      expect(result.maxUses).toBe(5);
    });

    it('should allow updates on inactive but non-expired codes', async () => {
      const inactiveCode = {
        id: 'dc-1',
        code: 'INACTIVE',
        isActive: false,
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
        plans: [],
        _count: { redemptions: 0 },
      };
      prisma.discountCode.findUnique.mockResolvedValueOnce(inactiveCode as any);
      prisma.discountCode.update.mockResolvedValueOnce({
        ...inactiveCode,
        description: 'updated',
      } as any);

      const result = await service.update('dc-1', {
        description: 'updated',
      } as any);

      expect(result.description).toBe('updated');
    });
  });

  describe('validateCode', () => {
    const memberId = 'member-1';
    const planId = 'plan-1';

    const mockPlan = { id: planId, price: 3000 };

    const makeDiscountCode = (overrides: Record<string, any> = {}) => ({
      id: 'dc-1',
      code: 'SAVE20',
      discountType: DiscountType.PERCENTAGE,
      discountValue: 20,
      isActive: true,
      startDate: new Date('2025-01-01'),
      endDate: new Date('2027-12-31'),
      maxUses: null,
      currentUses: 0,
      maxUsesPerMember: null,
      plans: [],
      ...overrides,
    });

    it('should validate and return discount details for percentage code', async () => {
      prisma.discountCode.findUnique.mockResolvedValueOnce(
        makeDiscountCode() as any,
      );
      prisma.discountRedemptionCounter.findUnique.mockResolvedValueOnce(null);
      prisma.subscriptionPlan.findUnique.mockResolvedValueOnce(mockPlan as any);

      const result = await service.validateCode('SAVE20', planId, memberId);

      expect(result.originalPrice).toBe(3000);
      expect(result.finalPrice).toBe(2400); // 3000 * 0.8
      expect(result.discountCode.id).toBe('dc-1');
    });

    it('should validate fixed amount discount', async () => {
      prisma.discountCode.findUnique.mockResolvedValueOnce(
        makeDiscountCode({
          discountType: DiscountType.FIXED,
          discountValue: 500,
        }) as any,
      );
      prisma.discountRedemptionCounter.findUnique.mockResolvedValueOnce(null);
      prisma.subscriptionPlan.findUnique.mockResolvedValueOnce(mockPlan as any);

      const result = await service.validateCode('SAVE20', planId, memberId);

      expect(result.finalPrice).toBe(2500); // 3000 - 500
    });

    it('should reject non-existent code', async () => {
      prisma.discountCode.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.validateCode('INVALID', planId, memberId),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject inactive code', async () => {
      prisma.discountCode.findUnique.mockResolvedValueOnce(
        makeDiscountCode({ isActive: false }) as any,
      );

      await expect(
        service.validateCode('SAVE20', planId, memberId),
      ).rejects.toThrow('Discount code is invalid or unavailable');
    });

    it('should reject expired code', async () => {
      prisma.discountCode.findUnique.mockResolvedValueOnce(
        makeDiscountCode({ endDate: new Date('2020-01-01') }) as any,
      );

      await expect(
        service.validateCode('SAVE20', planId, memberId),
      ).rejects.toThrow('Discount code is invalid or unavailable');
    });

    it('should reject code not yet valid', async () => {
      prisma.discountCode.findUnique.mockResolvedValueOnce(
        makeDiscountCode({ startDate: new Date('2099-01-01') }) as any,
      );

      await expect(
        service.validateCode('SAVE20', planId, memberId),
      ).rejects.toThrow('Discount code is invalid or unavailable');
    });

    it('should reject code at global usage limit', async () => {
      prisma.discountCode.findUnique.mockResolvedValueOnce(
        makeDiscountCode({ maxUses: 10, currentUses: 10 }) as any,
      );

      await expect(
        service.validateCode('SAVE20', planId, memberId),
      ).rejects.toThrow('Discount code is invalid or unavailable');
    });

    it('should reject code at per-member limit', async () => {
      prisma.discountCode.findUnique.mockResolvedValueOnce(
        makeDiscountCode({ maxUsesPerMember: 1 }) as any,
      );
      prisma.discountRedemptionCounter.findUnique.mockResolvedValueOnce({
        uses: 1,
      } as any);

      await expect(
        service.validateCode('SAVE20', planId, memberId),
      ).rejects.toThrow(
        'You have already used this discount code the maximum number of times',
      );
    });

    it('should reject code when secondary duo member already benefited via shared subscription (H10)', async () => {
      // The counter is seeded for member-1 (the secondary) because the primary
      // already redeemed the code on their shared duo sub. validateCode queries
      // the counter, so it correctly sees uses=1 even though no DiscountRedemption
      // row has memberId=member-1.
      prisma.discountCode.findUnique.mockResolvedValueOnce(
        makeDiscountCode({ maxUsesPerMember: 1 }) as any,
      );
      prisma.discountRedemptionCounter.findUnique.mockResolvedValueOnce({
        uses: 1,
      } as any);

      await expect(
        service.validateCode('SAVE20', planId, memberId),
      ).rejects.toThrow(
        'You have already used this discount code the maximum number of times',
      );
      expect(prisma.discountRedemptionCounter.findUnique).toHaveBeenCalledWith({
        where: {
          discountCodeId_memberId: { discountCodeId: 'dc-1', memberId },
        },
        select: { uses: true },
      });
    });

    it('should reject code not valid for selected plan', async () => {
      prisma.discountCode.findUnique.mockResolvedValueOnce(
        makeDiscountCode({
          plans: [{ planId: 'other-plan' }],
        }) as any,
      );
      prisma.discountRedemptionCounter.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.validateCode('SAVE20', planId, memberId),
      ).rejects.toThrow('Discount code is not valid for the selected plan');
    });

    it('should reject fixed discount exceeding plan price', async () => {
      prisma.discountCode.findUnique.mockResolvedValueOnce(
        makeDiscountCode({
          discountType: DiscountType.FIXED,
          discountValue: 3000,
        }) as any,
      );
      prisma.discountRedemptionCounter.findUnique.mockResolvedValueOnce(null);
      prisma.subscriptionPlan.findUnique.mockResolvedValueOnce(mockPlan as any);

      await expect(
        service.validateCode('SAVE20', planId, memberId),
      ).rejects.toThrow(
        'Fixed discount cannot be greater than or equal to the plan price',
      );
    });

    it('should reject when final price below Paystack minimum', async () => {
      prisma.discountCode.findUnique.mockResolvedValueOnce(
        makeDiscountCode({
          discountType: DiscountType.PERCENTAGE,
          discountValue: 99,
        }) as any,
      );
      prisma.discountRedemptionCounter.findUnique.mockResolvedValueOnce(null);
      prisma.subscriptionPlan.findUnique.mockResolvedValueOnce(mockPlan as any);

      // 3000 * 0.01 = 30 KES < 50 KES minimum
      await expect(
        service.validateCode('SAVE20', planId, memberId),
      ).rejects.toThrow('below the minimum of 50 KES');
    });
  });

  describe('validateCodeForProbe (M6 generic error)', () => {
    // The probe endpoint (POST /discount-codes/validate) must NOT leak code
    // existence/state via distinct error strings. Every failure mode — unknown
    // code, inactive, expired, global cap, per-member cap, plan restriction,
    // sub-minimum final price, missing plan — must collapse to the same
    // generic "This discount code cannot be applied" message. The checkout
    // flow uses validateCode directly and retains specific messages.
    const memberId = 'member-1';
    const planId = 'plan-1';
    const GENERIC = 'This discount code cannot be applied';

    const mockPlan = { id: planId, price: 3000 };

    const makeDiscountCode = (overrides: Record<string, any> = {}) => ({
      id: 'dc-1',
      code: 'SAVE20',
      discountType: DiscountType.PERCENTAGE,
      discountValue: 20,
      isActive: true,
      startDate: new Date('2025-01-01'),
      endDate: new Date('2027-12-31'),
      maxUses: null,
      currentUses: 0,
      maxUsesPerMember: null,
      plans: [],
      ...overrides,
    });

    it('should return validation result on success (happy path unchanged)', async () => {
      prisma.discountCode.findUnique.mockResolvedValueOnce(
        makeDiscountCode() as any,
      );
      prisma.discountRedemptionCounter.findUnique.mockResolvedValueOnce(null);
      prisma.subscriptionPlan.findUnique.mockResolvedValueOnce(mockPlan as any);

      const result = await service.validateCodeForProbe(
        'SAVE20',
        planId,
        memberId,
      );

      expect(result.originalPrice).toBe(3000);
      expect(result.finalPrice).toBe(2400);
      expect(result.discountCode.id).toBe('dc-1');
    });

    it('should return generic error for non-existent code (no "not found" leak)', async () => {
      prisma.discountCode.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.validateCodeForProbe('NOPE', planId, memberId),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.validateCodeForProbe('NOPE', planId, memberId),
      ).rejects.toThrow(GENERIC);
    });

    it('should return generic error for inactive code (no "inactive" leak)', async () => {
      prisma.discountCode.findUnique.mockResolvedValueOnce(
        makeDiscountCode({ isActive: false }) as any,
      );

      await expect(
        service.validateCodeForProbe('SAVE20', planId, memberId),
      ).rejects.toThrow(GENERIC);
    });

    it('should return generic error for expired code (no "expired" leak)', async () => {
      prisma.discountCode.findUnique.mockResolvedValueOnce(
        makeDiscountCode({ endDate: new Date('2020-01-01') }) as any,
      );

      await expect(
        service.validateCodeForProbe('SAVE20', planId, memberId),
      ).rejects.toThrow(GENERIC);
    });

    it('should return generic error for code not yet active (no "not yet valid" leak)', async () => {
      prisma.discountCode.findUnique.mockResolvedValueOnce(
        makeDiscountCode({ startDate: new Date('2099-01-01') }) as any,
      );

      await expect(
        service.validateCodeForProbe('SAVE20', planId, memberId),
      ).rejects.toThrow(GENERIC);
    });

    it('should return generic error when global cap reached (no uses-remaining leak)', async () => {
      prisma.discountCode.findUnique.mockResolvedValueOnce(
        makeDiscountCode({ maxUses: 10, currentUses: 10 }) as any,
      );

      await expect(
        service.validateCodeForProbe('SAVE20', planId, memberId),
      ).rejects.toThrow(GENERIC);
    });

    it('should return generic error when per-member cap reached (no "already used" leak)', async () => {
      prisma.discountCode.findUnique.mockResolvedValueOnce(
        makeDiscountCode({ maxUsesPerMember: 1 }) as any,
      );
      prisma.discountRedemptionCounter.findUnique.mockResolvedValueOnce({
        uses: 1,
      } as any);

      await expect(
        service.validateCodeForProbe('SAVE20', planId, memberId),
      ).rejects.toThrow(GENERIC);
    });

    it('should return generic error when code not valid for selected plan (no plan-restriction leak)', async () => {
      prisma.discountCode.findUnique.mockResolvedValueOnce(
        makeDiscountCode({ plans: [{ planId: 'other-plan' }] }) as any,
      );
      prisma.discountRedemptionCounter.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.validateCodeForProbe('SAVE20', planId, memberId),
      ).rejects.toThrow(GENERIC);
    });

    it('should return generic error when final price below Paystack minimum', async () => {
      prisma.discountCode.findUnique.mockResolvedValueOnce(
        makeDiscountCode({
          discountType: DiscountType.PERCENTAGE,
          discountValue: 99,
        }) as any,
      );
      prisma.discountRedemptionCounter.findUnique.mockResolvedValueOnce(null);
      prisma.subscriptionPlan.findUnique.mockResolvedValueOnce(mockPlan as any);

      await expect(
        service.validateCodeForProbe('SAVE20', planId, memberId),
      ).rejects.toThrow(GENERIC);
    });

    it('should return generic error (not 404) when plan missing', async () => {
      prisma.discountCode.findUnique.mockResolvedValueOnce(
        makeDiscountCode() as any,
      );
      prisma.discountRedemptionCounter.findUnique.mockResolvedValueOnce(null);
      prisma.subscriptionPlan.findUnique.mockResolvedValueOnce(null);

      const result = service.validateCodeForProbe('SAVE20', planId, memberId);
      await expect(result).rejects.toThrow(BadRequestException);
      await expect(result).rejects.toThrow(GENERIC);
    });

    it('should log the real reason at debug level for diagnostics', async () => {
      // Reason text is still available internally for admin support via
      // server logs even though the client sees the generic message.
      prisma.discountCode.findUnique.mockResolvedValueOnce(
        makeDiscountCode({ maxUsesPerMember: 1 }) as any,
      );
      prisma.discountRedemptionCounter.findUnique.mockResolvedValueOnce({
        uses: 1,
      } as any);

      const debugSpy = jest
        .spyOn(Logger.prototype, 'debug')
        .mockImplementation();

      await expect(
        service.validateCodeForProbe('SAVE20', planId, memberId),
      ).rejects.toThrow(GENERIC);

      expect(debugSpy).toHaveBeenCalledWith(
        expect.stringContaining('already used this discount code'),
      );
      expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('SAVE20'));

      debugSpy.mockRestore();
    });

    it('should propagate unexpected (non-HTTP) errors unchanged', async () => {
      // Infrastructure faults (DB down, etc.) must NOT be masked as generic
      // "cannot be applied" — they indicate real bugs and should surface.
      prisma.discountCode.findUnique.mockRejectedValueOnce(
        new Error('connection refused'),
      );

      await expect(
        service.validateCodeForProbe('SAVE20', planId, memberId),
      ).rejects.toThrow('connection refused');
    });
  });

  describe('redeemCode', () => {
    const discountCodeId = 'dc-1';
    const memberId = 'member-1';
    const subscriptionId = 'sub-1';
    const originalAmount = 3000;
    const discountedAmount = 2400;

    it('should redeem code successfully when no per-member cap', async () => {
      prisma.subscriptionMember.findMany.mockResolvedValueOnce([
        { memberId },
      ] as any);
      prisma.discountRedemptionCounter.createMany.mockResolvedValueOnce({
        count: 1,
      });
      prisma.discountRedemptionCounter.updateMany.mockResolvedValueOnce({
        count: 1,
      });
      prisma.discountCode.updateMany.mockResolvedValueOnce({ count: 1 });
      prisma.discountRedemption.create.mockResolvedValueOnce({
        id: 'redemption-1',
        discountCodeId,
        memberId,
        subscriptionId,
      } as any);

      const result = await service.redeemCode(
        prisma,
        discountCodeId,
        memberId,
        subscriptionId,
        originalAmount,
        discountedAmount,
        null,
        null,
      );

      expect(result.id).toBe('redemption-1');
    });

    it('should redeem code successfully when under per-member cap (H9 happy path)', async () => {
      prisma.subscriptionMember.findMany.mockResolvedValueOnce([
        { memberId },
      ] as any);
      prisma.discountRedemptionCounter.createMany.mockResolvedValueOnce({
        count: 1,
      });
      // Counter increment succeeds — uses was 0, now 1, still < cap of 2.
      prisma.discountRedemptionCounter.updateMany.mockResolvedValueOnce({
        count: 1,
      });
      prisma.discountCode.updateMany.mockResolvedValueOnce({ count: 1 });
      prisma.discountRedemption.create.mockResolvedValueOnce({
        id: 'redemption-1',
        discountCodeId,
        memberId,
        subscriptionId,
      } as any);

      const result = await service.redeemCode(
        prisma,
        discountCodeId,
        memberId,
        subscriptionId,
        originalAmount,
        discountedAmount,
        null,
        2,
      );

      expect(result.id).toBe('redemption-1');
      expect(prisma.discountRedemptionCounter.updateMany).toHaveBeenCalledWith({
        where: {
          discountCodeId,
          memberId,
          uses: { lt: 2 },
        },
        data: { uses: { increment: 1 } },
      });
    });

    it('should reject replay on same (code, member) when cap already hit (H9 race)', async () => {
      prisma.subscriptionMember.findMany.mockResolvedValueOnce([
        { memberId },
      ] as any);
      prisma.discountRedemptionCounter.createMany.mockResolvedValueOnce({
        count: 0,
      });
      // Conditional increment matches 0 rows because uses is already == cap.
      prisma.discountRedemptionCounter.updateMany.mockResolvedValueOnce({
        count: 0,
      });

      await expect(
        service.redeemCode(
          prisma,
          discountCodeId,
          memberId,
          subscriptionId,
          originalAmount,
          discountedAmount,
          null,
          1,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw correct message when per-member cap is reached', async () => {
      prisma.subscriptionMember.findMany.mockResolvedValueOnce([
        { memberId },
      ] as any);
      prisma.discountRedemptionCounter.createMany.mockResolvedValueOnce({
        count: 0,
      });
      prisma.discountRedemptionCounter.updateMany.mockResolvedValueOnce({
        count: 0,
      });

      await expect(
        service.redeemCode(
          prisma,
          discountCodeId,
          memberId,
          subscriptionId,
          originalAmount,
          discountedAmount,
          null,
          1,
        ),
      ).rejects.toThrow(
        'You have already used this discount code the maximum number of times',
      );
    });

    it('should race-reject concurrent redemptions: only one succeeds (H9 atomic claim)', async () => {
      // Simulate two concurrent redeemCode calls for the same (code, member).
      // The DB serializes the conditional updateMany: the first returns count=1
      // (uses 0->1), the second returns count=0 because uses is no longer < 1.
      prisma.subscriptionMember.findMany.mockResolvedValue([
        { memberId },
      ] as any);
      prisma.discountRedemptionCounter.createMany.mockResolvedValue({
        count: 0,
      });
      prisma.discountRedemptionCounter.updateMany
        .mockResolvedValueOnce({ count: 1 }) // winner
        .mockResolvedValueOnce({ count: 0 }); // loser
      prisma.discountCode.updateMany.mockResolvedValueOnce({ count: 1 });
      prisma.discountRedemption.create.mockResolvedValueOnce({
        id: 'redemption-1',
        discountCodeId,
        memberId,
        subscriptionId,
      } as any);

      const winner = service.redeemCode(
        prisma,
        discountCodeId,
        memberId,
        subscriptionId,
        originalAmount,
        discountedAmount,
        null,
        1,
      );
      const loser = service.redeemCode(
        prisma,
        discountCodeId,
        memberId,
        'sub-2',
        originalAmount,
        discountedAmount,
        null,
        1,
      );

      await expect(winner).resolves.toMatchObject({ id: 'redemption-1' });
      await expect(loser).rejects.toThrow(ConflictException);
    });

    it('should bump counter for secondary duo member (H10 benefit semantics)', async () => {
      // Primary (memberId) redeems on a duo sub with secondary member-B. Counter
      // increment runs for BOTH members so member-B is tagged as "benefited" and
      // cannot re-use the code on a separate subscription later.
      prisma.subscriptionMember.findMany.mockResolvedValueOnce([
        { memberId },
        { memberId: 'member-b' },
      ] as any);
      prisma.discountRedemptionCounter.createMany.mockResolvedValueOnce({
        count: 2,
      });
      prisma.discountRedemptionCounter.updateMany
        .mockResolvedValueOnce({ count: 1 }) // primary
        .mockResolvedValueOnce({ count: 1 }); // secondary
      prisma.discountCode.updateMany.mockResolvedValueOnce({ count: 1 });
      prisma.discountRedemption.create.mockResolvedValueOnce({
        id: 'redemption-1',
        discountCodeId,
        memberId,
        subscriptionId,
      } as any);

      await service.redeemCode(
        prisma,
        discountCodeId,
        memberId,
        subscriptionId,
        originalAmount,
        discountedAmount,
        null,
        1,
      );

      expect(prisma.discountRedemptionCounter.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({ memberId, discountCodeId }),
          expect.objectContaining({
            memberId: 'member-b',
            discountCodeId,
          }),
        ]),
        skipDuplicates: true,
      });
      expect(prisma.discountRedemptionCounter.updateMany).toHaveBeenCalledTimes(
        2,
      );
    });

    it('should reject secondary duo member re-using code on a later subscription (H10)', async () => {
      // member-b already has uses=1 on the counter from the earlier duo
      // redemption, so the conditional increment (uses < 1) returns count=0.
      prisma.subscriptionMember.findMany.mockResolvedValueOnce([
        { memberId: 'member-b' },
      ] as any);
      prisma.discountRedemptionCounter.createMany.mockResolvedValueOnce({
        count: 0,
      });
      prisma.discountRedemptionCounter.updateMany.mockResolvedValueOnce({
        count: 0,
      });

      await expect(
        service.redeemCode(
          prisma,
          discountCodeId,
          'member-b',
          'sub-b-solo',
          originalAmount,
          discountedAmount,
          null,
          1,
        ),
      ).rejects.toThrow(
        'You have already used this discount code the maximum number of times',
      );
    });

    it('should reject when global cap is reached', async () => {
      prisma.subscriptionMember.findMany.mockResolvedValueOnce([
        { memberId },
      ] as any);
      prisma.discountRedemptionCounter.createMany.mockResolvedValueOnce({
        count: 0,
      });
      prisma.discountRedemptionCounter.updateMany.mockResolvedValueOnce({
        count: 1,
      });
      prisma.discountCode.updateMany.mockResolvedValueOnce({ count: 0 });

      await expect(
        service.redeemCode(
          prisma,
          discountCodeId,
          memberId,
          subscriptionId,
          originalAmount,
          discountedAmount,
          10,
          null,
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('deactivate', () => {
    it('should set isActive to false', async () => {
      prisma.discountCode.findUnique.mockResolvedValueOnce({
        id: 'dc-1',
        code: 'SUMMER20',
        isActive: true,
        plans: [],
        _count: { redemptions: 0 },
      } as any);
      prisma.discountCode.update.mockResolvedValueOnce({
        id: 'dc-1',
        isActive: false,
      } as any);

      const result = await service.deactivate('dc-1');

      expect(result.isActive).toBe(false);
      expect(prisma.discountCode.update).toHaveBeenCalledWith({
        where: { id: 'dc-1' },
        data: { isActive: false },
      });
    });
  });
});
