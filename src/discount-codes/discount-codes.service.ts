import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDiscountCodeDto } from './dto/create-discount-code.dto';
import { UpdateDiscountCodeDto } from './dto/update-discount-code.dto';
import { DiscountType, Prisma } from '@prisma/client';

const PAYSTACK_MIN_KES = 50;

/**
 * Generic, state-agnostic failure message used by the unauthenticated-ish
 * probe endpoint (`POST /discount-codes/validate`). Prevents callers from
 * enumerating code existence, activity, expiry, remaining global uses, or
 * per-member cap via distinct error strings (M6).
 */
const GENERIC_VALIDATE_ERROR = 'This discount code cannot be applied';

@Injectable()
export class DiscountCodesService {
  private readonly logger = new Logger(DiscountCodesService.name);

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
    if (
      dto.discountType === DiscountType.PERCENTAGE &&
      dto.discountValue > 100
    ) {
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
      where = {
        isActive: true,
        startDate: { lte: now },
        endDate: { gte: now },
      };
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

    // discountType and discountValue are intentionally immutable after creation.
    // The UpdateDiscountCodeDto does not include these fields, and the global
    // ValidationPipe (whitelist: true) strips unknown properties, so they cannot
    // be changed via this endpoint.

    // Prevent setting maxUses below current redemption count
    if (
      dto.maxUses !== undefined &&
      dto.maxUses !== null &&
      existing.currentUses > dto.maxUses
    ) {
      throw new BadRequestException(
        `maxUses cannot be less than current redemption count (${existing.currentUses})`,
      );
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
      throw new BadRequestException('Discount code is invalid or unavailable');
    }

    // 2. Check active
    if (!discountCode.isActive) {
      throw new BadRequestException('Discount code is invalid or unavailable');
    }

    // 3. Check date window
    const now = new Date();
    if (now < discountCode.startDate || now > discountCode.endDate) {
      throw new BadRequestException('Discount code is invalid or unavailable');
    }

    // 4. Check global cap
    if (
      discountCode.maxUses !== null &&
      discountCode.currentUses >= discountCode.maxUses
    ) {
      throw new BadRequestException('Discount code is invalid or unavailable');
    }

    // 5. Check per-member cap using the "benefit" counter. The counter is
    // incremented for EVERY member of a subscription at redemption time
    // (including secondary duo members), so this naturally reflects
    // "has this person ever benefited from this code" across solo and
    // duo subscriptions.
    if (discountCode.maxUsesPerMember !== null) {
      const memberUses = await this.getMemberBenefitCount(
        this.prisma,
        discountCode.id,
        memberId,
      );
      if (memberUses >= discountCode.maxUsesPerMember) {
        throw new BadRequestException(
          'You have already used this discount code the maximum number of times',
        );
      }
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
        maxUsesPerMember: discountCode.maxUsesPerMember,
      },
      finalPrice,
      originalPrice: plan.price,
    };
  }

  /**
   * Probe-endpoint wrapper around {@link validateCode}. Collapses every failure
   * mode (unknown code, inactive, expired, not-yet-active, global cap hit,
   * per-member cap hit, plan restriction, sub-minimum final price, etc.) into
   * one generic message so an unauthenticated-ish caller cannot enumerate
   * state via distinct error strings (M6).
   *
   * The real reason is logged at `debug` level so admins can diagnose support
   * tickets from server logs. We intentionally do NOT report these to Sentry
   * — this is normal user-input failure, not an incident.
   *
   * The success path is unchanged: same shape as `validateCode` on happy path.
   *
   * NOTE: The authenticated checkout flow (subscription creation) still calls
   * {@link validateCode} directly and keeps its specific, actionable messages.
   * A member committed to purchase should see a real reason so they can fix
   * their input — the leak surface is only the standalone probe endpoint.
   */
  async validateCodeForProbe(code: string, planId: string, memberId: string) {
    try {
      return await this.validateCode(code, planId, memberId);
    } catch (err) {
      if (err instanceof HttpException) {
        // Log the actual reason so ops can diagnose support tickets.
        // Use `debug` so this doesn't spam info-level logs under normal use.
        const reason = err.message;
        this.logger.debug(
          `Discount code probe rejected: code="${code.toUpperCase()}" ` +
            `planId="${planId}" memberId="${memberId}" reason="${reason}"`,
        );
        throw new BadRequestException(GENERIC_VALIDATE_ERROR);
      }
      // Unexpected (non-HTTP) errors bubble up — these indicate bugs /
      // infra faults and should not be masked or logged as probe failures.
      throw err;
    }
  }

  /**
   * Returns how many times a member has "benefited" from a discount code — counting
   * BOTH their own redemptions AND redemptions on any subscription they are a member of
   * (primary or secondary duo member). Backed by `DiscountRedemptionCounter`, which is
   * incremented per-member on redemption.
   */
  private async getMemberBenefitCount(
    client: Prisma.TransactionClient | PrismaService,
    discountCodeId: string,
    memberId: string,
  ): Promise<number> {
    const counter = await client.discountRedemptionCounter.findUnique({
      where: { discountCodeId_memberId: { discountCodeId, memberId } },
      select: { uses: true },
    });
    return counter?.uses ?? 0;
  }

  async redeemCode(
    tx: Prisma.TransactionClient,
    discountCodeId: string,
    memberId: string,
    subscriptionId: string,
    originalAmount: number,
    discountedAmount: number,
    maxUses: number | null,
    maxUsesPerMember: number | null,
  ) {
    // Atomically claim per-member usage for every member on the subscription
    // (primary + any secondary duo members). For each member we:
    //   1. Ensure a counter row exists via createMany (idempotent, skipDuplicates).
    //   2. Conditionally increment via updateMany guarded by uses < maxUsesPerMember.
    // If the increment returns count=0, someone else already hit the cap for that
    // member and we abort. The enclosing $transaction guarantees rollback of any
    // earlier per-member increments in this call.
    const subscriptionMembers = await tx.subscriptionMember.findMany({
      where: { subscriptionId },
      select: { memberId: true },
    });

    // Include the caller's memberId defensively — at redemption time it is expected
    // to already be a SubscriptionMember, but we tolerate calls before the join row
    // has been created (e.g., race in the caller's tx ordering).
    const memberIds = new Set<string>(
      subscriptionMembers.map((m) => m.memberId),
    );
    memberIds.add(memberId);

    // Ensure counter rows exist — skipDuplicates avoids clobbering existing uses.
    await tx.discountRedemptionCounter.createMany({
      data: Array.from(memberIds).map((mid) => ({
        discountCodeId,
        memberId: mid,
        uses: 0,
      })),
      skipDuplicates: true,
    });

    for (const mid of memberIds) {
      // Conditional increment: if a per-member cap is set, guard on uses < cap.
      // Otherwise just bump uses so future caps reflect historical benefit.
      const where: Prisma.DiscountRedemptionCounterWhereInput = {
        discountCodeId,
        memberId: mid,
      };
      if (maxUsesPerMember !== null) {
        where.uses = { lt: maxUsesPerMember };
      }
      const result = await tx.discountRedemptionCounter.updateMany({
        where,
        data: { uses: { increment: 1 } },
      });
      if (result.count === 0 && maxUsesPerMember !== null) {
        throw new ConflictException(
          'You have already used this discount code the maximum number of times',
        );
      }
    }

    // Race-safe global cap conditional increment
    const whereClause: Prisma.DiscountCodeWhereInput = { id: discountCodeId };
    if (maxUses !== null) {
      whereClause.currentUses = { lt: maxUses };
    }

    const updated = await tx.discountCode.updateMany({
      where: whereClause,
      data: { currentUses: { increment: 1 } },
    });

    if (updated.count === 0) {
      throw new ConflictException('Discount code has reached its maximum uses');
    }

    // Create redemption record. The @@unique([discountCodeId, memberId, subscriptionId])
    // and subscriptionId @unique constraints prevent duplicate rows for the same
    // subscription even under a rare race that slips past the counter guard.
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

    // Look up who benefited (every SubscriptionMember on the subscription) so we can
    // decrement the matching counter rows. Fall back to the stored memberId if the
    // subscriptionMember rows were already deleted (e.g., by cleanup flows).
    const subscriptionMembers = await tx.subscriptionMember.findMany({
      where: { subscriptionId },
      select: { memberId: true },
    });
    const memberIds = new Set<string>(
      subscriptionMembers.map((m) => m.memberId),
    );
    memberIds.add(redemption.memberId);

    await tx.discountRedemption.delete({
      where: { id: redemption.id },
    });

    // Race-safe decrement per-member: only if uses > 0 to prevent going negative.
    for (const mid of memberIds) {
      await tx.discountRedemptionCounter.updateMany({
        where: {
          discountCodeId: redemption.discountCodeId,
          memberId: mid,
          uses: { gt: 0 },
        },
        data: { uses: { decrement: 1 } },
      });
    }

    // Race-safe global decrement: only if currentUses > 0 to prevent going negative
    await tx.discountCode.updateMany({
      where: { id: redemption.discountCodeId, currentUses: { gt: 0 } },
      data: { currentUses: { decrement: 1 } },
    });
  }
}
