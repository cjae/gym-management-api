import { Test, TestingModule } from '@nestjs/testing';
import { EventsService } from './events.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
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

  const futureDate = new Date('2026-05-01');
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
      ],
    }).compile();

    service = module.get<EventsService>(EventsService);
    prisma = module.get(PrismaService);
    emailService = module.get(EmailService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create an event', async () => {
      prisma.event.create.mockResolvedValue(mockEvent as any);

      const result = await service.create({
        title: 'Outdoor Bootcamp',
        date: '2026-05-01',
        startTime: '09:00',
        endTime: '11:00',
        location: 'Uhuru Park',
      });

      expect(result).toEqual(mockEvent);
      expect(prisma.event.create).toHaveBeenCalled();
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
    it('should return an event by id', async () => {
      prisma.event.findUnique.mockResolvedValue(mockEvent as any);
      const result = await service.findOne('event-1');
      expect(result).toEqual(mockEvent);
    });

    it('should throw NotFoundException when event not found', async () => {
      prisma.event.findUnique.mockResolvedValue(null);
      await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException for inactive event', async () => {
      prisma.event.findUnique.mockResolvedValue({
        ...mockEvent,
        isActive: false,
      } as any);
      await expect(service.findOne('event-1')).rejects.toThrow(NotFoundException);
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

      const result = await service.update('event-1', { title: 'Indoor Bootcamp' });
      expect(result.title).toBe('Indoor Bootcamp');
    });

    it('should send emails when date/time/location changes', async () => {
      const updated = { ...mockEvent, startTime: '10:00', endTime: '12:00' };
      prisma.event.findUnique.mockResolvedValue({
        ...mockEvent,
        enrollments: [{ member: { email: 'a@b.com', firstName: 'John' } }],
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
  });

  describe('remove (soft delete)', () => {
    it('should soft-delete and notify enrolled members', async () => {
      prisma.event.findUnique.mockResolvedValue({
        ...mockEvent,
        enrollments: [{ member: { email: 'a@b.com', firstName: 'John' } }],
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
      await expect(service.remove('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('enroll', () => {
    it('should enroll a member in an event', async () => {
      prisma.event.findUnique.mockResolvedValue({
        ...mockEvent,
        _count: { enrollments: 5 },
      } as any);
      prisma.eventEnrollment.create.mockResolvedValue(mockEnrollment as any);

      const result = await service.enroll('event-1', 'member-1');
      expect(result).toEqual(mockEnrollment);
    });

    it('should throw NotFoundException for inactive event', async () => {
      prisma.event.findUnique.mockResolvedValue({
        ...mockEvent,
        isActive: false,
        _count: { enrollments: 0 },
      } as any);

      await expect(service.enroll('event-1', 'member-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ConflictException when event is at capacity', async () => {
      prisma.event.findUnique.mockResolvedValue({
        ...mockEvent,
        maxCapacity: 50,
        _count: { enrollments: 50 },
      } as any);

      await expect(service.enroll('event-1', 'member-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('should throw BadRequestException for past event', async () => {
      prisma.event.findUnique.mockResolvedValue({
        ...mockEvent,
        date: pastDate,
        _count: { enrollments: 0 },
      } as any);

      await expect(service.enroll('event-1', 'member-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw ConflictException for duplicate enrollment', async () => {
      prisma.event.findUnique.mockResolvedValue({
        ...mockEvent,
        _count: { enrollments: 5 },
      } as any);
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

    it('should throw BadRequestException for past event', async () => {
      prisma.event.findUnique.mockResolvedValue({
        ...mockEvent,
        date: pastDate,
      } as any);

      await expect(service.unenroll('event-1', 'member-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('getEnrollments', () => {
    it('should return enrollments for an event', async () => {
      prisma.event.findUnique.mockResolvedValue(mockEvent as any);
      prisma.eventEnrollment.findMany.mockResolvedValue([mockEnrollment] as any);

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
    it('should return events a member is enrolled in', async () => {
      prisma.eventEnrollment.findMany.mockResolvedValue([
        { ...mockEnrollment, event: mockEvent },
      ] as any);

      const result = await service.getMyEvents('member-1');
      expect(result).toHaveLength(1);
    });
  });
});
