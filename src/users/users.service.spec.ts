import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundException } from '@nestjs/common';

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
  };

  const mockPrisma = {
    user: {
      findMany: jest.fn().mockResolvedValue([mockUserFromDb]),
      findUnique: jest.fn().mockResolvedValue(mockUserFromDb),
      update: jest.fn().mockResolvedValue(mockUserFromDb),
      delete: jest.fn().mockResolvedValue(mockUserFromDb),
      count: jest.fn().mockResolvedValue(1),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: mockPrisma },
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
