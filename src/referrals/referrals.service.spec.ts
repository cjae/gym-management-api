import { Test, TestingModule } from '@nestjs/testing';
import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaClient } from '@prisma/client';
import { ReferralsService } from './referrals.service';
import { PrismaService } from '../prisma/prisma.service';
import { GymSettingsService } from '../gym-settings/gym-settings.service';
import { NotFoundException } from '@nestjs/common';

describe('ReferralsService', () => {
  let service: ReferralsService;
  let prisma: DeepMockProxy<PrismaClient>;
  let gymSettingsService: { getCachedSettings: jest.Mock };

  beforeEach(async () => {
    gymSettingsService = { getCachedSettings: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReferralsService,
        { provide: PrismaService, useValue: mockDeep<PrismaClient>() },
        { provide: GymSettingsService, useValue: gymSettingsService },
      ],
    }).compile();

    service = module.get<ReferralsService>(ReferralsService);
    prisma = module.get(PrismaService);
  });

  describe('getMyCode', () => {
    it('should return the user referral code', async () => {
      prisma.user.findUnique.mockResolvedValue({
        referralCode: 'ABC123',
      } as any);

      const result = await service.getMyCode('user-1');

      expect(result).toEqual({ referralCode: 'ABC123' });
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        select: { referralCode: true },
      });
    });

    it('should throw NotFoundException when user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getMyCode('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getMyReferrals', () => {
    it('should return paginated referrals with referredName mapped', async () => {
      const now = new Date();
      const referrals = [
        {
          id: 'ref-1',
          referrerId: 'user-1',
          referredId: 'user-2',
          status: 'COMPLETED',
          rewardDays: 7,
          completedAt: now,
          createdAt: now,
          referred: { firstName: 'Jane', lastName: 'Doe' },
        },
      ];

      prisma.referral.findMany.mockResolvedValue(referrals as any);
      prisma.referral.count.mockResolvedValue(1);

      const result = await service.getMyReferrals('user-1', 1, 20);

      expect(result).toEqual({
        data: [
          {
            id: 'ref-1',
            referredName: 'Jane Doe',
            status: 'COMPLETED',
            rewardDays: 7,
            completedAt: now,
            createdAt: now,
          },
        ],
        total: 1,
        page: 1,
        limit: 20,
      });
    });

    it('should return empty data array when no referrals', async () => {
      prisma.referral.findMany.mockResolvedValue([]);
      prisma.referral.count.mockResolvedValue(0);

      const result = await service.getMyReferrals('user-1');

      expect(result.data).toEqual([]);
      expect(result.total).toBe(0);
    });
  });

  describe('getStats', () => {
    it('should return complete stats with cycle info when user has active subscription', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1' } as any);
      gymSettingsService.getCachedSettings.mockResolvedValue({
        maxReferralsPerCycle: 5,
        referralRewardDays: 10,
      });

      const subscription = {
        id: 'sub-1',
        primaryMemberId: 'user-1',
        status: 'ACTIVE',
        startDate: new Date('2026-03-01'),
        nextBillingDate: new Date('2026-04-01'),
        plan: { billingInterval: 'MONTHLY' },
      };

      prisma.referral.count
        .mockResolvedValueOnce(10) // totalReferrals
        .mockResolvedValueOnce(6) // completedReferrals
        .mockResolvedValueOnce(2); // referralsThisCycle
      prisma.referral.aggregate.mockResolvedValue({
        _sum: { rewardDays: 42 },
      } as any);
      prisma.memberSubscription.findFirst.mockResolvedValue(
        subscription as any,
      );

      const result = await service.getStats('user-1');

      expect(result).toEqual({
        totalReferrals: 10,
        completedReferrals: 6,
        totalDaysEarned: 42,
        referralsThisCycle: 2,
        maxReferralsPerCycle: 5,
        remainingThisCycle: 3,
        rewardDaysPerReferral: 10,
      });
    });

    it('should return 0 cycle referrals when no active subscription', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1' } as any);
      gymSettingsService.getCachedSettings.mockResolvedValue(null);

      prisma.referral.count
        .mockResolvedValueOnce(3) // totalReferrals
        .mockResolvedValueOnce(1); // completedReferrals
      prisma.referral.aggregate.mockResolvedValue({
        _sum: { rewardDays: 7 },
      } as any);
      prisma.memberSubscription.findFirst.mockResolvedValue(null);

      const result = await service.getStats('user-1');

      expect(result).toEqual({
        totalReferrals: 3,
        completedReferrals: 1,
        totalDaysEarned: 7,
        referralsThisCycle: 0,
        maxReferralsPerCycle: 3,
        remainingThisCycle: 3,
        rewardDaysPerReferral: 7,
      });
    });

    it('should throw NotFoundException when user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getStats('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
