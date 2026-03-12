import { Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateUserDto } from './dto/update-user.dto';
import {
  safeUserSelect,
  safeUserWithSubscriptionSelect,
} from '../common/constants/safe-user-select';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async findAll(page: number = 1, limit: number = 20, role?: Role, search?: string) {
    const where = {
      deletedAt: null,
      ...(role ? { role } : {}),
      ...(search
        ? {
            OR: [
              { firstName: { contains: search, mode: 'insensitive' as const } },
              { lastName: { contains: search, mode: 'insensitive' as const } },
              { email: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: safeUserWithSubscriptionSelect,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.count({ where }),
    ]);
    const data = users.map((user) => this.flattenSubscription(user));
    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: safeUserWithSubscriptionSelect,
    });
    if (!user || user.deletedAt) {
      throw new NotFoundException(`User with id ${id} not found`);
    }
    return this.flattenSubscription(user);
  }

  async update(id: string, dto: UpdateUserDto) {
    await this.findOne(id);
    return this.prisma.user.update({
      where: { id },
      data: {
        ...dto,
        birthday: dto.birthday ? new Date(dto.birthday) : undefined,
      },
      select: safeUserSelect,
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.user.update({
      where: { id },
      data: { deletedAt: new Date() },
      select: safeUserSelect,
    });
  }

  private flattenSubscription(
    user: Record<string, unknown> & {
      subscriptionMembers?: { subscription: Record<string, unknown> }[];
      attendances?: { checkInDate: Date }[];
    },
  ) {
    const { subscriptionMembers, attendances, ...rest } = user;
    const active = subscriptionMembers?.[0]?.subscription ?? null;
    const lastAttendance = attendances?.[0]?.checkInDate ?? null;
    return { ...rest, subscription: active, lastAttendance };
  }
}
