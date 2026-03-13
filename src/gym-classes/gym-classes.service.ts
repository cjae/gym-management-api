import {
  Injectable,
  ConflictException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { CreateGymClassDto } from './dto/create-gym-class.dto';
import { UpdateGymClassDto } from './dto/update-gym-class.dto';

const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

const safeUserSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  role: true,
  status: true,
};

@Injectable()
export class GymClassesService {
  private readonly logger = new Logger(GymClassesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

  async create(dto: CreateGymClassDto) {
    await this.checkTimeOverlap(dto.dayOfWeek, dto.startTime, dto.endTime);

    return this.prisma.gymClass.create({
      data: {
        title: dto.title,
        description: dto.description,
        dayOfWeek: dto.dayOfWeek,
        startTime: dto.startTime,
        endTime: dto.endTime,
        maxCapacity: dto.maxCapacity ?? 20,
        trainerId: dto.trainerId,
      },
      include: {
        trainer: { include: { user: { select: safeUserSelect } } },
      },
    });
  }

  async findAll(page: number = 1, limit: number = 20) {
    const [data, total] = await Promise.all([
      this.prisma.gymClass.findMany({
        where: { isActive: true },
        include: {
          trainer: { include: { user: { select: safeUserSelect } } },
          _count: { select: { enrollments: true } },
        },
        orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.gymClass.count({ where: { isActive: true } }),
    ]);

    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const gymClass = await this.prisma.gymClass.findUnique({
      where: { id },
      include: {
        trainer: { include: { user: { select: safeUserSelect } } },
        enrollments: {
          include: { member: { select: safeUserSelect } },
        },
      },
    });

    if (!gymClass || !gymClass.isActive) {
      throw new NotFoundException('Class not found');
    }

    return gymClass;
  }

  async update(id: string, dto: UpdateGymClassDto) {
    const existing = await this.prisma.gymClass.findUnique({
      where: { id },
      include: {
        enrollments: {
          include: { member: { select: { email: true, firstName: true } } },
        },
      },
    });

    if (!existing) {
      throw new NotFoundException('Class not found');
    }

    const dayOfWeek = dto.dayOfWeek ?? existing.dayOfWeek;
    const startTime = dto.startTime ?? existing.startTime;
    const endTime = dto.endTime ?? existing.endTime;

    if (
      dto.dayOfWeek !== undefined ||
      dto.startTime !== undefined ||
      dto.endTime !== undefined
    ) {
      await this.checkTimeOverlap(dayOfWeek, startTime, endTime, id);
    }

    const updated = await this.prisma.gymClass.update({
      where: { id },
      data: {
        title: dto.title,
        description: dto.description,
        dayOfWeek: dto.dayOfWeek,
        startTime: dto.startTime,
        endTime: dto.endTime,
        maxCapacity: dto.maxCapacity,
        trainerId: dto.trainerId,
      },
      include: {
        trainer: { include: { user: { select: safeUserSelect } } },
      },
    });

    const timeChanged =
      existing.dayOfWeek !== updated.dayOfWeek ||
      existing.startTime !== updated.startTime ||
      existing.endTime !== updated.endTime;

    if (timeChanged && existing.enrollments.length > 0) {
      this.notifyTimeChange(existing, updated);
    }

    return updated;
  }

  async remove(id: string) {
    const existing = await this.prisma.gymClass.findUnique({
      where: { id },
      include: {
        enrollments: {
          include: { member: { select: { email: true, firstName: true } } },
        },
      },
    });

    if (!existing) {
      throw new NotFoundException('Class not found');
    }

    const result = await this.prisma.gymClass.update({
      where: { id },
      data: { isActive: false },
    });

    if (existing.enrollments.length > 0) {
      this.notifyCancellation(existing);
    }

    return result;
  }

  async enroll(classId: string, memberId: string) {
    const gymClass = await this.prisma.gymClass.findUnique({
      where: { id: classId },
      include: { _count: { select: { enrollments: true } } },
    });

    if (!gymClass || !gymClass.isActive) {
      throw new NotFoundException('Class not found or is inactive');
    }

    if (gymClass._count.enrollments >= gymClass.maxCapacity) {
      throw new ConflictException('Class is full');
    }

    return this.prisma.classEnrollment.create({
      data: { classId, memberId },
    });
  }

  async unenroll(classId: string, memberId: string) {
    const gymClass = await this.prisma.gymClass.findUnique({
      where: { id: classId },
    });

    if (!gymClass) {
      throw new NotFoundException('Class not found');
    }

    await this.prisma.classEnrollment.deleteMany({
      where: { classId, memberId },
    });
  }

  async getEnrollments(classId: string) {
    const gymClass = await this.prisma.gymClass.findUnique({
      where: { id: classId },
    });

    if (!gymClass) {
      throw new NotFoundException('Class not found');
    }

    return this.prisma.classEnrollment.findMany({
      where: { classId },
      include: { member: { select: safeUserSelect } },
    });
  }

  async getMyClasses(memberId: string) {
    return this.prisma.classEnrollment.findMany({
      where: {
        memberId,
        gymClass: { isActive: true },
      },
      include: {
        gymClass: {
          include: {
            trainer: { include: { user: { select: safeUserSelect } } },
          },
        },
      },
      orderBy: { gymClass: { dayOfWeek: 'asc' } },
    });
  }

  private async checkTimeOverlap(
    dayOfWeek: number,
    startTime: string,
    endTime: string,
    excludeId?: string,
  ) {
    const overlap = await this.prisma.gymClass.findFirst({
      where: {
        dayOfWeek,
        isActive: true,
        startTime: { lt: endTime },
        endTime: { gt: startTime },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });

    if (overlap) {
      throw new ConflictException(
        `Time overlaps with existing class "${overlap.title}" (${overlap.startTime}-${overlap.endTime})`,
      );
    }
  }

  private notifyTimeChange(
    existing: {
      title: string;
      dayOfWeek: number;
      startTime: string;
      endTime: string;
      enrollments: { member: { email: string; firstName: string } }[];
    },
    updated: { dayOfWeek: number; startTime: string; endTime: string },
  ) {
    for (const enrollment of existing.enrollments) {
      this.emailService
        .sendEmail(
          enrollment.member.email,
          `Class Schedule Updated: ${existing.title}`,
          'class-updated',
          {
            firstName: enrollment.member.firstName,
            classTitle: existing.title,
            oldDay: DAY_NAMES[existing.dayOfWeek],
            oldTime: `${existing.startTime} - ${existing.endTime}`,
            newDay: DAY_NAMES[updated.dayOfWeek],
            newTime: `${updated.startTime} - ${updated.endTime}`,
          },
        )
        .catch((err) =>
          this.logger.error(
            `Failed to send class update email: ${err.message}`,
          ),
        );
    }
  }

  private notifyCancellation(existing: {
    title: string;
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    enrollments: { member: { email: string; firstName: string } }[];
  }) {
    for (const enrollment of existing.enrollments) {
      this.emailService
        .sendEmail(
          enrollment.member.email,
          `Class Cancelled: ${existing.title}`,
          'class-cancelled',
          {
            firstName: enrollment.member.firstName,
            classTitle: existing.title,
            day: DAY_NAMES[existing.dayOfWeek],
            time: `${existing.startTime} - ${existing.endTime}`,
          },
        )
        .catch((err) =>
          this.logger.error(
            `Failed to send class cancelled email: ${err.message}`,
          ),
        );
    }
  }
}
