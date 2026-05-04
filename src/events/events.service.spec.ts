import { Test, TestingModule } from '@nestjs/testing';
import { EventsService } from './events.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { Prisma, PrismaClient } from '@prisma/client';
import {
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';

describe('EventsService', () => {
  let service: EventsService;
  let prisma: DeepMockProxy<PrismaClient>;
  let emailService: DeepMockProxy<EmailService>;
  let notificationsService: DeepMockProxy<NotificationsService>;

  const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const futureDateStr = futureDate.toISOString().split('T')[0];
  const pastDate = new Date('2025-01-01');

  const mockEvent = {
    id: 'event-1',
    title: 'Outdoor Bootcamp',
    description: 'Community outdoor fitness event',
    date: futureDate,
    startTime: '09:00',
    endTime: '11:00',
    location: 'Uhuru Park',
    maxCapacity: 50,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockEnrollment = {
    id: 'enroll-1',
    eventId: 'event-1',
    memberId: 'member-1',
    enrolledAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventsService,
        { provide: PrismaService, useValue: mockDeep<PrismaClient>() },
        { provide: EmailService, useValue: mockDeep<EmailService>() },
        {
          provide: NotificationsService,
          useValue: mockDeep<NotificationsService>(),
        },
      ],
    }).compile();

    service = module.get<EventsService>(EventsService);
    prisma = module.get(PrismaService);
    emailService = module.get(EmailService);
    notificationsService = module.get(NotificationsService);
    notificationsService.create.mockResolvedValue(undefined as any);

    // Interactive transactions: call the callback with prisma mock
    prisma.$transaction.mockImplementation((cb: any) => cb(prisma));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create an event', async () => {
      prisma.event.create.mockResolvedValue(mockEvent as any);

      const result = await service.create({
        title: 'Outdoor Bootcamp',
        date: futureDateStr,
        startTime: '09:00',
        endTime: '11:00',
        location: 'Uhuru Park',
      });

      expect(result).toEqual(mockEvent);
      expect(prisma.event.create).toHaveBeenCalled();
    });

    it('should throw BadRequestException for past date', async () => {
      await expect(
        service.create({
          title: 'Past Event',
          date: '2020-01-01',
          startTime: '09:00',
          endTime: '11:00',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should notify all members when notifyMembers is true', async () => {
      prisma.event.create.mockResolvedValue(mockEvent as any);
      prisma.user.findMany.mockResolvedValue([
        { id: 'member-1' },
        { id: 'member-2' },
      ] as any);

      await service.create({
        title: 'Outdoor Bootcamp',
        date: futureDateStr,
        startTime: '09:00',
        endTime: '11:00',
        location: 'Uhuru Park',
        notifyMembers: true,
      });

      // Allow fire-and-forget async to flush
      await new Promise((resolve) => process.nextTick(resolve));

      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: {
          role: 'MEMBER',
          deletedAt: null,
          status: { not: 'SUSPENDED' },
        },
        select: { id: true },
      });
      expect(notificationsService.create).toHaveBeenCalledTimes(2);
      expect(notificationsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'member-1',
          title: 'New Event: Outdoor Bootcamp',
          type: 'EVENT_UPDATE',
        }),
      );
    });

    it('should not notify members when notifyMembers is false', async () => {
      prisma.event.create.mockResolvedValue(mockEvent as any);

      await service.create({
        title: 'Outdoor Bootcamp',
        date: futureDateStr,
        startTime: '09:00',
        endTime: '11:00',
        notifyMembers: false,
      });

      expect(prisma.user.findMany).not.toHaveBeenCalled();
      expect(notificationsService.create).not.toHaveBeenCalled();
    });

    it('should not block event creation if notification fails', async () => {
      prisma.event.create.mockResolvedValue(mockEvent as any);
      prisma.user.findMany.mockRejectedValue(new Error('DB connection lost'));

      const result = await service.create({
        title: 'Outdoor Bootcamp',
        date: futureDateStr,
        startTime: '09:00',
        endTime: '11:00',
        location: 'Uhuru Park',
        notifyMembers: true,
      });

      // Allow fire-and-forget async to flush
      await new Promise((resolve) => process.nextTick(resolve));

      expect(result).toEqual(mockEvent);
    });

    it('should handle individual notification failure gracefully', async () => {
      prisma.event.create.mockResolvedValue(mockEvent as any);
      prisma.user.findMany.mockResolvedValue([{ id: 'member-1' }] as any);
      notificationsService.create.mockRejectedValue(new Error('Push failed'));

      const result = await service.create({
        title: 'Outdoor Bootcamp',
        date: futureDateStr,
        startTime: '09:00',
        endTime: '11:00',
        location: 'Uhuru Park',
        notifyMembers: true,
      });

      await new Promise((resolve) => process.nextTick(resolve));

      expect(result).toEqual(mockEvent);
      expect(notificationsService.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('findAll', () => {
    it('should return paginated upcoming active events', async () => {
      prisma.event.findMany.mockResolvedValue([mockEvent] as any);
      prisma.event.count.mockResolvedValue(1);

      const result = await service.findAll(1, 20);

      expect(result).toEqual({
        data: [mockEvent],
        total: 1,
        page: 1,
        limit: 20,
      });
      expect(prisma.event.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isActive: true }),
        }),
      );
    });
  });

  describe('findOne', () => {
    it('should return an event with enrollment count (default)', async () => {
      prisma.event.findUnique.mockResolvedValue({
        ...mockEvent,
        _count: { enrollments: 5 },
      } as any);

      const result = await service.findOne('event-1');

      expect(result).toEqual(
        expect.objectContaining({ id: 'event-1', _count: { enrollments: 5 } }),
      );
      expect(prisma.event.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            _count: { select: { enrollments: true } },
          }),
        }),
      );
    });

    it('should include full enrollments when requested', async () => {
      const eventWithEnrollments = {
        ...mockEvent,
        _count: { enrollments: 1 },
        enrollments: [{ member: { id: 'member-1', email: 'a@b.com' } }],
      };
      prisma.event.findUnique.mockResolvedValue(eventWithEnrollments as any);

      const result = await service.findOne('event-1', true);

      expect(result).toEqual(eventWithEnrollments);
    });

    it('should throw NotFoundException when event not found', async () => {
      prisma.event.findUnique.mockResolvedValue(null);
      await expect(service.findOne('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException for inactive event', async () => {
      prisma.event.findUnique.mockResolvedValue({
        ...mockEvent,
        isActive: false,
      } as any);
      await expect(service.findOne('event-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('should update an event', async () => {
      const updated = { ...mockEvent, title: 'Indoor Bootcamp' };
      prisma.event.findUnique.mockResolvedValue({
        ...mockEvent,
        enrollments: [],
      } as any);
      prisma.event.update.mockResolvedValue(updated as any);

      const result = await service.update('event-1', {
        title: 'Indoor Bootcamp',
      });
      expect(result.title).toBe('Indoor Bootcamp');
    });

    it('should send emails when date/time/location changes', async () => {
      const updated = { ...mockEvent, startTime: '10:00', endTime: '12:00' };
      prisma.event.findUnique.mockResolvedValue({
        ...mockEvent,
        enrollments: [
          { member: { id: 'member-1', email: 'a@b.com', firstName: 'John' } },
        ],
      } as any);
      prisma.event.update.mockResolvedValue(updated as any);
      emailService.sendEmail.mockResolvedValue(undefined);

      await service.update('event-1', { startTime: '10:00', endTime: '12:00' });

      expect(emailService.sendEmail).toHaveBeenCalledWith(
        'a@b.com',
        expect.stringContaining('Event Updated'),
        'event-updated',
        expect.any(Object),
      );
    });

    it('should throw NotFoundException when event not found', async () => {
      prisma.event.findUnique.mockResolvedValue(null);
      await expect(service.update('missing', { title: 'X' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException for inactive event', async () => {
      prisma.event.findUnique.mockResolvedValue({
        ...mockEvent,
        isActive: false,
        enrollments: [],
      } as any);
      await expect(service.update('event-1', { title: 'X' })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('remove (soft delete)', () => {
    it('should soft-delete and notify enrolled members', async () => {
      prisma.event.findUnique.mockResolvedValue({
        ...mockEvent,
        enrollments: [
          { member: { id: 'member-1', email: 'a@b.com', firstName: 'John' } },
        ],
      } as any);
      prisma.event.update.mockResolvedValue({
        ...mockEvent,
        isActive: false,
      } as any);
      emailService.sendEmail.mockResolvedValue(undefined);

      const result = await service.remove('event-1');

      expect(result.isActive).toBe(false);
      expect(emailService.sendEmail).toHaveBeenCalledWith(
        'a@b.com',
        expect.stringContaining('Event Cancelled'),
        'event-cancelled',
        expect.any(Object),
      );
    });

    it('should throw NotFoundException when event not found', async () => {
      prisma.event.findUnique.mockResolvedValue(null);
      await expect(service.remove('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException for already-cancelled event', async () => {
      prisma.event.findUnique.mockResolvedValue({
        ...mockEvent,
        isActive: false,
        enrollments: [],
      } as any);
      await expect(service.remove('event-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('enroll', () => {
    it('should enroll a member in an event within a transaction', async () => {
      prisma.$queryRaw.mockResolvedValue([
        {
          id: mockEvent.id,
          date: mockEvent.date,
          maxCapacity: mockEvent.maxCapacity,
          isActive: true,
        },
      ] as any);
      prisma.eventEnrollment.count.mockResolvedValue(5);
      prisma.eventEnrollment.create.mockResolvedValue(mockEnrollment as any);

      const result = await service.enroll('event-1', 'member-1');

      expect(result).toEqual(mockEnrollment);
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('should throw NotFoundException for inactive event', async () => {
      prisma.$queryRaw.mockResolvedValue([
        {
          id: mockEvent.id,
          date: mockEvent.date,
          maxCapacity: mockEvent.maxCapacity,
          isActive: false,
        },
      ] as any);

      await expect(service.enroll('event-1', 'member-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException when event not found', async () => {
      prisma.$queryRaw.mockResolvedValue([] as any);

      await expect(service.enroll('event-1', 'member-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ConflictException when event is at capacity', async () => {
      prisma.$queryRaw.mockResolvedValue([
        {
          id: mockEvent.id,
          date: mockEvent.date,
          maxCapacity: 50,
          isActive: true,
        },
      ] as any);
      prisma.eventEnrollment.count.mockResolvedValue(50);

      await expect(service.enroll('event-1', 'member-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('should throw BadRequestException for past event', async () => {
      prisma.$queryRaw.mockResolvedValue([
        {
          id: mockEvent.id,
          date: pastDate,
          maxCapacity: 50,
          isActive: true,
        },
      ] as any);

      await expect(service.enroll('event-1', 'member-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw ConflictException for duplicate enrollment', async () => {
      prisma.$queryRaw.mockResolvedValue([
        {
          id: mockEvent.id,
          date: mockEvent.date,
          maxCapacity: 50,
          isActive: true,
        },
      ] as any);
      prisma.eventEnrollment.count.mockResolvedValue(5);
      prisma.eventEnrollment.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '6.0.0',
        }),
      );

      await expect(service.enroll('event-1', 'member-1')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('unenroll', () => {
    it('should remove enrollment', async () => {
      prisma.event.findUnique.mockResolvedValue(mockEvent as any);
      prisma.eventEnrollment.deleteMany.mockResolvedValue({ count: 1 });

      await service.unenroll('event-1', 'member-1');

      expect(prisma.eventEnrollment.deleteMany).toHaveBeenCalledWith({
        where: { eventId: 'event-1', memberId: 'member-1' },
      });
    });

    it('should throw NotFoundException when event not found', async () => {
      prisma.event.findUnique.mockResolvedValue(null);
      await expect(service.unenroll('event-1', 'member-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException for inactive event', async () => {
      prisma.event.findUnique.mockResolvedValue({
        ...mockEvent,
        isActive: false,
      } as any);
      await expect(service.unenroll('event-1', 'member-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException for past event', async () => {
      prisma.event.findUnique.mockResolvedValue({
        ...mockEvent,
        date: pastDate,
      } as any);

      await expect(service.unenroll('event-1', 'member-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw NotFoundException when not enrolled', async () => {
      prisma.event.findUnique.mockResolvedValue(mockEvent as any);
      prisma.eventEnrollment.deleteMany.mockResolvedValue({ count: 0 });

      await expect(service.unenroll('event-1', 'member-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getEnrollments', () => {
    it('should return enrollments for an event', async () => {
      prisma.event.findUnique.mockResolvedValue(mockEvent as any);
      prisma.eventEnrollment.findMany.mockResolvedValue([
        mockEnrollment,
      ] as any);

      const result = await service.getEnrollments('event-1');
      expect(result).toEqual([mockEnrollment]);
    });

    it('should throw NotFoundException when event not found', async () => {
      prisma.event.findUnique.mockResolvedValue(null);
      await expect(service.getEnrollments('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getMyEvents', () => {
    it('should return paginated events a member is enrolled in', async () => {
      prisma.eventEnrollment.findMany.mockResolvedValue([
        { ...mockEnrollment, event: mockEvent },
      ] as any);
      prisma.eventEnrollment.count.mockResolvedValue(1);

      const result = await service.getMyEvents('member-1', 1, 20);

      expect(result).toEqual({
        data: [{ ...mockEnrollment, event: mockEvent }],
        total: 1,
        page: 1,
        limit: 20,
      });
      expect(prisma.eventEnrollment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
          take: 20,
        }),
      );
    });

    it('should respect page and limit params', async () => {
      prisma.eventEnrollment.findMany.mockResolvedValue([] as any);
      prisma.eventEnrollment.count.mockResolvedValue(0);

      const result = await service.getMyEvents('member-1', 2, 10);

      expect(result).toEqual({ data: [], total: 0, page: 2, limit: 10 });
      expect(prisma.eventEnrollment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 10,
          take: 10,
        }),
      );
    });
  });
});
