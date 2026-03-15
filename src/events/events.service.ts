import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';

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
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

  async create(dto: CreateEventDto) {
    return this.prisma.event.create({
      data: {
        title: dto.title,
        description: dto.description,
        date: new Date(dto.date),
        startTime: dto.startTime,
        endTime: dto.endTime,
        location: dto.location,
        maxCapacity: dto.maxCapacity ?? 50,
      },
    });
  }

  async findAll(page: number = 1, limit: number = 20) {
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    const where = { isActive: true, date: { gte: now } };

    const [data, total] = await Promise.all([
      this.prisma.event.findMany({
        where,
        include: { _count: { select: { enrollments: true } } },
        orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.event.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const event = await this.prisma.event.findUnique({
      where: { id },
      include: {
        enrollments: {
          include: { member: { select: safeUserSelect } },
        },
      },
    });

    if (!event || !event.isActive) {
      throw new NotFoundException('Event not found');
    }

    return event;
  }

  async update(id: string, dto: UpdateEventDto) {
    const existing = await this.prisma.event.findUnique({
      where: { id },
      include: {
        enrollments: {
          include: { member: { select: { email: true, firstName: true } } },
        },
      },
    });

    if (!existing) {
      throw new NotFoundException('Event not found');
    }

    const updated = await this.prisma.event.update({
      where: { id },
      data: {
        title: dto.title,
        description: dto.description,
        date: dto.date ? new Date(dto.date) : undefined,
        startTime: dto.startTime,
        endTime: dto.endTime,
        location: dto.location,
        maxCapacity: dto.maxCapacity,
      },
    });

    const detailsChanged =
      (dto.date && new Date(dto.date).getTime() !== existing.date.getTime()) ||
      (dto.startTime && dto.startTime !== existing.startTime) ||
      (dto.endTime && dto.endTime !== existing.endTime) ||
      (dto.location !== undefined && dto.location !== existing.location);

    if (detailsChanged && existing.enrollments.length > 0) {
      this.notifyEventUpdate(existing, updated);
    }

    return updated;
  }

  async remove(id: string) {
    const existing = await this.prisma.event.findUnique({
      where: { id },
      include: {
        enrollments: {
          include: { member: { select: { email: true, firstName: true } } },
        },
      },
    });

    if (!existing) {
      throw new NotFoundException('Event not found');
    }

    const result = await this.prisma.event.update({
      where: { id },
      data: { isActive: false },
    });

    if (existing.enrollments.length > 0) {
      this.notifyCancellation(existing);
    }

    return result;
  }

  async enroll(eventId: string, memberId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: { _count: { select: { enrollments: true } } },
    });

    if (!event || !event.isActive) {
      throw new NotFoundException('Event not found or is inactive');
    }

    if (event.date < new Date(new Date().toISOString().split('T')[0])) {
      throw new BadRequestException('Cannot enroll in a past event');
    }

    if (event._count.enrollments >= event.maxCapacity) {
      throw new ConflictException('Event is full');
    }

    return this.prisma.eventEnrollment.create({
      data: { eventId, memberId },
    });
  }

  async unenroll(eventId: string, memberId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
    });

    if (!event) {
      throw new NotFoundException('Event not found');
    }

    if (event.date < new Date(new Date().toISOString().split('T')[0])) {
      throw new BadRequestException('Cannot unenroll from a past event');
    }

    await this.prisma.eventEnrollment.deleteMany({
      where: { eventId, memberId },
    });
  }

  async getEnrollments(eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
    });

    if (!event) {
      throw new NotFoundException('Event not found');
    }

    return this.prisma.eventEnrollment.findMany({
      where: { eventId },
      include: { member: { select: safeUserSelect } },
    });
  }

  async getMyEvents(memberId: string) {
    return this.prisma.eventEnrollment.findMany({
      where: {
        memberId,
        event: { isActive: true },
      },
      include: { event: true },
      orderBy: { event: { date: 'asc' } },
    });
  }

  private notifyEventUpdate(
    existing: {
      title: string;
      date: Date;
      startTime: string;
      endTime: string;
      location: string | null;
      enrollments: { member: { email: string; firstName: string } }[];
    },
    updated: {
      date: Date;
      startTime: string;
      endTime: string;
      location: string | null;
    },
  ) {
    for (const enrollment of existing.enrollments) {
      this.emailService
        .sendEmail(
          enrollment.member.email,
          `Event Updated: ${existing.title}`,
          'event-updated',
          {
            firstName: enrollment.member.firstName,
            eventTitle: existing.title,
            oldDate: existing.date.toISOString().split('T')[0],
            oldTime: `${existing.startTime} - ${existing.endTime}`,
            oldLocation: existing.location || 'TBD',
            newDate: updated.date.toISOString().split('T')[0],
            newTime: `${updated.startTime} - ${updated.endTime}`,
            newLocation: updated.location || 'TBD',
          },
        )
        .catch((err) =>
          this.logger.error(`Failed to send event update email: ${err.message}`),
        );
    }
  }

  private notifyCancellation(existing: {
    title: string;
    date: Date;
    startTime: string;
    endTime: string;
    location: string | null;
    enrollments: { member: { email: string; firstName: string } }[];
  }) {
    for (const enrollment of existing.enrollments) {
      this.emailService
        .sendEmail(
          enrollment.member.email,
          `Event Cancelled: ${existing.title}`,
          'event-cancelled',
          {
            firstName: enrollment.member.firstName,
            eventTitle: existing.title,
            date: existing.date.toISOString().split('T')[0],
            time: `${existing.startTime} - ${existing.endTime}`,
            location: existing.location || 'TBD',
          },
        )
        .catch((err) =>
          this.logger.error(`Failed to send event cancelled email: ${err.message}`),
        );
    }
  }
}
