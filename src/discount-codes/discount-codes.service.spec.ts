/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
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
      prisma.discountCode.findUnique.mockResolvedValueOnce(
        expiredCode as any,
      );

      await expect(
        service.update('dc-1', { description: 'updated' } as any),
      ).rejects.toThrow('Cannot update an expired discount code');
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
      prisma.discountCode.findUnique.mockResolvedValueOnce(
        inactiveCode as any,
      );
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
      prisma.discountRedemption.count.mockResolvedValueOnce(0);
      prisma.subscriptionPlan.findUnique.mockResolvedValueOnce(
        mockPlan as any,
      );

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
      prisma.discountRedemption.count.mockResolvedValueOnce(0);
      prisma.subscriptionPlan.findUnique.mockResolvedValueOnce(
        mockPlan as any,
      );

      const result = await service.validateCode('SAVE20', planId, memberId);

      expect(result.finalPrice).toBe(2500); // 3000 - 500
    });

    it('should reject non-existent code', async () => {
      prisma.discountCode.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.validateCode('INVALID', planId, memberId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should reject inactive code', async () => {
      prisma.discountCode.findUnique.mockResolvedValueOnce(
        makeDiscountCode({ isActive: false }) as any,
      );

      await expect(
        service.validateCode('SAVE20', planId, memberId),
      ).rejects.toThrow('Discount code is not active');
    });

    it('should reject expired code', async () => {
      prisma.discountCode.findUnique.mockResolvedValueOnce(
        makeDiscountCode({ endDate: new Date('2020-01-01') }) as any,
      );

      await expect(
        service.validateCode('SAVE20', planId, memberId),
      ).rejects.toThrow('Discount code is not within its valid date range');
    });

    it('should reject code not yet valid', async () => {
      prisma.discountCode.findUnique.mockResolvedValueOnce(
        makeDiscountCode({ startDate: new Date('2099-01-01') }) as any,
      );

      await expect(
        service.validateCode('SAVE20', planId, memberId),
      ).rejects.toThrow('Discount code is not within its valid date range');
    });

    it('should reject code at global usage limit', async () => {
      prisma.discountCode.findUnique.mockResolvedValueOnce(
        makeDiscountCode({ maxUses: 10, currentUses: 10 }) as any,
      );

      await expect(
        service.validateCode('SAVE20', planId, memberId),
      ).rejects.toThrow('Discount code has reached its maximum uses');
    });

    it('should reject code at per-member limit', async () => {
      prisma.discountCode.findUnique.mockResolvedValueOnce(
        makeDiscountCode({ maxUsesPerMember: 1 }) as any,
      );
      prisma.discountRedemption.count.mockResolvedValueOnce(1);

      await expect(
        service.validateCode('SAVE20', planId, memberId),
      ).rejects.toThrow(
        'You have already used this discount code the maximum number of times',
      );
    });

    it('should reject code not valid for selected plan', async () => {
      prisma.discountCode.findUnique.mockResolvedValueOnce(
        makeDiscountCode({
          plans: [{ planId: 'other-plan' }],
        }) as any,
      );
      prisma.discountRedemption.count.mockResolvedValueOnce(0);

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
      prisma.discountRedemption.count.mockResolvedValueOnce(0);
      prisma.subscriptionPlan.findUnique.mockResolvedValueOnce(
        mockPlan as any,
      );

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
      prisma.discountRedemption.count.mockResolvedValueOnce(0);
      prisma.subscriptionPlan.findUnique.mockResolvedValueOnce(
        mockPlan as any,
      );

      // 3000 * 0.01 = 30 KES < 50 KES minimum
      await expect(
        service.validateCode('SAVE20', planId, memberId),
      ).rejects.toThrow('below the minimum of 50 KES');
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
