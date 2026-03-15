import { Test, TestingModule } from '@nestjs/testing';
import { GymClassesService } from './gym-classes.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaClient } from '@prisma/client';
import { ConflictException, NotFoundException } from '@nestjs/common';

describe('GymClassesService', () => {
  let service: GymClassesService;
  let prisma: DeepMockProxy<PrismaClient>;
  let emailService: DeepMockProxy<EmailService>;

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
      ],
    }).compile();

    service = module.get<GymClassesService>(GymClassesService);
    prisma = module.get(PrismaService);
    emailService = module.get(EmailService);
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
        enrollments: [{ member: { email: 'a@b.com', firstName: 'John' } }],
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
        enrollments: [{ member: { email: 'a@b.com', firstName: 'John' } }],
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
    it('should enroll a member in a class', async () => {
      prisma.gymClass.findUnique.mockResolvedValue({
        ...mockGymClass,
        _count: { enrollments: 5 },
      } as any);
      prisma.classEnrollment.create.mockResolvedValue(mockEnrollment as any);

      const result = await service.enroll('class-1', 'member-1');

      expect(result).toEqual(mockEnrollment);
    });

    it('should throw NotFoundException for inactive class', async () => {
      prisma.gymClass.findUnique.mockResolvedValue({
        ...mockGymClass,
        isActive: false,
        _count: { enrollments: 0 },
      } as any);

      await expect(service.enroll('class-1', 'member-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ConflictException when class is at capacity', async () => {
      prisma.gymClass.findUnique.mockResolvedValue({
        ...mockGymClass,
        maxCapacity: 20,
        _count: { enrollments: 20 },
      } as any);

      await expect(service.enroll('class-1', 'member-1')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('unenroll', () => {
    it('should remove enrollment', async () => {
      prisma.gymClass.findUnique.mockResolvedValue(mockGymClass as any);
      prisma.classEnrollment.deleteMany.mockResolvedValue({ count: 1 });

      await service.unenroll('class-1', 'member-1');

      expect(prisma.classEnrollment.deleteMany).toHaveBeenCalledWith({
        where: { classId: 'class-1', memberId: 'member-1' },
      });
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
