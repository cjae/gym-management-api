import { Test, TestingModule } from '@nestjs/testing';
import { TrainersService } from './trainers.service';
import { PrismaService } from '../prisma/prisma.service';
import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaClient } from '@prisma/client';

describe('TrainersService', () => {
  let service: TrainersService;
  let prisma: DeepMockProxy<PrismaClient>;

  const mockProfile = {
    id: 'profile-1',
    userId: 'user-1',
    specialization: 'Strength',
    bio: 'Coach',
    availability: null,
    user: { id: 'user-1', firstName: 'Mike', lastName: 'O' },
  };

  const mockAssignment = {
    id: 'assign-1',
    trainerId: 'profile-1',
    memberId: 'member-1',
    startDate: new Date(),
    endDate: null,
    notes: null,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TrainersService,
        { provide: PrismaService, useValue: mockDeep<PrismaClient>() },
      ],
    }).compile();

    service = module.get<TrainersService>(TrainersService);
    prisma = module.get(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createProfile', () => {
    it('should create a trainer profile', async () => {
      prisma.trainerProfile.create.mockResolvedValue(mockProfile as any);

      const result = await service.createProfile({
        userId: 'user-1',
        specialization: 'Strength',
        bio: 'Coach',
      });
      expect(result).toEqual(mockProfile);

      expect(prisma.trainerProfile.create).toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('should return paginated trainer profiles', async () => {
      prisma.trainerProfile.findMany.mockResolvedValue([mockProfile] as any);
      prisma.trainerProfile.count.mockResolvedValue(1);

      const result = await service.findAll(1, 20);
      expect(result).toEqual({
        data: [mockProfile],
        total: 1,
        page: 1,
        limit: 20,
      });

      expect(prisma.trainerProfile.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
          take: 20,
        }),
      );
    });
  });

  describe('findOne', () => {
    it('should return a trainer profile by id', async () => {
      prisma.trainerProfile.findUnique.mockResolvedValue(mockProfile as any);

      const result = await service.findOne('profile-1');
      expect(result).toEqual(mockProfile);
    });
  });

  describe('assignMember', () => {
    it('should assign a member to a trainer', async () => {
      prisma.trainerAssignment.create.mockResolvedValue(mockAssignment as any);

      const result = await service.assignMember({
        trainerId: 'profile-1',
        memberId: 'member-1',
        startDate: '2024-01-01',
      });
      expect(result).toEqual(mockAssignment);
    });
  });

  describe('getMemberTrainer', () => {
    it('should return current trainer for a member', async () => {
      prisma.trainerAssignment.findFirst.mockResolvedValue(
        mockAssignment as any,
      );

      const result = await service.getMemberTrainer('member-1');
      expect(result).toEqual(mockAssignment);
    });
  });
});
