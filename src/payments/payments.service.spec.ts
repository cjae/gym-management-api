import { Test, TestingModule } from '@nestjs/testing';
import { PaymentsService } from './payments.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('PaymentsService', () => {
  let service: PaymentsService;

  const mockPrisma = {
    memberSubscription: {
      findUnique: jest.fn(),
    },
    payment: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      findMany: jest.fn(),
    },
  };

  const mockConfigService = {
    get: jest.fn().mockImplementation((key: string) => {
      if (key === 'payment')
        return { paystackSecretKey: 'sk_test_xxx', encryptionKey: '' };
      return {};
    }),
  };

  const mockEventEmitter = {
    emit: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: EventEmitter2, useValue: mockEventEmitter },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('initializePayment', () => {
    const subscriptionId = 'sub-1';
    const email = 'member@test.com';
    const userId = 'user-1';

    const mockSubscription = {
      id: subscriptionId,
      primaryMemberId: userId,
      paymentMethod: 'MPESA',
      plan: { price: 2500 },
    };

    const mockPayment = { id: 'pay-1' };

    const mockPaystackResponse = {
      data: {
        data: {
          authorization_url: 'https://paystack.com/pay/test',
          access_code: 'access_test',
          reference: 'ref_test',
        },
      },
    };

    beforeEach(() => {
      mockPrisma.memberSubscription.findUnique.mockResolvedValue(
        mockSubscription,
      );
      mockPrisma.payment.create.mockResolvedValue(mockPayment);
      mockedAxios.post.mockResolvedValue(mockPaystackResponse);
    });

    it('should expire existing PENDING payment before creating a new one', async () => {
      const existingPending = { id: 'old-pay-1', status: 'PENDING' };
      mockPrisma.payment.findFirst.mockResolvedValue(existingPending);

      await service.initializePayment(subscriptionId, email, userId);

      expect(mockPrisma.payment.findFirst).toHaveBeenCalledWith({
        where: {
          subscriptionId,
          status: 'PENDING',
        },
      });

      expect(mockPrisma.payment.update).toHaveBeenCalledWith({
        where: { id: 'old-pay-1' },
        data: { status: 'EXPIRED' },
      });

      expect(mockPrisma.payment.create).toHaveBeenCalled();
    });

    it('should create payment normally when no PENDING payment exists', async () => {
      mockPrisma.payment.findFirst.mockResolvedValue(null);

      await service.initializePayment(subscriptionId, email, userId);

      expect(mockPrisma.payment.findFirst).toHaveBeenCalledWith({
        where: {
          subscriptionId,
          status: 'PENDING',
        },
      });

      expect(mockPrisma.payment.update).not.toHaveBeenCalled();
      expect(mockPrisma.payment.create).toHaveBeenCalled();
    });
  });
});
