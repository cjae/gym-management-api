import { Test, TestingModule } from '@nestjs/testing';
import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaClient } from '@prisma/client';
import { PaymentsService } from './payments.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { GymSettingsService } from '../gym-settings/gym-settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailService } from '../email/email.service';
import * as crypto from 'crypto';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('PaymentsService', () => {
  let service: PaymentsService;
  let prisma: DeepMockProxy<PrismaClient>;

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

  const mockGymSettingsService = {
    getCachedSettings: jest.fn(),
  };

  const mockNotificationsService = {
    create: jest.fn(),
  };

  const mockEmailService = {
    sendReferralRewardEmail: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: mockDeep<PrismaClient>() },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: EventEmitter2, useValue: mockEventEmitter },
        { provide: GymSettingsService, useValue: mockGymSettingsService },
        { provide: NotificationsService, useValue: mockNotificationsService },
        { provide: EmailService, useValue: mockEmailService },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
    prisma = module.get(PrismaService);
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
      paymentMethod: 'MOBILE_MONEY',
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
      prisma.memberSubscription.findUnique.mockResolvedValue(
        mockSubscription as any,
      );
      prisma.payment.create.mockResolvedValue(mockPayment as any);
      mockedAxios.post.mockResolvedValue(mockPaystackResponse);
    });

    it('should expire existing PENDING payment before creating a new one', async () => {
      const existingPending = { id: 'old-pay-1', status: 'PENDING' };
      prisma.payment.findFirst.mockResolvedValue(existingPending as any);

      await service.initializePayment(subscriptionId, email, userId);

      expect(prisma.payment.findFirst).toHaveBeenCalledWith({
        where: {
          subscriptionId,
          status: 'PENDING',
        },
      });

      expect(prisma.payment.update).toHaveBeenCalledWith({
        where: { id: 'old-pay-1' },
        data: { status: 'EXPIRED' },
      });

      expect(prisma.payment.create).toHaveBeenCalled();
    });

    it('should use discounted amount when subscription has discountAmount', async () => {
      const discountedSubscription = {
        ...mockSubscription,
        plan: { price: 2500 },
        discountAmount: 500,
      };
      prisma.memberSubscription.findUnique.mockResolvedValue(
        discountedSubscription as any,
      );
      prisma.payment.findFirst.mockResolvedValue(null);
      prisma.payment.create.mockResolvedValue(mockPayment as any);

      await service.initializePayment(subscriptionId, email, userId);

      // Payment amount should be plan.price - discountAmount = 2000
      expect(prisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            amount: 2000,
          }),
        }),
      );

      // Paystack gets amount with commission in cents: ceil(2000 * 1.015) * 100 = 2030 * 100 = 203000
      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          amount: 203000,
          channels: ['mobile_money'],
        }),
        expect.any(Object),
      );
    });

    it('should send card channel and card commission for CARD payment method', async () => {
      const cardSubscription = {
        ...mockSubscription,
        paymentMethod: 'CARD',
      };
      prisma.memberSubscription.findUnique.mockResolvedValue(
        cardSubscription as any,
      );
      prisma.payment.findFirst.mockResolvedValue(null);

      await service.initializePayment(subscriptionId, email, userId);

      // ceil(2500 * 1.029) = 2573, in cents = 257300
      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          amount: 257300,
          channels: ['card'],
        }),
        expect.any(Object),
      );
    });

    it('should send mobile_money channel and M-Pesa commission for MOBILE_MONEY payment method', async () => {
      prisma.payment.findFirst.mockResolvedValue(null);

      await service.initializePayment(subscriptionId, email, userId);

      // ceil(2500 * 1.015) = 2538, in cents = 253800
      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          amount: 253800,
          channels: ['mobile_money'],
        }),
        expect.any(Object),
      );
    });

    it('should create payment normally when no PENDING payment exists', async () => {
      prisma.payment.findFirst.mockResolvedValue(null);

      await service.initializePayment(subscriptionId, email, userId);

      expect(prisma.payment.findFirst).toHaveBeenCalledWith({
        where: {
          subscriptionId,
          status: 'PENDING',
        },
      });

      expect(prisma.payment.update).not.toHaveBeenCalled();
      expect(prisma.payment.create).toHaveBeenCalled();
    });
  });

  describe('handleWebhook', () => {
    const paystackSecretKey = 'sk_test_xxx';

    function buildWebhookPayload(body: object) {
      const raw = Buffer.from(JSON.stringify(body));
      const signature = crypto
        .createHmac('sha512', paystackSecretKey)
        .update(raw)
        .digest('hex');
      return { raw, signature };
    }

    it('should clear discountAmount and originalPlanPrice after first successful payment', async () => {
      const subscriptionId = 'sub-1';
      const paymentId = 'pay-1';
      const reference = 'ref_test_123';

      const body = {
        event: 'charge.success',
        data: {
          reference,
          metadata: { subscriptionId, paymentId },
          channel: 'card',
          authorization: { authorization_code: 'AUTH_abc' },
        },
      };
      const { raw, signature } = buildWebhookPayload(body);

      // No duplicate reference
      prisma.payment.findFirst.mockResolvedValue(null);

      // Payment update
      prisma.payment.update.mockResolvedValue({
        id: paymentId,
        amount: 2000,
        currency: 'KES',
        subscription: {
          primaryMember: {
            id: 'user-1',
            email: 'test@test.com',
            firstName: 'John',
            lastName: 'Doe',
          },
        },
      } as any);

      // Subscription lookup
      prisma.memberSubscription.findUnique.mockResolvedValue({
        id: subscriptionId,
        primaryMemberId: 'user-1',
        discountAmount: 500,
        originalPlanPrice: 2500,
        plan: { price: 2500, billingInterval: 'MONTHLY' },
      } as any);

      // Subscription update
      prisma.memberSubscription.update.mockResolvedValue({} as any);

      // Referral lookup (no pending referral)
      prisma.referral.updateMany.mockResolvedValue({ count: 0 });

      await service.handleWebhook(raw, signature);

      expect(prisma.memberSubscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: subscriptionId },
          data: expect.objectContaining({
            status: 'ACTIVE',
            discountAmount: null,
            originalPlanPrice: null,
          }),
        }),
      );
    });
  });
});
