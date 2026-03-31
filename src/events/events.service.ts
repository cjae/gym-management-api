import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { NotificationType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { NotificationsService } from '../notifications/notifications.service';
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
    private readonly notificationsService: NotificationsService,
  ) {}

  async create(dto: CreateEventDto) {
    const eventDate = new Date(dto.date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (eventDate < today) {
      throw new BadRequestException('Cannot create an event in the past');
    }

    const event = await this.prisma.event.create({
      data: {
        title: dto.title,
        description: dto.description,
        date: eventDate,
        startTime: dto.startTime,
        endTime: dto.endTime,
        location: dto.location,
        maxCapacity: dto.maxCapacity ?? 50,
      },
    });

    if (dto.notifyMembers) {
      this.notifyNewEvent(event);
    }

    return event;
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

  async findOne(id: string, includeEnrollments: boolean = false) {
    const event = await this.prisma.event.findUnique({
      where: { id },
      include: {
        _count: { select: { enrollments: true } },
        ...(includeEnrollments && {
          enrollments: {
            include: { member: { select: safeUserSelect } },
          },
        }),
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
          include: {
            member: { select: { id: true, email: true, firstName: true } },
          },
        },
      },
    });

    if (!existing || !existing.isActive) {
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
          include: {
            member: { select: { id: true, email: true, firstName: true } },
          },
        },
      },
    });

    if (!existing || !existing.isActive) {
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
    return this.prisma.$transaction(async (tx) => {
      // Lock the event row to prevent concurrent over-enrollment
      const events = await tx.$queryRaw<
        {
          id: string;
          date: Date;
          maxCapacity: number;
          isActive: boolean;
        }[]
      >`SELECT id, date, "maxCapacity", "isActive" FROM "Event" WHERE id = ${eventId} FOR UPDATE`;

      const event = events[0];

      if (!event || !event.isActive) {
        throw new NotFoundException('Event not found or is inactive');
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (event.date < today) {
        throw new BadRequestException('Cannot enroll in a past event');
      }

      const enrollmentCount = await tx.eventEnrollment.count({
        where: { eventId },
      });

      if (enrollmentCount >= event.maxCapacity) {
        throw new ConflictException('Event is full');
      }

      try {
        return await tx.eventEnrollment.create({
          data: { eventId, memberId },
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          throw new ConflictException('Already enrolled in this event');
        }
        throw error;
      }
    });
  }

  async unenroll(eventId: string, memberId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
    });

    if (!event || !event.isActive) {
      throw new NotFoundException('Event not found');
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (event.date < today) {
      throw new BadRequestException('Cannot unenroll from a past event');
    }

    const result = await this.prisma.eventEnrollment.deleteMany({
      where: { eventId, memberId },
    });

    if (result.count === 0) {
      throw new NotFoundException('Not enrolled in this event');
    }
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

  async getMyEvents(memberId: string, page: number = 1, limit: number = 20) {
    const where = {
      memberId,
      event: { isActive: true },
    };

    const [data, total] = await Promise.all([
      this.prisma.eventEnrollment.findMany({
        where,
        include: {
          event: { include: { _count: { select: { enrollments: true } } } },
        },
        orderBy: { event: { date: 'asc' } },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.eventEnrollment.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  private notifyEventUpdate(
    existing: {
      title: string;
      date: Date;
      startTime: string;
      endTime: string;
      location: string | null;
      enrollments: {
        member: { id: string; email: string; firstName: string };
      }[];
    },
    updated: {
      date: Date;
      startTime: string;
      endTime: string;
      location: string | null;
    },
  ) {
    const newDate = updated.date.toISOString().split('T')[0];
    const newTime = `${updated.startTime} - ${updated.endTime}`;

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
            newDate,
            newTime,
            newLocation: updated.location || 'TBD',
          },
        )
        .catch((err) =>
          this.logger.error(
            `Failed to send event update email: ${err.message}`,
          ),
        );

      this.notificationsService
        .create({
          userId: enrollment.member.id,
          title: `Event Updated: ${existing.title}`,
          body: `Moved to ${newDate} ${newTime}`,
          type: NotificationType.EVENT_UPDATE,
        })
        .catch((err) =>
          this.logger.error(
            `Failed to create event update notification: ${err.message}`,
          ),
        );
    }
  }

  private notifyCancellation(existing: {
    title: string;
    date: Date;
    startTime: string;
    endTime: string;
    location: string | null;
    enrollments: {
      member: { id: string; email: string; firstName: string };
    }[];
  }) {
    const date = existing.date.toISOString().split('T')[0];
    const time = `${existing.startTime} - ${existing.endTime}`;

    for (const enrollment of existing.enrollments) {
      this.emailService
        .sendEmail(
          enrollment.member.email,
          `Event Cancelled: ${existing.title}`,
          'event-cancelled',
          {
            firstName: enrollment.member.firstName,
            eventTitle: existing.title,
            date,
            time,
            location: existing.location || 'TBD',
          },
        )
        .catch((err) =>
          this.logger.error(
            `Failed to send event cancelled email: ${err.message}`,
          ),
        );

      this.notificationsService
        .create({
          userId: enrollment.member.id,
          title: `Event Cancelled: ${existing.title}`,
          body: `${date} ${time} event has been cancelled`,
          type: NotificationType.EVENT_UPDATE,
        })
        .catch((err) =>
          this.logger.error(
            `Failed to create event cancelled notification: ${err.message}`,
          ),
        );
    }
  }

  private async notifyNewEvent(event: {
    id: string;
    title: string;
    date: Date;
    startTime: string;
    location: string | null;
  }) {
    try {
      const members = await this.prisma.user.findMany({
        where: { role: 'MEMBER', deletedAt: null },
        select: { id: true },
      });

      const date = event.date.toISOString().split('T')[0];

      for (const member of members) {
        this.notificationsService
          .create({
            userId: member.id,
            title: `New Event: ${event.title}`,
            body: `${date} at ${event.startTime} — ${event.location || 'TBD'}`,
            type: NotificationType.EVENT_UPDATE,
            metadata: { eventId: event.id },
          })
          .catch((err) =>
            this.logger.error(
              `Failed to create new event notification: ${err.message}`,
            ),
          );
      }
    } catch (err) {
      this.logger.error(
        `Failed to notify members of new event: ${err.message}`,
      );
    }
  }
}
