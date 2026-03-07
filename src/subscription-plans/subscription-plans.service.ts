import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePlanDto } from './dto/create-plan.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';

@Injectable()
export class SubscriptionPlansService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreatePlanDto) {
    return this.prisma.subscriptionPlan.create({ data: dto });
  }

  async findAll(page: number = 1, limit: number = 20) {
    const [data, total] = await Promise.all([
      this.prisma.subscriptionPlan.findMany({
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.subscriptionPlan.count(),
    ]);
    return { data, total, page, limit };
  }

  async findActive() {
    return this.prisma.subscriptionPlan.findMany({
      where: { isActive: true },
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
