import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { LicensingService } from '../licensing/licensing.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import {
  safeUserSelect,
  safeUserWithSubscriptionSelect,
} from '../common/constants/safe-user-select';

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private emailService: EmailService,
    private licensingService: LicensingService,
  ) {}

  async create(dto: CreateUserDto, callerRole: string) {
    // Role hierarchy enforcement
    if (dto.role === 'SUPER_ADMIN') {
      throw new ForbiddenException('Cannot create SUPER_ADMIN users');
    }
    if (dto.role === 'ADMIN' && callerRole !== 'SUPER_ADMIN') {
      throw new ForbiddenException('Only SUPER_ADMIN can create ADMIN users');
    }

    // Check email uniqueness
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing && !existing.deletedAt) {
      throw new ConflictException('Email already registered');
    }

    // License member limit check
    if (dto.role === 'MEMBER') {
      const maxMembers = await this.licensingService.getMemberLimit();
      if (maxMembers !== null) {
        const currentCount = await this.prisma.user.count({
          where: { role: 'MEMBER', deletedAt: null },
        });
        if (currentCount >= maxMembers) {
          throw new ForbiddenException(
            'Member limit reached for your subscription tier.',
          );
        }
      }
    }

    // Generate temp password
    const tempPassword = randomBytes(9).toString('base64url').slice(0, 12);
    const hashedPassword = await bcrypt.hash(tempPassword, 10);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        password: hashedPassword,
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: dto.phone,
        role: dto.role,
        gender: dto.gender,
        birthday: dto.birthday ? new Date(dto.birthday) : undefined,
        mustChangePassword: true,
      },
      select: safeUserSelect,
    });

    // Send welcome email (fire-and-forget)
    this.emailService
      .sendWelcomeEmail(dto.email, dto.firstName, tempPassword)
      .catch(() => {});

    return user;
  }

  async findAll(
    page: number = 1,
    limit: number = 20,
    role?: Role,
    search?: string,
  ) {
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
