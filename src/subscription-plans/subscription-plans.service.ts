import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePlanDto } from './dto/create-plan.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';
import { PlanSortBy } from './dto/plans-query.dto';
import { SortOrder } from '../common/dto/sort-query.dto';

@Injectable()
export class SubscriptionPlansService {
  constructor(private prisma: PrismaService) {}

  private buildOrderBy(
    sortBy: PlanSortBy = PlanSortBy.NAME,
    sortOrder: SortOrder = SortOrder.ASC,
  ): Prisma.SubscriptionPlanOrderByWithRelationInput {
    return { [sortBy]: sortOrder };
  }

  async create(dto: CreatePlanDto) {
    return this.prisma.subscriptionPlan.create({ data: dto });
  }

  async findAll(
    page: number = 1,
    limit: number = 20,
    sortBy?: PlanSortBy,
    sortOrder?: SortOrder,
  ) {
    const orderBy = this.buildOrderBy(sortBy, sortOrder);
    const [data, total] = await Promise.all([
      this.prisma.subscriptionPlan.findMany({
        skip: (page - 1) * limit,
        take: limit,
        orderBy,
      }),
      this.prisma.subscriptionPlan.count(),
    ]);
    return { data, total, page, limit };
  }

  async findActive(sortBy?: PlanSortBy, sortOrder?: SortOrder) {
    const orderBy = this.buildOrderBy(sortBy, sortOrder);
    return this.prisma.subscriptionPlan.findMany({
      where: { isActive: true },
      orderBy,
    });
  }

  async findOne(id: string) {
    const plan = await this.prisma.subscriptionPlan.findUnique({
      where: { id },
    });
    if (!plan) {
      throw new NotFoundException(`Subscription plan with id ${id} not found`);
    }
    return plan;
  }

  async update(id: string, dto: UpdatePlanDto) {
    await this.findOne(id);
    return this.prisma.subscriptionPlan.update({
      where: { id },
      data: dto,
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.subscriptionPlan.delete({ where: { id } });
  }
}
