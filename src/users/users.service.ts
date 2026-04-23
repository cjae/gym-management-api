import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { DeletionRequestStatus, PrismaClient, Role } from '@prisma/client';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { LicensingService } from '../licensing/licensing.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import {
  safeUserSelect,
  safeUserDetailSelect,
  safeUserWithSubscriptionSelect,
} from '../common/constants/safe-user-select';
import { generateReferralCode } from '../common/utils/referral-code.util';

// Prisma transaction client type (subset of PrismaClient available inside $transaction).
type TxClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private emailService: EmailService,
    private licensingService: LicensingService,
  ) {}

  /**
   * Scrub PII from a User row as part of soft-delete. Runs inside the caller's
   * transaction so scrub + `deletedAt` stamp + audit log land atomically.
   *
   * Fields are handled in three buckets:
   *  - NULLED (nullable columns / scalar arrays): phone, displayPicture,
   *    birthday, gender, referralCode, onboarding profile fields,
   *    preferredTrainingDays.
   *  - SCRUBBED (non-null columns, replaced with sentinels that satisfy
   *    @unique / validation): email → `deleted-<id>@deleted.local`,
   *    firstName → 'Deleted', lastName → 'User', password → unusable
   *    60-char random sentinel (not a valid bcrypt hash so credentials
   *    are permanently invalidated).
   *  - DELETED (1:N relations holding auth material): PushToken rows.
   *
   * Kept intentionally: id (FK stability for Payment / AuditLog / Attendance
   * / Referral history), role, status, createdAt, tosAcceptedAt,
   * waiverAcceptedAt (evidence of consent), referredById (other users'
   * referral-history integrity).
   */
  private async scrubUserPii(tx: TxClient, userId: string) {
    // Invalidate auth: 60 random hex chars — not a valid bcrypt hash, cannot
    // match any password via bcrypt.compare.
    const unusablePassword = randomBytes(30).toString('hex');

    await tx.pushToken.deleteMany({ where: { userId } });

    await tx.user.update({
      where: { id: userId },
      data: {
        deletedAt: new Date(),
        // Identity scrub (non-null columns → sentinels)
        email: `deleted-${userId}@deleted.local`,
        firstName: 'Deleted',
        lastName: 'User',
        password: unusablePassword,
        // Nulled PII
        phone: null,
        displayPicture: null,
        birthday: null,
        gender: null,
        referralCode: null,
        // Onboarding profile
        onboardingCompletedAt: null,
        experienceLevel: null,
        bodyweightKg: null,
        heightCm: null,
        sessionMinutes: null,
        preferredTrainingDays: [],
        sleepHoursAvg: null,
        primaryMotivation: null,
        injuryNotes: null,
      },
    });
  }

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

    // License admin limit check
    if (dto.role === 'ADMIN') {
      const maxAdmins = await this.licensingService.getAdminLimit();
      if (maxAdmins !== null) {
        const currentCount = await this.prisma.user.count({
          where: {
            role: { in: ['ADMIN', 'SUPER_ADMIN'] },
            deletedAt: null,
          },
        });
        if (currentCount >= maxAdmins) {
          throw new ForbiddenException(
            'Admin limit reached for your subscription tier.',
          );
        }
      }
    }

    // Generate temp password
    const tempPassword = randomBytes(9).toString('base64url').slice(0, 12);
    const hashedPassword = await bcrypt.hash(tempPassword, 10);

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
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
            referralCode: generateReferralCode(),
          },
          select: safeUserSelect,
        });

        // Send welcome email (fire-and-forget)
        this.emailService
          .sendWelcomeEmail(dto.email, dto.firstName, tempPassword)
          .catch(() => {});

        return user;
      } catch (error: unknown) {
        if (
          error instanceof Object &&
          'code' in error &&
          error.code === 'P2002'
        ) {
          if (
            'meta' in error &&
            error.meta instanceof Object &&
            'target' in error.meta &&
            Array.isArray(error.meta.target) &&
            error.meta.target.includes('referralCode')
          ) {
            if (attempt === 2) throw error;
            continue;
          }
          throw new ConflictException('Email already registered');
        }
        throw error;
      }
    }

    throw new InternalServerErrorException('Failed to create user');
  }

  async findAll(
    page: number = 1,
    limit: number = 20,
    role?: Role[],
    search?: string,
    tags?: string,
  ) {
    const tagNames = tags
      ? tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
          .slice(0, 10)
      : [];
    const where = {
      deletedAt: null,
      ...(role?.length ? { role: { in: role } } : {}),
      ...(search
        ? {
            OR: [
              { firstName: { contains: search, mode: 'insensitive' as const } },
              { lastName: { contains: search, mode: 'insensitive' as const } },
              { email: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
      ...(tagNames.length
        ? {
            AND: tagNames.map((name) => ({
              memberTags: { some: { tag: { name } } },
            })),
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

  async findProfile(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id, deletedAt: null },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        role: true,
        displayPicture: true,
      },
    });
    if (!user) {
      throw new NotFoundException(`User with id ${id} not found`);
    }
    return user;
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: safeUserDetailSelect,
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
    // Soft-delete + PII scrub in a single transaction so we never leave a
    // half-scrubbed row on the DB. See scrubUserPii() for the field-level
    // contract (null / sentinel / delete).
    await this.prisma.$transaction(async (tx) => {
      await this.scrubUserPii(tx as unknown as TxClient, id);
    });
    return this.prisma.user.findUnique({
      where: { id },
      select: safeUserSelect,
    });
  }

  async findBirthdays() {
    const today = new Date();
    const month = today.getMonth() + 1;
    const day = today.getDate();

    const users = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        birthday: { not: null },
      },
      select: safeUserSelect,
    });

    return users.filter((u) => {
      const bday = u.birthday as Date;
      return bday.getMonth() + 1 === month && bday.getDate() === day;
    });
  }

  async findAllDeletionRequests(
    page: number = 1,
    limit: number = 20,
    status?: DeletionRequestStatus,
  ) {
    const where = status ? { status } : {};
    const [data, total] = await Promise.all([
      this.prisma.accountDeletionRequest.findMany({
        where,
        include: {
          user: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
        },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.accountDeletionRequest.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async approveDeletionRequest(requestId: string, reviewerId: string) {
    const request = await this.prisma.accountDeletionRequest.findUnique({
      where: { id: requestId },
    });
    if (!request) {
      throw new NotFoundException('Deletion request not found');
    }

    await this.prisma.$transaction(async (tx) => {
      // Atomic claim — only one concurrent approver / member-canceller can win.
      // If count === 0 the request is no longer PENDING (already approved /
      // rejected / cancelled by another actor), so we abort before touching
      // the user row. This keeps the soft-delete idempotent at the claim level.
      const result = await tx.accountDeletionRequest.updateMany({
        where: { id: requestId, status: 'PENDING' },
        data: {
          status: 'APPROVED',
          reviewedById: reviewerId,
          reviewedAt: new Date(),
        },
      });
      if (result.count !== 1) {
        throw new BadRequestException('Request is no longer pending');
      }
      await this.scrubUserPii(tx as unknown as TxClient, request.userId);
    });

    return {
      message: 'Deletion request approved. User account has been deleted.',
    };
  }

  async rejectDeletionRequest(
    requestId: string,
    reviewerId: string,
    rejectionReason?: string,
  ) {
    const request = await this.prisma.accountDeletionRequest.findUnique({
      where: { id: requestId },
    });
    if (!request) {
      throw new NotFoundException('Deletion request not found');
    }

    const result = await this.prisma.accountDeletionRequest.updateMany({
      where: { id: requestId, status: 'PENDING' },
      data: {
        status: 'REJECTED',
        rejectionReason,
        reviewedById: reviewerId,
        reviewedAt: new Date(),
      },
    });
    if (result.count !== 1) {
      throw new BadRequestException('Request is no longer pending');
    }

    return { message: 'Deletion request rejected.' };
  }

  private flattenSubscription(
    user: Record<string, unknown> & {
      subscriptionMembers?: { subscription: Record<string, unknown> }[];
      attendances?: { checkInDate: Date }[];
      memberTags?: {
        tag: { name: string; source: string; color: string | null };
      }[];
    },
  ) {
    const { subscriptionMembers, attendances, memberTags, ...rest } = user;
    const active = subscriptionMembers?.[0]?.subscription ?? null;
    const lastAttendance = attendances?.[0]?.checkInDate ?? null;
    const tags = memberTags?.map((mt) => mt.tag) ?? [];
    return { ...rest, subscription: active, lastAttendance, tags };
  }
}
