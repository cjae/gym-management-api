import { Test, TestingModule } from '@nestjs/testing';
import { ExportsService } from './exports.service';
import { PrismaService } from '../prisma/prisma.service';
import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaClient } from '@prisma/client';

describe('ExportsService', () => {
  let service: ExportsService;
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExportsService,
        { provide: PrismaService, useValue: mockDeep<PrismaClient>() },
      ],
    }).compile();

    service = module.get<ExportsService>(ExportsService);
    prisma = module.get(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getMembers', () => {
    it('should return flattened member data with no filters', async () => {
      prisma.user.findMany.mockResolvedValue([
        {
          firstName: 'Jane',
          lastName: 'Doe',
          email: 'jane@example.com',
          phone: '+254712345678',
          gender: 'FEMALE',
          birthday: new Date('1990-05-15'),
          status: 'ACTIVE',
          createdAt: new Date('2026-01-01'),
          subscriptionsOwned: [
            {
              status: 'ACTIVE',
              endDate: new Date('2026-06-01'),
              paymentMethod: 'MOBILE_MONEY',
              plan: { name: 'Premium Monthly' },
            },
          ],
        } as any,
      ]);

      const result = await service.getMembers({});

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(
        expect.objectContaining({
          firstName: 'Jane',
          lastName: 'Doe',
          email: 'jane@example.com',
          currentPlan: 'Premium Monthly',
          subscriptionStatus: 'ACTIVE',
        }),
      );
    });

    it('should filter by status', async () => {
      prisma.user.findMany.mockResolvedValue([]);

      await service.getMembers({ status: 'ACTIVE' as any });

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'ACTIVE',
          }),
        }),
      );
    });

    it('should filter by date range with end-of-day boundary', async () => {
      prisma.user.findMany.mockResolvedValue([]);

      await service.getMembers({
        startDate: '2026-01-01',
        endDate: '2026-03-31',
      });

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: {
              gte: new Date('2026-01-01'),
              lte: new Date('2026-03-31T23:59:59.999Z'),
            },
          }),
        }),
      );
    });

    it('should handle member with no subscription', async () => {
      prisma.user.findMany.mockResolvedValue([
        {
          firstName: 'John',
          lastName: 'Smith',
          email: 'john@example.com',
          phone: null,
          gender: null,
          birthday: null,
          status: 'ACTIVE',
          createdAt: new Date('2026-01-01'),
          subscriptionsOwned: [],
        } as any,
      ]);

      const result = await service.getMembers({});

      expect(result[0].currentPlan).toBe('');
      expect(result[0].subscriptionStatus).toBe('');
      expect(result[0].phone).toBe('');
    });
  });

  describe('getPayments', () => {
    it('should return flattened payment data', async () => {
      prisma.payment.findMany.mockResolvedValue([
        {
          amount: 5000,
          status: 'PAID',
          paymentMethod: 'MOBILE_MONEY',
          paystackReference: 'ref-123',
          createdAt: new Date('2026-02-15'),
          subscription: {
            primaryMember: {
              firstName: 'Jane',
              lastName: 'Doe',
              email: 'jane@example.com',
            },
            plan: { name: 'Premium Monthly' },
          },
        } as any,
      ]);

      const result = await service.getPayments({});

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(
        expect.objectContaining({
          memberName: 'Jane Doe',
          memberEmail: 'jane@example.com',
          planName: 'Premium Monthly',
          amount: 5000,
          paymentStatus: 'PAID',
        }),
      );
    });

    it('should filter by payment method', async () => {
      prisma.payment.findMany.mockResolvedValue([]);

      await service.getPayments({ paymentMethod: 'CARD' as any });

      expect(prisma.payment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            paymentMethod: 'CARD',
          }),
        }),
      );
    });
  });

  describe('getSubscriptions', () => {
    it('should return flattened subscription data', async () => {
      prisma.memberSubscription.findMany.mockResolvedValue([
        {
          primaryMemberId: 'user-1',
          status: 'ACTIVE',
          startDate: new Date('2026-01-01'),
          endDate: new Date('2026-06-01'),
          autoRenew: true,
          paymentMethod: 'CARD',
          primaryMember: {
            firstName: 'Jane',
            lastName: 'Doe',
            email: 'jane@example.com',
          },
          plan: {
            name: 'Premium Monthly',
            price: 5000,
            billingInterval: 'MONTHLY',
          },
          members: [],
        } as any,
      ]);

      const result = await service.getSubscriptions({});

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(
        expect.objectContaining({
          primaryMember: 'Jane Doe',
          primaryEmail: 'jane@example.com',
          plan: 'Premium Monthly',
          status: 'ACTIVE',
          frozen: 'No',
        }),
      );
    });

    it('should detect frozen status from subscription status', async () => {
      prisma.memberSubscription.findMany.mockResolvedValue([
        {
          primaryMemberId: 'user-1',
          status: 'FROZEN',
          startDate: new Date('2026-01-01'),
          endDate: new Date('2026-06-01'),
          autoRenew: true,
          paymentMethod: 'CARD',
          primaryMember: {
            firstName: 'Jane',
            lastName: 'Doe',
            email: 'jane@example.com',
          },
          plan: {
            name: 'Premium Monthly',
            price: 5000,
            billingInterval: 'MONTHLY',
          },
          members: [],
        } as any,
      ]);

      const result = await service.getSubscriptions({});

      expect(result[0].frozen).toBe('Yes');
    });

    it('should include duo member when present using memberId', async () => {
      prisma.memberSubscription.findMany.mockResolvedValue([
        {
          primaryMemberId: 'user-1',
          status: 'ACTIVE',
          startDate: new Date('2026-01-01'),
          endDate: new Date('2026-06-01'),
          autoRenew: false,
          paymentMethod: 'MOBILE_MONEY',
          primaryMember: {
            firstName: 'Jane',
            lastName: 'Doe',
            email: 'jane@example.com',
          },
          plan: {
            name: 'Duo Plan',
            price: 8000,
            billingInterval: 'MONTHLY',
          },
          members: [
            {
              memberId: 'user-1',
              member: {
                firstName: 'Jane',
                lastName: 'Doe',
                email: 'jane@example.com',
              },
            },
            {
              memberId: 'user-2',
              member: {
                firstName: 'John',
                lastName: 'Doe',
                email: 'john@example.com',
              },
            },
          ],
        } as any,
      ]);

      const result = await service.getSubscriptions({});

      expect(result[0].duoMember).toBe('John Doe');
      expect(result[0].duoEmail).toBe('john@example.com');
    });

    it('should handle payment with null subscription member', async () => {
      prisma.payment.findMany.mockResolvedValue([
        {
          amount: 5000,
          status: 'PAID',
          paymentMethod: 'MOBILE_MONEY',
          paystackReference: null,
          createdAt: new Date('2026-02-15'),
          subscription: {
            primaryMember: null,
            plan: { name: 'Basic' },
          },
        } as any,
      ]);

      const result = await service.getPayments({});

      expect(result[0].memberName).toBe('');
      expect(result[0].memberEmail).toBe('');
      expect(result[0].reference).toBe('');
    });
  });
});
