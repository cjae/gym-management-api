import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { EmailService } from '../email/email.service';
import { LicensingService } from '../licensing/licensing.service';

describe('UsersService', () => {
  let service: UsersService;
  let prisma: PrismaService;

  const mockUserFromDb = {
    id: 'user-1',
    email: 'test@example.com',
    firstName: 'John',
    lastName: 'Doe',
    phone: null,
    role: 'MEMBER',
    status: 'ACTIVE',
    gender: null,
    displayPicture: null,
    birthday: null,
    mustChangePassword: false,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    attendances: [{ checkInDate: new Date('2026-03-10') }],
    subscriptionMembers: [
      {
        subscription: {
          id: 'sub-1',
          status: 'ACTIVE',
          startDate: new Date(),
          endDate: new Date(),
          plan: {
            id: 'plan-1',
            name: 'Monthly',
            price: 2500,
            currency: 'KES',
            billingInterval: 'MONTHLY',
          },
        },
      },
    ],
  };

  const mockUser = {
    id: 'user-1',
    email: 'test@example.com',
    firstName: 'John',
    lastName: 'Doe',
    phone: null,
    role: 'MEMBER',
    status: 'ACTIVE',
    gender: null,
    displayPicture: null,
    birthday: null,
    mustChangePassword: false,
    deletedAt: null,
    createdAt: mockUserFromDb.createdAt,
    updatedAt: mockUserFromDb.updatedAt,
    subscription: mockUserFromDb.subscriptionMembers[0].subscription,
    lastAttendance: mockUserFromDb.attendances[0].checkInDate,
  };

  const mockPrisma = {
    user: {
      findMany: jest.fn().mockResolvedValue([mockUserFromDb]),
      findUnique: jest.fn().mockResolvedValue(mockUserFromDb),
      update: jest.fn().mockResolvedValue(mockUserFromDb),
      create: jest.fn().mockResolvedValue(mockUserFromDb),
      delete: jest.fn().mockResolvedValue(mockUserFromDb),
      count: jest.fn().mockResolvedValue(1),
    },
  };

  const mockEmailService = {
    sendWelcomeEmail: jest.fn().mockResolvedValue(undefined),
  };
  const mockLicensingService = {
    getMemberLimit: jest.fn().mockResolvedValue(null),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EmailService, useValue: mockEmailService },
        { provide: LicensingService, useValue: mockLicensingService },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should return paginated users', async () => {
      const result = await service.findAll(1, 20);
      expect(result).toEqual({
        data: [mockUser],
        total: 1,
        page: 1,
        limit: 20,
      });
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { deletedAt: null },
          skip: 0,
          take: 20,
        }),
      );
    });

    it('should filter users by role', async () => {
      await service.findAll(1, 20, 'MEMBER');
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { deletedAt: null, role: 'MEMBER' },
        }),
      );
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(prisma.user.count).toHaveBeenCalledWith({
        where: { deletedAt: null, role: 'MEMBER' },
      });
    });
  });

  describe('findOne', () => {
    it('should return a user by id', async () => {
      const result = await service.findOne('user-1');
      expect(result).toEqual(mockUser);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        select: expect.any(Object),
      });
    });

    it('should throw NotFoundException if user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);
      await expect(service.findOne('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException if user is soft-deleted', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        ...mockUserFromDb,
        deletedAt: new Date(),
      });
      await expect(service.findOne('user-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    const createDto = {
      email: 'new@example.com',
      firstName: 'Jane',
      lastName: 'Smith',
      role: 'MEMBER' as const,
    };

    it('should create a user with hashed password and mustChangePassword=true', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);
      const result = await service.create(createDto, 'ADMIN');
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          data: expect.objectContaining({
            email: 'new@example.com',
            firstName: 'Jane',
            lastName: 'Smith',
            role: 'MEMBER',
            mustChangePassword: true,
          }),
        }),
      );
      expect(mockEmailService.sendWelcomeEmail).toHaveBeenCalledWith(
        'new@example.com',
        'Jane',
        expect.any(String),
      );
      expect(result).toBeDefined();
    });

    it('should throw ConflictException if email already exists', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(mockUserFromDb);
      await expect(service.create(createDto, 'ADMIN')).rejects.toThrow(
        ConflictException,
      );
    });

    it('should throw ForbiddenException if ADMIN tries to create ADMIN', async () => {
      await expect(
        service.create({ ...createDto, role: 'ADMIN' as const }, 'ADMIN'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should allow SUPER_ADMIN to create ADMIN', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);
      await service.create(
        { ...createDto, role: 'ADMIN' as const },
        'SUPER_ADMIN',
      );
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          data: expect.objectContaining({ role: 'ADMIN' }),
        }),
      );
    });

    it('should throw ForbiddenException if trying to create SUPER_ADMIN', async () => {
      await expect(
        service.create(
          { ...createDto, role: 'SUPER_ADMIN' as const },
          'SUPER_ADMIN',
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should enforce license member limit for MEMBER role', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);
      mockLicensingService.getMemberLimit.mockResolvedValueOnce(10);
      mockPrisma.user.count.mockResolvedValueOnce(10);
      await expect(service.create(createDto, 'ADMIN')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('remove', () => {
    it('should soft-delete a user by setting deletedAt', async () => {
      await service.remove('user-1');
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: { deletedAt: expect.any(Date) as Date },
        }),
      );
    });

    it('should throw NotFoundException if user does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);
      await expect(service.remove('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
