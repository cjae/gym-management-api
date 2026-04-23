import { Test, TestingModule } from '@nestjs/testing';
import { GymClassesService } from './gym-classes.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaClient } from '@prisma/client';
import { ConflictException, NotFoundException } from '@nestjs/common';

describe('GymClassesService', () => {
  let service: GymClassesService;
  let prisma: DeepMockProxy<PrismaClient>;
  let emailService: DeepMockProxy<EmailService>;
  let notificationsService: DeepMockProxy<NotificationsService>;

  const mockGymClass = {
    id: 'class-1',
    title: 'Morning HIIT',
    description: null,
    dayOfWeek: 1,
    startTime: '06:00',
    endTime: '07:00',
    maxCapacity: 20,
    trainerId: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockEnrollment = {
    id: 'enroll-1',
    classId: 'class-1',
    memberId: 'member-1',
    enrolledAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GymClassesService,
        { provide: PrismaService, useValue: mockDeep<PrismaClient>() },
        { provide: EmailService, useValue: mockDeep<EmailService>() },
        {
          provide: NotificationsService,
          useValue: mockDeep<NotificationsService>(),
        },
      ],
    }).compile();

    service = module.get<GymClassesService>(GymClassesService);
    prisma = module.get(PrismaService);
    emailService = module.get(EmailService);
    notificationsService = module.get(NotificationsService);
    notificationsService.create.mockResolvedValue(undefined as any);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create a gym class', async () => {
      prisma.gymClass.findFirst.mockResolvedValue(null);
      prisma.gymClass.create.mockResolvedValue(mockGymClass as any);

      const result = await service.create({
        title: 'Morning HIIT',
        dayOfWeek: 1,
        startTime: '06:00',
        endTime: '07:00',
      });

      expect(result).toEqual(mockGymClass);
      expect(prisma.gymClass.create).toHaveBeenCalled();
    });

    it('should throw ConflictException on time overlap', async () => {
      prisma.gymClass.findFirst.mockResolvedValue(mockGymClass as any);

      await expect(
        service.create({
          title: 'Another Class',
          dayOfWeek: 1,
          startTime: '06:30',
          endTime: '07:30',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('findAll', () => {
    it('should return paginated active gym classes', async () => {
      prisma.gymClass.findMany.mockResolvedValue([mockGymClass] as any);
      prisma.gymClass.count.mockResolvedValue(1);

      const result = await service.findAll(1, 20);

      expect(result).toEqual({
        data: [mockGymClass],
        total: 1,
        page: 1,
        limit: 20,
      });
      expect(prisma.gymClass.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { isActive: true },
        }),
      );
    });
  });

  describe('findOne', () => {
    it('should return a gym class with enrollment count (default)', async () => {
      prisma.gymClass.findUnique.mockResolvedValue({
        ...mockGymClass,
        _count: { enrollments: 5 },
      } as any);

      const result = await service.findOne('class-1');

      expect(result).toEqual(
        expect.objectContaining({ id: 'class-1', _count: { enrollments: 5 } }),
      );
    });

    it('should include full enrollments when requested', async () => {
      const classWithEnrollments = {
        ...mockGymClass,
        _count: { enrollments: 1 },
        enrollments: [{ member: { id: 'member-1', email: 'a@b.com' } }],
      };
      prisma.gymClass.findUnique.mockResolvedValue(classWithEnrollments as any);

      const result = await service.findOne('class-1', true);

      expect(result).toEqual(classWithEnrollments);
    });

    it('should throw NotFoundException when class not found', async () => {
      prisma.gymClass.findUnique.mockResolvedValue(null);

      await expect(service.findOne('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException for inactive class', async () => {
      prisma.gymClass.findUnique.mockResolvedValue({
        ...mockGymClass,
        isActive: false,
      } as any);

      await expect(service.findOne('class-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('should update a gym class', async () => {
      const updated = { ...mockGymClass, title: 'Evening HIIT' };
      prisma.gymClass.findUnique.mockResolvedValue({
        ...mockGymClass,
        enrollments: [],
      } as any);
      prisma.gymClass.findFirst.mockResolvedValue(null);
      prisma.gymClass.update.mockResolvedValue(updated as any);

      const result = await service.update('class-1', { title: 'Evening HIIT' });

      expect(result.title).toBe('Evening HIIT');
    });

    it('should send emails when time changes', async () => {
      const updated = { ...mockGymClass, startTime: '07:00', endTime: '08:00' };
      prisma.gymClass.findUnique.mockResolvedValue({
        ...mockGymClass,
        enrollments: [
          { member: { id: 'member-1', email: 'a@b.com', firstName: 'John' } },
        ],
      } as any);
      prisma.gymClass.findFirst.mockResolvedValue(null);
      prisma.gymClass.update.mockResolvedValue(updated as any);
      emailService.sendEmail.mockResolvedValue(undefined);

      await service.update('class-1', {
        startTime: '07:00',
        endTime: '08:00',
      });

      expect(emailService.sendEmail).toHaveBeenCalledWith(
        'a@b.com',
        expect.stringContaining('Class Schedule Updated'),
        'class-updated',
        expect.any(Object),
      );
    });

    it('should throw ConflictException on time overlap with another class', async () => {
      const otherClass = { ...mockGymClass, id: 'class-2' };
      prisma.gymClass.findUnique.mockResolvedValue(mockGymClass as any);
      prisma.gymClass.findFirst.mockResolvedValue(otherClass as any);

      await expect(
        service.update('class-1', { startTime: '06:00', endTime: '07:00' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('remove (soft delete)', () => {
    it('should soft-delete and notify enrolled members', async () => {
      prisma.gymClass.findUnique.mockResolvedValue({
        ...mockGymClass,
        enrollments: [
          { member: { id: 'member-1', email: 'a@b.com', firstName: 'John' } },
        ],
      } as any);
      prisma.gymClass.update.mockResolvedValue({
        ...mockGymClass,
        isActive: false,
      } as any);
      emailService.sendEmail.mockResolvedValue(undefined);

      const result = await service.remove('class-1');

      expect(result.isActive).toBe(false);
      expect(emailService.sendEmail).toHaveBeenCalledWith(
        'a@b.com',
        expect.stringContaining('Class Cancelled'),
        'class-cancelled',
        expect.any(Object),
      );
    });
  });

  describe('enroll', () => {
    beforeEach(() => {
      // Run the transaction callback using the same mocked prisma client.
      prisma.$transaction.mockImplementation((fn: any) => fn(prisma));
    });

    it('should enroll a member in a class (atomic counter increment)', async () => {
      prisma.gymClass.findUnique
        .mockResolvedValueOnce({
          id: 'class-1',
          isActive: true,
        } as any)
        .mockResolvedValueOnce({ maxCapacity: 20 } as any);
      prisma.gymClass.updateMany.mockResolvedValue({ count: 1 });
      prisma.classEnrollment.create.mockResolvedValue(mockEnrollment as any);

      const result = await service.enroll('class-1', 'member-1');

      expect(result).toEqual(mockEnrollment);
      // Conditional increment: only increments when enrolledCount < maxCapacity.
      expect(prisma.gymClass.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'class-1',
          isActive: true,
          enrolledCount: { lt: 20 },
        },
        data: { enrolledCount: { increment: 1 } },
      });
      expect(prisma.classEnrollment.create).toHaveBeenCalledWith({
        data: { classId: 'class-1', memberId: 'member-1' },
      });
    });

    it('should throw NotFoundException for inactive class', async () => {
      prisma.gymClass.findUnique.mockResolvedValueOnce({
        id: 'class-1',
        isActive: false,
      } as any);

      await expect(service.enroll('class-1', 'member-1')).rejects.toThrow(
        NotFoundException,
      );
      // Should short-circuit before opening a transaction.
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('should throw ConflictException when class is at capacity', async () => {
      prisma.gymClass.findUnique
        .mockResolvedValueOnce({ id: 'class-1', isActive: true } as any)
        .mockResolvedValueOnce({ maxCapacity: 20 } as any);
      // Atomic increment returns count:0 when enrolledCount >= maxCapacity.
      prisma.gymClass.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.enroll('class-1', 'member-1')).rejects.toThrow(
        ConflictException,
      );
      // No enrollment row is created when capacity check fails.
      expect(prisma.classEnrollment.create).not.toHaveBeenCalled();
    });

    it('simulated race: two concurrent enrollments with capacity=1 — only one wins', async () => {
      // Simulate the DB by sharing a counter across the two calls. The
      // conditional updateMany is resolved atomically per call: only the
      // first call observes enrolledCount < maxCapacity.
      const CAPACITY = 1;
      let enrolledCount = 0;

      // Both pre-check findUnique calls see the class as active.
      prisma.gymClass.findUnique.mockImplementation(((args: any) => {
        if (args.select?.maxCapacity) {
          return Promise.resolve({ maxCapacity: CAPACITY } as any);
        }
        return Promise.resolve({ id: 'class-1', isActive: true } as any);
      }) as any);

      // updateMany simulates the conditional atomic increment.
      prisma.gymClass.updateMany.mockImplementation(((args: any) => {
        const ltBound = args.where?.enrolledCount?.lt;
        if (typeof ltBound === 'number' && enrolledCount < ltBound) {
          enrolledCount += 1;
          return Promise.resolve({ count: 1 });
        }
        return Promise.resolve({ count: 0 });
      }) as any);

      prisma.classEnrollment.create.mockResolvedValue(mockEnrollment as any);

      const results = await Promise.allSettled([
        service.enroll('class-1', 'member-1'),
        service.enroll('class-1', 'member-2'),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(ConflictException);
      expect(rejected[0].reason.message).toBe('Class is full');
      // Only one enrollment row is actually created.
      expect(prisma.classEnrollment.create).toHaveBeenCalledTimes(1);
      // Counter lands exactly at capacity, never over.
      expect(enrolledCount).toBe(CAPACITY);
    });
  });

  describe('unenroll', () => {
    beforeEach(() => {
      prisma.$transaction.mockImplementation((fn: any) => fn(prisma));
    });

    it('should remove enrollment and decrement counter atomically', async () => {
      prisma.gymClass.findUnique.mockResolvedValue(mockGymClass as any);
      prisma.classEnrollment.deleteMany.mockResolvedValue({ count: 1 });
      prisma.gymClass.updateMany.mockResolvedValue({ count: 1 });

      await service.unenroll('class-1', 'member-1');

      expect(prisma.classEnrollment.deleteMany).toHaveBeenCalledWith({
        where: { classId: 'class-1', memberId: 'member-1' },
      });
      // Guarded decrement: gt: 0 prevents the counter from going negative.
      expect(prisma.gymClass.updateMany).toHaveBeenCalledWith({
        where: { id: 'class-1', enrolledCount: { gt: 0 } },
        data: { enrolledCount: { decrement: 1 } },
      });
    });

    it('should not decrement counter when no enrollment row was deleted', async () => {
      prisma.gymClass.findUnique.mockResolvedValue(mockGymClass as any);
      prisma.classEnrollment.deleteMany.mockResolvedValue({ count: 0 });

      await service.unenroll('class-1', 'member-1');

      expect(prisma.gymClass.updateMany).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when class not found', async () => {
      prisma.gymClass.findUnique.mockResolvedValue(null);

      await expect(service.unenroll('class-1', 'member-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getEnrollments', () => {
    it('should return enrollments for a class', async () => {
      prisma.gymClass.findUnique.mockResolvedValue(mockGymClass as any);
      prisma.classEnrollment.findMany.mockResolvedValue([
        mockEnrollment,
      ] as any);

      const result = await service.getEnrollments('class-1');

      expect(result).toEqual([mockEnrollment]);
    });

    it('should throw NotFoundException when class not found', async () => {
      prisma.gymClass.findUnique.mockResolvedValue(null);

      await expect(service.getEnrollments('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getMyClasses', () => {
    it('should return classes a member is enrolled in', async () => {
      prisma.classEnrollment.findMany.mockResolvedValue([
        { ...mockEnrollment, gymClass: mockGymClass },
      ] as any);

      const result = await service.getMyClasses('member-1');

      expect(result).toHaveLength(1);
    });
  });
});
