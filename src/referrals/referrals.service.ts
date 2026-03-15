import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GymSettingsService } from '../gym-settings/gym-settings.service';

@Injectable()
export class ReferralsService {
  constructor(
    private prisma: PrismaService,
    private gymSettingsService: GymSettingsService,
  ) {}

  async getMyCode(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { referralCode: true },
    });
    if (!user) throw new NotFoundException('User not found');
    return { referralCode: user.referralCode };
  }

  async getMyReferrals(userId: string, page = 1, limit = 20) {
    const where = { referrerId: userId };
    const [referrals, total] = await Promise.all([
      this.prisma.referral.findMany({
        where,
        include: {
          referred: {
            select: { firstName: true, lastName: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.referral.count({ where }),
    ]);

    const data = referrals.map((r) => ({
      id: r.id,
      referredName: `${r.referred.firstName} ${r.referred.lastName}`,
      status: r.status,
      rewardDays: r.rewardDays,
      completedAt: r.completedAt,
      createdAt: r.createdAt,
    }));

    return { data, total, page, limit };
  }

  async getStats(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const settings = await this.gymSettingsService.getCachedSettings();
    const maxPerCycle = settings?.maxReferralsPerCycle ?? 3;
    const rewardDaysPerReferral = settings?.referralRewardDays ?? 7;

    const [totalReferrals, completedReferrals, totalDaysResult, subscription] =
      await Promise.all([
        this.prisma.referral.count({ where: { referrerId: userId } }),
        this.prisma.referral.count({
          where: { referrerId: userId, status: 'COMPLETED' },
        }),
        this.prisma.referral.aggregate({
          where: { referrerId: userId, status: 'COMPLETED' },
          _sum: { rewardDays: true },
        }),
        this.prisma.memberSubscription.findFirst({
          where: { primaryMemberId: userId, status: 'ACTIVE' },
        }),
      ]);

    let referralsThisCycle = 0;
    if (subscription) {
      referralsThisCycle = await this.prisma.referral.count({
        where: {
          referrerId: userId,
          status: 'COMPLETED',
          rewardDays: { gt: 0 },
          completedAt: { gte: subscription.startDate },
        },
      });
    }

    return {
      totalReferrals,
      completedReferrals,
      totalDaysEarned: totalDaysResult._sum.rewardDays ?? 0,
      referralsThisCycle,
      maxReferralsPerCycle: maxPerCycle,
      remainingThisCycle: Math.max(0, maxPerCycle - referralsThisCycle),
      rewardDaysPerReferral,
    };
  }
}
