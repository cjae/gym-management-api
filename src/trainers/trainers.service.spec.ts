import { Test, TestingModule } from '@nestjs/testing';
import { TrainersService } from './trainers.service';
import { PrismaService } from '../prisma/prisma.service';

describe('TrainersService', () => {
  let service: TrainersService;
  let prisma: PrismaService;

  const mockProfile = {
    id: 'profile-1',
    userId: 'user-1',
    specialization: 'Strength',
    bio: 'Coach',
    availability: null,
    user: { id: 'user-1', firstName: 'Mike', lastName: 'O' },
  };

  const mockSchedule = {
    id: 'sched-1',
    trainerId: 'profile-1',
    title: 'Morning Class',
    dayOfWeek: 1,
    startTime: '08:00',
    endTime: '09:00',
    maxCapacity: 10,
  };

  const mockAssignment = {
    id: 'assign-1',
    trainerId: 'profile-1',
    memberId: 'member-1',
    startDate: new Date(),
    endDate: null,
    notes: null,
  };

  const mockPrisma = {
    trainerProfile: {
      create: jest.fn().mockResolvedValue(mockProfile),
      findMany: jest.fn().mockResolvedValue([mockProfile]),
      findUnique: jest.fn().mockResolvedValue(mockProfile),
      count: jest.fn().mockResolvedValue(1),
    },
    trainerSchedule: {
      create: jest.fn().mockResolvedValue(mockSchedule),
      findMany: jest.fn().mockResolvedValue([mockSchedule]),
    },
    trainerAssignment: {
      create: jest.fn().mockResolvedValue(mockAssignment),
      findFirst: jest.fn().mockResolvedValue(mockAssignment),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TrainersService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<TrainersService>(TrainersService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createProfile', () => {
    it('should create a trainer profile', async () => {
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
      const result = await service.findAll(1, 20);
      expect(result).toEqual({ data: [mockProfile], total: 1, page: 1, limit: 20 });
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
      const result = await service.findOne('profile-1');
      expect(result).toEqual(mockProfile);
    });
  });

  describe('addSchedule', () => {
    it('should add a schedule to a trainer', async () => {
      const result = await service.addSchedule('profile-1', {
        title: 'Morning Class',
        dayOfWeek: 1,
        startTime: '08:00',
        endTime: '09:00',
      });
      expect(result).toEqual(mockSchedule);
    });
  });

  describe('getSchedules', () => {
    it('should return schedules for a trainer', async () => {
      const result = await service.getSchedules('profile-1');
      expect(result).toEqual([mockSchedule]);
    });
  });

  describe('assignMember', () => {
    it('should assign a member to a trainer', async () => {
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
      const result = await service.getMemberTrainer('member-1');
      expect(result).toEqual(mockAssignment);
    });
  });
});
