import { Test, TestingModule } from '@nestjs/testing';
import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaClient } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';
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

    // The webhook handler wraps activation + referral reward in a
    // `prisma.$transaction(async (tx) => ...)`. Route the tx callback to
    // the same DeepMockProxy so `tx.xxx` calls land on the same spies as
    // `prisma.xxx`. For array-form transactions, resolve each promise.
    (prisma.$transaction as jest.Mock).mockImplementation((input: unknown) =>
      typeof input === 'function'
        ? (input as (tx: typeof prisma) => unknown)(prisma)
        : Promise.all(input as Promise<unknown>[]),
    );
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

    it('should atomically expire existing PENDING payment before creating a new one', async () => {
      prisma.payment.updateMany.mockResolvedValue({ count: 1 });

      await service.initializePayment(subscriptionId, email, userId);

      expect(prisma.payment.updateMany).toHaveBeenCalledWith({
        where: { subscriptionId, status: 'PENDING' },
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
      prisma.payment.updateMany.mockResolvedValue({ count: 0 });

      await service.initializePayment(subscriptionId, email, userId);

      expect(prisma.payment.updateMany).toHaveBeenCalledWith({
        where: { subscriptionId, status: 'PENDING' },
        data: { status: 'EXPIRED' },
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

      // Atomic claim succeeds
      prisma.payment.updateMany.mockResolvedValue({ count: 1 });

      // Post-claim read for activity event
      prisma.payment.findUnique.mockResolvedValue({
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

      // Subscription activation (status-guarded updateMany inside tx)
      prisma.memberSubscription.updateMany.mockResolvedValue({ count: 1 });

      // Referral lookup (no pending referral)
      prisma.referral.updateMany.mockResolvedValue({ count: 0 });

      await service.handleWebhook(raw, signature);

      expect(prisma.memberSubscription.updateMany).toHaveBeenCalledWith(
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

      prisma.payment.updateMany.mockResolvedValue({ count: 1 });

      prisma.payment.findUnique.mockResolvedValue({
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

      prisma.memberSubscription.updateMany.mockResolvedValue({ count: 1 });
      prisma.referral.updateMany.mockResolvedValue({ count: 0 });

      await service.handleWebhook(raw, signature);

      const updateCall = prisma.memberSubscription.updateMany.mock.calls[0][0];
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

      prisma.payment.updateMany.mockResolvedValue({ count: 1 });

      prisma.payment.findUnique.mockResolvedValue({
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

      prisma.memberSubscription.updateMany.mockResolvedValue({ count: 1 });
      prisma.referral.updateMany.mockResolvedValue({ count: 0 });

      await service.handleWebhook(raw, signature);

      const updateCall = prisma.memberSubscription.updateMany.mock.calls[0][0];
      const newEndDate = updateCall.data.endDate as Date;

      // Should be ~1 month from now (not from the past endDate)
      const oneMonthFromNow = new Date();
      oneMonthFromNow.setMonth(oneMonthFromNow.getMonth() + 1);
      // Allow 1 minute tolerance
      expect(
        Math.abs(newEndDate.getTime() - oneMonthFromNow.getTime()),
      ).toBeLessThan(60_000);
    });

    // C2 — timing-safe signature comparison
    describe('signature verification (C2)', () => {
      it('rejects a webhook with an invalid (same-length) signature', async () => {
        const body = { event: 'charge.success', data: {} };
        const raw = Buffer.from(JSON.stringify(body));
        // A valid-hex string of same length as a SHA-512 hex digest (128 chars),
        // but not the right digest.
        const badSignature = 'a'.repeat(128);

        await expect(service.handleWebhook(raw, badSignature)).rejects.toThrow(
          BadRequestException,
        );
        expect(prisma.payment.updateMany).not.toHaveBeenCalled();
      });

      it('rejects a signature of different length with BadRequest (not TypeError)', async () => {
        const body = { event: 'charge.success', data: {} };
        const raw = Buffer.from(JSON.stringify(body));
        // Wrong-length signature must not crash timingSafeEqual — we short-
        // circuit before calling it.
        const shortSignature = 'deadbeef';

        await expect(
          service.handleWebhook(raw, shortSignature),
        ).rejects.toThrow(BadRequestException);
        expect(prisma.payment.updateMany).not.toHaveBeenCalled();
      });

      it('rejects an empty signature with BadRequest', async () => {
        const body = { event: 'charge.success', data: {} };
        const raw = Buffer.from(JSON.stringify(body));

        await expect(service.handleWebhook(raw, '')).rejects.toThrow(
          BadRequestException,
        );
      });
    });

    // C3 — atomic idempotency (no double side effects on concurrent webhooks)
    describe('atomic idempotency (C3)', () => {
      function buildSuccessWebhook() {
        const subscriptionId = 'sub-race';
        const paymentId = 'pay-race';
        const reference = 'ref_race';
        const body = {
          event: 'charge.success',
          data: {
            reference,
            metadata: { subscriptionId, paymentId },
            channel: 'mobile_money',
          },
        };
        return { subscriptionId, paymentId, reference, body };
      }

      it('runs side effects when updateMany claims the payment (count=1)', async () => {
        const { subscriptionId, paymentId, body } = buildSuccessWebhook();
        const { raw, signature } = buildWebhookPayload(body);

        prisma.payment.updateMany.mockResolvedValue({ count: 1 });
        prisma.payment.findUnique.mockResolvedValue({
          id: paymentId,
          amount: 2500,
          currency: 'KES',
          subscription: {
            primaryMember: {
              id: 'user-race',
              email: 'race@test.com',
              firstName: 'Race',
              lastName: 'Winner',
            },
          },
        } as any);
        prisma.memberSubscription.findUnique.mockResolvedValue({
          id: subscriptionId,
          status: 'PENDING',
          primaryMemberId: 'user-race',
          endDate: new Date(),
          plan: { price: 2500, billingInterval: 'MONTHLY' },
        } as any);
        prisma.memberSubscription.updateMany.mockResolvedValue({ count: 1 });
        prisma.referral.updateMany.mockResolvedValue({ count: 0 });

        await service.handleWebhook(raw, signature);

        expect(prisma.payment.updateMany).toHaveBeenCalledWith({
          where: { id: paymentId, status: 'PENDING' },
          data: expect.objectContaining({ status: 'PAID' }),
        });
        // Activation uses status-guarded updateMany inside the tx.
        expect(prisma.memberSubscription.updateMany).toHaveBeenCalled();
        // Referral claim path is exercised (even if count is 0 it's called)
        expect(prisma.referral.updateMany).toHaveBeenCalled();
        expect(mockEventEmitter.emit).toHaveBeenCalledWith(
          'activity.payment',
          expect.any(Object),
        );
      });

      it('skips all side effects on duplicate webhook (count=0)', async () => {
        const { body } = buildSuccessWebhook();
        const { raw, signature } = buildWebhookPayload(body);

        // Simulate the losing side of the race — another invocation already
        // flipped this payment from PENDING to PAID.
        prisma.payment.updateMany.mockResolvedValue({ count: 0 });

        const result = await service.handleWebhook(raw, signature);

        expect(result).toEqual({ received: true });
        // No subscription lookup, no subscription update, no referral claim,
        // no activity event.
        expect(prisma.payment.findUnique).not.toHaveBeenCalled();
        expect(prisma.memberSubscription.findUnique).not.toHaveBeenCalled();
        expect(prisma.memberSubscription.updateMany).not.toHaveBeenCalled();
        expect(prisma.referral.updateMany).not.toHaveBeenCalled();
        expect(mockEventEmitter.emit).not.toHaveBeenCalled();
      });

      // M13 — internal failures after the atomic claim must propagate so
      // Paystack retries. Returning 200 after a failed activation/referral
      // would make Paystack stop retrying and silently drop the event.
      it('propagates when post-claim activation throws (M13)', async () => {
        const subscriptionId = 'sub-m13';
        const paymentId = 'pay-m13';
        const reference = 'ref_m13';
        const body = {
          event: 'charge.success',
          data: {
            reference,
            metadata: { subscriptionId, paymentId },
            channel: 'mobile_money',
          },
        };
        const { raw, signature } = buildWebhookPayload(body);

        // Atomic claim succeeds.
        prisma.payment.updateMany.mockResolvedValue({ count: 1 });
        prisma.payment.findUnique.mockResolvedValue({
          id: paymentId,
          amount: 2500,
          currency: 'KES',
          subscription: {
            primaryMember: {
              id: 'user-m13',
              email: 'm13@test.com',
              firstName: 'Retry',
              lastName: 'Me',
            },
          },
        } as any);
        prisma.memberSubscription.findUnique.mockResolvedValue({
          id: subscriptionId,
          status: 'PENDING',
          primaryMemberId: 'user-m13',
          endDate: new Date(),
          plan: { price: 2500, billingInterval: 'MONTHLY' },
        } as any);

        // Simulate subscription activation blowing up (e.g. DB outage
        // mid-tx). The webhook must rethrow so Nest returns 500 and
        // Paystack retries — NOT swallow to `{ received: true }`.
        prisma.memberSubscription.updateMany.mockRejectedValue(
          new Error('simulated DB failure'),
        );

        await expect(service.handleWebhook(raw, signature)).rejects.toThrow(
          'simulated DB failure',
        );
      });

      it('does not rethrow BadRequestException for invalid signature as 500 (M13 guard)', async () => {
        // M13 must not accidentally convert signature failures (400) into
        // 500s by over-broad try/catch. The signature check is outside
        // the post-claim try/catch, so BadRequestException still surfaces
        // as-is.
        const body = { event: 'charge.success', data: {} };
        const raw = Buffer.from(JSON.stringify(body));
        const badSignature = 'a'.repeat(128);

        await expect(service.handleWebhook(raw, badSignature)).rejects.toThrow(
          BadRequestException,
        );
      });

      it('should emit shop.payment.success when metadata.type is shop', async () => {
        const rawBody = Buffer.from(
          JSON.stringify({
            event: 'charge.success',
            data: {
              reference: 'shop_ref_123',
              metadata: { type: 'shop', orderId: 'order-1' },
            },
          }),
        );
        const hash = crypto
          .createHmac('sha512', paystackSecretKey)
          .update(rawBody)
          .digest('hex');

        await service.handleWebhook(rawBody, hash);

        expect(mockEventEmitter.emit).toHaveBeenCalledWith(
          'shop.payment.success',
          {
            orderId: 'order-1',
            reference: 'shop_ref_123',
          },
        );
      });

      it('simulated concurrent invocations: only one applies side effects', async () => {
        const { subscriptionId, paymentId, body } = buildSuccessWebhook();
        const { raw, signature } = buildWebhookPayload(body);

        // First call wins the race, second loses.
        prisma.payment.updateMany
          .mockResolvedValueOnce({ count: 1 })
          .mockResolvedValueOnce({ count: 0 });

        prisma.payment.findUnique.mockResolvedValue({
          id: paymentId,
          amount: 2500,
          currency: 'KES',
          subscription: {
            primaryMember: {
              id: 'user-race',
              email: 'race@test.com',
              firstName: 'Race',
              lastName: 'Winner',
            },
          },
        } as any);
        prisma.memberSubscription.findUnique.mockResolvedValue({
          id: subscriptionId,
          status: 'PENDING',
          primaryMemberId: 'user-race',
          endDate: new Date(),
          plan: { price: 2500, billingInterval: 'MONTHLY' },
        } as any);
        prisma.memberSubscription.updateMany.mockResolvedValue({ count: 1 });
        prisma.referral.updateMany.mockResolvedValue({ count: 0 });

        await Promise.all([
          service.handleWebhook(raw, signature),
          service.handleWebhook(raw, signature),
        ]);

        // updateMany called twice (both invocations attempted the claim)
        expect(prisma.payment.updateMany).toHaveBeenCalledTimes(2);
        // But subscription activation ran exactly once — the winner's path.
        expect(prisma.memberSubscription.updateMany).toHaveBeenCalledTimes(1);
        // Exactly one activity event fired.
        expect(mockEventEmitter.emit).toHaveBeenCalledTimes(1);
        // Referral claim attempted exactly once (side-effect path gated by count).
        expect(prisma.referral.updateMany).toHaveBeenCalledTimes(1);
      });
    });
  });
});
