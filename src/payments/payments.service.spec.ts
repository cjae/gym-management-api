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

      // ceil(2000 * 1.0075) = 2016 due to floating point (2000*1.0075 = 2015.0000000000002), in cents = 201600
      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          amount: 201600,
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

      // ceil(2500 * 1.0145) = 2537, in cents = 253700
      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          amount: 253700,
          channels: ['card'],
        }),
        expect.any(Object),
      );
    });

    it('should send mobile_money channel and M-Pesa commission for MOBILE_MONEY payment method', async () => {
      prisma.payment.findFirst.mockResolvedValue(null);

      await service.initializePayment(subscriptionId, email, userId);

      // ceil(2500 * 1.0075) = 2519, in cents = 251900
      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          amount: 251900,
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

      // Subscription lookup — PENDING so baseDate = now
      prisma.memberSubscription.findUnique.mockResolvedValue({
        id: subscriptionId,
        status: 'PENDING',
        primaryMemberId: 'user-1',
        discountAmount: 500,
        originalPlanPrice: 2500,
        endDate: new Date('2026-04-15'),
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

    it('should extend from current endDate when renewing an active subscription early', async () => {
      const subscriptionId = 'sub-2';
      const paymentId = 'pay-2';
      const reference = 'ref_early_renew';

      const body = {
        event: 'charge.success',
        data: {
          reference,
          metadata: { subscriptionId, paymentId },
          channel: 'mobile_money',
        },
      };
      const { raw, signature } = buildWebhookPayload(body);

      prisma.payment.findFirst.mockResolvedValue(null);

      prisma.payment.update.mockResolvedValue({
        id: paymentId,
        amount: 2500,
        currency: 'KES',
        subscription: {
          primaryMember: {
            id: 'user-1',
            email: 'test@test.com',
            firstName: 'Jane',
            lastName: 'Doe',
          },
        },
      } as any);

      // Subscription is ACTIVE with 5 days remaining
      const futureEndDate = new Date();
      futureEndDate.setDate(futureEndDate.getDate() + 5);
      prisma.memberSubscription.findUnique.mockResolvedValue({
        id: subscriptionId,
        status: 'ACTIVE',
        primaryMemberId: 'user-1',
        endDate: futureEndDate,
        plan: { price: 2500, billingInterval: 'MONTHLY' },
      } as any);

      prisma.memberSubscription.update.mockResolvedValue({} as any);
      prisma.referral.updateMany.mockResolvedValue({ count: 0 });

      await service.handleWebhook(raw, signature);

      const updateCall = prisma.memberSubscription.update.mock.calls[0][0];
      const newEndDate = updateCall.data.endDate as Date;

      // Should be ~1 month from futureEndDate (not from now)
      // futureEndDate + 1 month should be > now + 1 month
      const oneMonthFromNow = new Date();
      oneMonthFromNow.setMonth(oneMonthFromNow.getMonth() + 1);
      expect(newEndDate.getTime()).toBeGreaterThan(oneMonthFromNow.getTime());
    });

    it('should extend from now when renewing an expired subscription', async () => {
      const subscriptionId = 'sub-3';
      const paymentId = 'pay-3';
      const reference = 'ref_expired_renew';

      const body = {
        event: 'charge.success',
        data: {
          reference,
          metadata: { subscriptionId, paymentId },
          channel: 'mobile_money',
        },
      };
      const { raw, signature } = buildWebhookPayload(body);

      prisma.payment.findFirst.mockResolvedValue(null);

      prisma.payment.update.mockResolvedValue({
        id: paymentId,
        amount: 2500,
        currency: 'KES',
        subscription: {
          primaryMember: {
            id: 'user-1',
            email: 'test@test.com',
            firstName: 'Jane',
            lastName: 'Doe',
          },
        },
      } as any);

      // Subscription is EXPIRED with endDate in the past
      const pastEndDate = new Date();
      pastEndDate.setDate(pastEndDate.getDate() - 3);
      prisma.memberSubscription.findUnique.mockResolvedValue({
        id: subscriptionId,
        status: 'EXPIRED',
        primaryMemberId: 'user-1',
        endDate: pastEndDate,
        plan: { price: 2500, billingInterval: 'MONTHLY' },
      } as any);

      prisma.memberSubscription.update.mockResolvedValue({} as any);
      prisma.referral.updateMany.mockResolvedValue({ count: 0 });

      await service.handleWebhook(raw, signature);

      const updateCall = prisma.memberSubscription.update.mock.calls[0][0];
      const newEndDate = updateCall.data.endDate as Date;

      // Should be ~1 month from now (not from the past endDate)
      const oneMonthFromNow = new Date();
      oneMonthFromNow.setMonth(oneMonthFromNow.getMonth() + 1);
      // Allow 1 minute tolerance
      expect(
        Math.abs(newEndDate.getTime() - oneMonthFromNow.getTime()),
      ).toBeLessThan(60_000);
    });
  });
});
