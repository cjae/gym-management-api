import { Test, TestingModule } from '@nestjs/testing';
import { SubscriptionsService } from './subscriptions.service';
import { PrismaService } from '../prisma/prisma.service';

describe('SubscriptionsService', () => {
  let service: SubscriptionsService;
  let prisma: PrismaService;

  const mockPrisma = {
    subscriptionPlan: {
      findUnique: jest.fn(),
    },
    memberSubscription: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    subscriptionMember: {
      create: jest.fn(),
      findFirst: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<SubscriptionsService>(SubscriptionsService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('hasActiveSubscription', () => {
    it('should return true when member has an active subscription', async () => {
      mockPrisma.subscriptionMember.findFirst.mockResolvedValueOnce({
        id: 'sm-1',
        subscriptionId: 'sub-1',
        memberId: 'user-1',
      });

      const result = await service.hasActiveSubscription('user-1');
      expect(result).toBe(true);
      expect(prisma.subscriptionMember.findFirst).toHaveBeenCalledWith({
        where: {
          memberId: 'user-1',
          subscription: {
            status: 'ACTIVE',
            endDate: { gte: expect.any(Date) },
          },
        },
      });
    });

    it('should return false when member has no active subscription', async () => {
      mockPrisma.subscriptionMember.findFirst.mockResolvedValueOnce(null);

      const result = await service.hasActiveSubscription('user-2');
      expect(result).toBe(false);
    });
  });
});
