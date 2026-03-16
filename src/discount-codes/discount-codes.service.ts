import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDiscountCodeDto } from './dto/create-discount-code.dto';
import { UpdateDiscountCodeDto } from './dto/update-discount-code.dto';
import { DiscountType, Prisma } from '@prisma/client';

const PAYSTACK_MIN_KES = 50;

@Injectable()
export class DiscountCodesService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateDiscountCodeDto) {
    const code = dto.code.toUpperCase();

    // Validate code uniqueness
    const existing = await this.prisma.discountCode.findUnique({
      where: { code },
    });
    if (existing) {
      throw new ConflictException(`Discount code "${code}" already exists`);
    }

    // Validate percentage <= 100
    if (dto.discountType === DiscountType.PERCENTAGE && dto.discountValue > 100) {
      throw new BadRequestException('Percentage discount cannot exceed 100');
    }

    // Validate date range
    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);
    if (endDate <= startDate) {
      throw new BadRequestException('endDate must be after startDate');
    }

    // Validate planIds if provided
    if (dto.planIds?.length) {
      const plans = await this.prisma.subscriptionPlan.findMany({
        where: { id: { in: dto.planIds } },
        select: { id: true },
      });
      if (plans.length !== dto.planIds.length) {
        throw new BadRequestException('One or more plan IDs are invalid');
      }
    }

    return this.prisma.discountCode.create({
      data: {
        code,
        description: dto.description,
        discountType: dto.discountType,
        discountValue: dto.discountValue,
        maxUses: dto.maxUses,
        maxUsesPerMember: dto.maxUsesPerMember,
        startDate,
        endDate,
        isActive: dto.isActive ?? true,
        plans: dto.planIds?.length
          ? {
              create: dto.planIds.map((planId) => ({ planId })),
            }
          : undefined,
      },
      include: {
        plans: { include: { plan: true } },
      },
    });
  }

  async findAll(page = 1, limit = 20, filter?: string) {
    const now = new Date();
    let where: Prisma.DiscountCodeWhereInput = {};

    if (filter === 'active') {
      where = { isActive: true, startDate: { lte: now }, endDate: { gte: now } };
    } else if (filter === 'expired') {
      where = { endDate: { lt: now } };
    } else if (filter === 'inactive') {
      where = { isActive: false };
    }

    const [data, total] = await Promise.all([
      this.prisma.discountCode.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          plans: { include: { plan: true } },
        },
      }),
      this.prisma.discountCode.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const discountCode = await this.prisma.discountCode.findUnique({
      where: { id },
      include: {
        plans: { include: { plan: true } },
        _count: { select: { redemptions: true } },
      },
    });

    if (!discountCode) {
      throw new NotFoundException('Discount code not found');
    }

    return discountCode;
  }

  async update(id: string, dto: UpdateDiscountCodeDto) {
    const existing = await this.findOne(id);

    // Reject if expired
    if (new Date(existing.endDate) < new Date()) {
      throw new BadRequestException('Cannot update an expired discount code');
    }

    // Validate date range
    const effectiveStart = dto.startDate
      ? new Date(dto.startDate)
      : existing.startDate;
    const effectiveEnd = dto.endDate ? new Date(dto.endDate) : existing.endDate;
    if (effectiveEnd <= effectiveStart) {
      throw new BadRequestException('endDate must be after startDate');
    }

    // Validate planIds if provided
    if (dto.planIds?.length) {
      const plans = await this.prisma.subscriptionPlan.findMany({
        where: { id: { in: dto.planIds } },
        select: { id: true },
      });
      if (plans.length !== dto.planIds.length) {
        throw new BadRequestException('One or more plan IDs are invalid');
      }
    }

    const data: Prisma.DiscountCodeUpdateInput = {};
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.maxUses !== undefined) data.maxUses = dto.maxUses;
    if (dto.maxUsesPerMember !== undefined)
      data.maxUsesPerMember = dto.maxUsesPerMember;
    if (dto.startDate) data.startDate = new Date(dto.startDate);
    if (dto.endDate) data.endDate = new Date(dto.endDate);
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    // Replace plan associations if planIds provided
    if (dto.planIds !== undefined) {
      data.plans = {
        deleteMany: {},
        create: dto.planIds.map((planId) => ({ planId })),
      };
    }

    return this.prisma.discountCode.update({
      where: { id },
      data,
      include: {
        plans: { include: { plan: true } },
      },
    });
  }

  async deactivate(id: string) {
    await this.findOne(id);
    return this.prisma.discountCode.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async getRedemptions(id: string, page = 1, limit = 20) {
    await this.findOne(id);

    const where = { discountCodeId: id };

    const [data, total] = await Promise.all([
      this.prisma.discountRedemption.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          member: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
        },
      }),
      this.prisma.discountRedemption.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async validateCode(code: string, planId: string, memberId: string) {
    // 1. Check code exists
    const discountCode = await this.prisma.discountCode.findUnique({
      where: { code: code.toUpperCase() },
      include: { plans: true },
    });
    if (!discountCode) {
      throw new NotFoundException('Discount code not found');
    }

    // 2. Check active
    if (!discountCode.isActive) {
      throw new BadRequestException('Discount code is not active');
    }

    // 3. Check date window
    const now = new Date();
    if (now < discountCode.startDate || now > discountCode.endDate) {
      throw new BadRequestException('Discount code is not within its valid date range');
    }

    // 4. Check global cap
    if (
      discountCode.maxUses !== null &&
      discountCode.currentUses >= discountCode.maxUses
    ) {
      throw new BadRequestException('Discount code has reached its maximum uses');
    }

    // 5. Check per-member cap
    const memberUses = await this.prisma.discountRedemption.count({
      where: { discountCodeId: discountCode.id, memberId },
    });
    if (
      discountCode.maxUsesPerMember !== null &&
      memberUses >= discountCode.maxUsesPerMember
    ) {
      throw new BadRequestException(
        'You have already used this discount code the maximum number of times',
      );
    }

    // 6. Check plan restriction
    if (discountCode.plans.length > 0) {
      const planAllowed = discountCode.plans.some((p) => p.planId === planId);
      if (!planAllowed) {
        throw new BadRequestException(
          'Discount code is not valid for the selected plan',
        );
      }
    }

    // 7. Discount sanity check
    const plan = await this.prisma.subscriptionPlan.findUnique({
      where: { id: planId },
    });
    if (!plan) {
      throw new NotFoundException('Subscription plan not found');
    }

    let finalPrice: number;
    if (discountCode.discountType === DiscountType.PERCENTAGE) {
      if (discountCode.discountValue < 1 || discountCode.discountValue > 100) {
        throw new BadRequestException('Invalid percentage discount value');
      }
      finalPrice = plan.price * (1 - discountCode.discountValue / 100);
    } else {
      // FIXED
      if (discountCode.discountValue >= plan.price) {
        throw new BadRequestException(
          'Fixed discount cannot be greater than or equal to the plan price',
        );
      }
      finalPrice = plan.price - discountCode.discountValue;
    }

    finalPrice = Math.round(finalPrice * 100) / 100;

    if (finalPrice < PAYSTACK_MIN_KES) {
      throw new BadRequestException(
        `Discounted price (${finalPrice} KES) is below the minimum of ${PAYSTACK_MIN_KES} KES`,
      );
    }

    return {
      discountCode: {
        id: discountCode.id,
        discountType: discountCode.discountType,
        discountValue: discountCode.discountValue,
        maxUses: discountCode.maxUses,
      },
      finalPrice,
      originalPrice: plan.price,
    };
  }

  async redeemCode(
    tx: Prisma.TransactionClient,
    discountCodeId: string,
    memberId: string,
    subscriptionId: string,
    originalAmount: number,
    discountedAmount: number,
    maxUses: number | null,
  ) {
    // Race-safe conditional increment
    const whereClause: Prisma.DiscountCodeWhereInput = { id: discountCodeId };
    if (maxUses !== null) {
      whereClause.currentUses = { lt: maxUses };
    }

    const updated = await tx.discountCode.updateMany({
      where: whereClause as Prisma.DiscountCodeWhereInput,
      data: { currentUses: { increment: 1 } },
    });

    if (updated.count === 0) {
      throw new ConflictException('Discount code has reached its maximum uses');
    }

    // Create redemption record
    return tx.discountRedemption.create({
      data: {
        discountCodeId,
        memberId,
        subscriptionId,
        originalAmount,
        discountedAmount,
      },
    });
  }

  async reverseRedemption(
    tx: Prisma.TransactionClient,
    subscriptionId: string,
  ) {
    const redemption = await tx.discountRedemption.findUnique({
      where: { subscriptionId },
    });

    if (!redemption) {
      return;
    }

    await tx.discountRedemption.delete({
      where: { id: redemption.id },
    });

    await tx.discountCode.update({
      where: { id: redemption.discountCodeId },
      data: { currentUses: { decrement: 1 } },
    });
  }
}
