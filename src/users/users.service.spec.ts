import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { EmailService } from '../email/email.service';
import { LicensingService } from '../licensing/licensing.service';
import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaClient } from '@prisma/client';

describe('UsersService', () => {
  let service: UsersService;
  let prisma: DeepMockProxy<PrismaClient>;

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

  const mockEmailService = {
    sendWelcomeEmail: jest.fn().mockResolvedValue(undefined),
  };
  const mockLicensingService = {
    getMemberLimit: jest.fn().mockResolvedValue(null),
    getAdminLimit: jest.fn().mockResolvedValue(null),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: mockDeep<PrismaClient>() },
        { provide: EmailService, useValue: mockEmailService },
        { provide: LicensingService, useValue: mockLicensingService },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    prisma = module.get(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should return paginated users', async () => {
      prisma.user.findMany.mockResolvedValue([mockUserFromDb] as any);
      prisma.user.count.mockResolvedValue(1);

      const result = await service.findAll(1, 20);
      expect(result).toEqual({
        data: [mockUser],
        total: 1,
        page: 1,
        limit: 20,
      });

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { deletedAt: null },
          skip: 0,
          take: 20,
        }),
      );
    });

    it('should filter users by role', async () => {
      prisma.user.findMany.mockResolvedValue([mockUserFromDb] as any);
      prisma.user.count.mockResolvedValue(1);

      await service.findAll(1, 20, ['MEMBER']);

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { deletedAt: null, role: { in: ['MEMBER'] } },
        }),
      );

      expect(prisma.user.count).toHaveBeenCalledWith({
        where: { deletedAt: null, role: { in: ['MEMBER'] } },
      });
    });
  });

  describe('findOne', () => {
    it('should return a user by id', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUserFromDb as any);

      const result = await service.findOne('user-1');
      expect(result).toEqual(mockUser);

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        select: expect.any(Object),
      });
    });

    it('should throw NotFoundException if user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.findOne('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException if user is soft-deleted', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...mockUserFromDb,
        deletedAt: new Date(),
      } as any);
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
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue(mockUserFromDb as any);

      const result: Record<string, unknown> = await service.create(
        createDto,
        'ADMIN',
      );

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
      prisma.user.findUnique.mockResolvedValue(mockUserFromDb as any);
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
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue(mockUserFromDb as any);

      await service.create(
        { ...createDto, role: 'ADMIN' as const },
        'SUPER_ADMIN',
      );

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
      prisma.user.findUnique.mockResolvedValue(null);
      mockLicensingService.getMemberLimit.mockResolvedValueOnce(10);
      prisma.user.count.mockResolvedValue(10);
      await expect(service.create(createDto, 'ADMIN')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('remove', () => {
    it('should soft-delete a user by setting deletedAt', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUserFromDb as any);
      prisma.user.update.mockResolvedValue(mockUserFromDb as any);

      await service.remove('user-1');

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: { deletedAt: expect.any(Date) as Date },
        }),
      );
    });

    it('should throw NotFoundException if user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.remove('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findAllDeletionRequests', () => {
    it('should return paginated deletion requests', async () => {
      const mockRequests = [
        {
          id: 'dr-1',
          userId: 'user-1',
          reason: 'Moving away',
          status: 'PENDING',
          reviewedById: null,
          reviewedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          user: {
            id: 'user-1',
            firstName: 'John',
            lastName: 'Doe',
            email: 'john@test.com',
          },
        },
      ];
      prisma.accountDeletionRequest.findMany.mockResolvedValue(mockRequests as any);
      prisma.accountDeletionRequest.count.mockResolvedValue(1);

      const result = await service.findAllDeletionRequests(1, 20);
      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it('should filter by status', async () => {
      prisma.accountDeletionRequest.findMany.mockResolvedValue([]);
      prisma.accountDeletionRequest.count.mockResolvedValue(0);

      await service.findAllDeletionRequests(1, 20, 'PENDING' as any);
      expect(prisma.accountDeletionRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'PENDING' },
        }),
      );
    });
  });

  describe('approveDeletionRequest', () => {
    it('should approve request and soft-delete user', async () => {
      prisma.accountDeletionRequest.findUnique.mockResolvedValue({
        id: 'dr-1',
        userId: 'user-1',
        status: 'PENDING',
      } as any);
      prisma.$transaction.mockResolvedValue([{}, {}] as any);

      const result = await service.approveDeletionRequest('dr-1', 'admin-1');
      expect(result.message).toContain('approved');
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('should throw NotFoundException if request not found', async () => {
      prisma.accountDeletionRequest.findUnique.mockResolvedValue(null);

      await expect(
        service.approveDeletionRequest('nonexistent', 'admin-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if request is not PENDING', async () => {
      prisma.accountDeletionRequest.findUnique.mockResolvedValue({
        id: 'dr-1',
        status: 'APPROVED',
      } as any);

      await expect(
        service.approveDeletionRequest('dr-1', 'admin-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('rejectDeletionRequest', () => {
    it('should reject a pending request', async () => {
      prisma.accountDeletionRequest.findUnique.mockResolvedValue({
        id: 'dr-1',
        status: 'PENDING',
      } as any);
      prisma.accountDeletionRequest.update.mockResolvedValue({
        id: 'dr-1',
        status: 'REJECTED',
      } as any);

      const result = await service.rejectDeletionRequest('dr-1', 'admin-1');
      expect(result.message).toContain('rejected');
    });

    it('should throw NotFoundException if request not found', async () => {
      prisma.accountDeletionRequest.findUnique.mockResolvedValue(null);

      await expect(
        service.rejectDeletionRequest('nonexistent', 'admin-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if request is not PENDING', async () => {
      prisma.accountDeletionRequest.findUnique.mockResolvedValue({
        id: 'dr-1',
        status: 'APPROVED',
      } as any);

      await expect(
        service.rejectDeletionRequest('dr-1', 'admin-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
