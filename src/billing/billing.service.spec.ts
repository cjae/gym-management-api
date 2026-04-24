import { Test, TestingModule } from '@nestjs/testing';
import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaClient } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { BillingService } from './billing.service';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsService } from '../payments/payments.service';
import { EmailService } from '../email/email.service';
import { ConfigService } from '@nestjs/config';
import { NotificationsService } from '../notifications/notifications.service';
import { UsersService } from '../users/users.service';
import { GymSettingsService } from '../gym-settings/gym-settings.service';
import { encrypt } from '../common/utils/encryption.util';

jest.mock('@sentry/nestjs', () => ({
  captureMessage: jest.fn(),
}));

describe('BillingService', () => {
  let service: BillingService;
  let prisma: DeepMockProxy<PrismaClient>;

  const mockPaymentsService = {
    chargeAuthorization: jest.fn(),
  };

  const mockEmailService = {
    sendSubscriptionReminderEmail: jest.fn(),
    sendSubscriptionExpiredEmail: jest.fn(),
    sendCardPaymentFailedEmail: jest.fn(),
    sendBirthdayEmail: jest.fn(),
  };

  // 32-byte hex key (64 chars) — a valid AES-256-GCM key so the default
  // config uses the "ENCRYPTION_KEY configured" branch. Individual tests
  // override this when they need to exercise the no-key path.
  const testEncryptionKey = 'a'.repeat(64);

  const mockConfigService = {
    get: jest.fn().mockImplementation((key: string) => {
      if (key === 'app')
        return { memberAppUrl: 'powerbarnfitness://manage-subscription' };
      if (key === 'payment')
        return {
          paystackSecretKey: 'sk_test',
          encryptionKey: testEncryptionKey,
        };
      return {};
    }),
  };

  const mockNotificationsService = {
    create: jest.fn().mockResolvedValue({}),
  };

  const mockUsersService = {
    findBirthdays: jest.fn().mockResolvedValue([]),
  };

  const mockGymSettingsService = {
    getCachedSettings: jest
      .fn()
      .mockResolvedValue({ timezone: 'Africa/Nairobi' }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingService,
        { provide: PrismaService, useValue: mockDeep<PrismaClient>() },
        { provide: PaymentsService, useValue: mockPaymentsService },
        { provide: EmailService, useValue: mockEmailService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: NotificationsService, useValue: mockNotificationsService },
        { provide: UsersService, useValue: mockUsersService },
        { provide: GymSettingsService, useValue: mockGymSettingsService },
      ],
    }).compile();

    service = module.get<BillingService>(BillingService);
    prisma = module.get(PrismaService);
    jest.clearAllMocks();

    // Default: advisory-lock helper always succeeds. Individual tests that
    // exercise M16 lock-contention override this behavior. We match against
    // `pg_try_advisory_lock` and `pg_advisory_unlock` so we don't
    // accidentally hijack unrelated raw queries a test might issue.
    prisma.$queryRaw.mockImplementation((query: any) => {
      const sql = Array.isArray(query?.strings)
        ? query.strings.join('')
        : String(query);
      if (sql.includes('pg_try_advisory_lock')) {
        return Promise.resolve([{ acquired: true }]) as any;
      }
      if (sql.includes('pg_advisory_unlock')) {
        return Promise.resolve([{ pg_advisory_unlock: true }]) as any;
      }
      return Promise.resolve([]) as any;
    });
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('processCardRenewals', () => {
    it('should charge card subscriptions due today', async () => {
      const encryptedAuth = encrypt('AUTH_abc123', testEncryptionKey);
      const subscription = {
        id: 'sub-1',
        paystackAuthorizationCode: encryptedAuth,
        paymentMethod: 'CARD',
        autoRenew: true,
        nextBillingDate: new Date(),
        primaryMember: { id: 'u-1', email: 'test@test.com', firstName: 'John' },
        plan: { price: 2500, name: 'Monthly', billingInterval: 'MONTHLY' },
      };

      prisma.memberSubscription.findMany.mockResolvedValueOnce([
        subscription,
      ] as any);
      prisma.payment.count.mockResolvedValueOnce(0);
      mockPaymentsService.chargeAuthorization.mockResolvedValueOnce({
        id: 'pay-1',
      });

      await service.processCardRenewals();

      expect(mockPaymentsService.chargeAuthorization).toHaveBeenCalledWith(
        'sub-1',
        'AUTH_abc123',
        'test@test.com',
        2500,
      );
    });

    it('should charge full plan price on renewal, not discounted price', async () => {
      const encryptedAuth = encrypt('AUTH_abc123', testEncryptionKey);
      const subscription = {
        id: 'sub-1',
        paystackAuthorizationCode: encryptedAuth,
        paymentMethod: 'CARD',
        autoRenew: true,
        nextBillingDate: new Date(),
        discountAmount: 500,
        originalPlanPrice: 2500,
        primaryMember: { id: 'u-1', email: 'test@test.com', firstName: 'John' },
        plan: { price: 2500, name: 'Monthly', billingInterval: 'MONTHLY' },
      };

      prisma.memberSubscription.findMany.mockResolvedValueOnce([
        subscription,
      ] as any);
      prisma.payment.count.mockResolvedValueOnce(0);
      mockPaymentsService.chargeAuthorization.mockResolvedValueOnce({
        id: 'pay-1',
      });

      await service.processCardRenewals();

      // Renewal charges full plan price, not the (one-time) discounted amount
      expect(mockPaymentsService.chargeAuthorization).toHaveBeenCalledWith(
        'sub-1',
        'AUTH_abc123',
        'test@test.com',
        2500,
      );
    });

    it('should expire subscription after 2 consecutive card failures', async () => {
      const encryptedAuth = encrypt('AUTH_abc123', testEncryptionKey);
      const subscription = {
        id: 'sub-1',
        paystackAuthorizationCode: encryptedAuth,
        paymentMethod: 'CARD',
        autoRenew: true,
        nextBillingDate: new Date(),
        primaryMember: { id: 'u-1', email: 'test@test.com', firstName: 'John' },
        plan: { price: 2500, name: 'Monthly', billingInterval: 'MONTHLY' },
      };

      prisma.memberSubscription.findMany.mockResolvedValueOnce([
        subscription,
      ] as any);
      prisma.payment.count.mockResolvedValueOnce(2);

      await service.processCardRenewals();

      expect(prisma.memberSubscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: { status: 'EXPIRED', autoRenew: false },
      });
      expect(mockEmailService.sendCardPaymentFailedEmail).toHaveBeenCalled();
    });

    // C4 — decryption-failure path self-heals by nulling the stored code
    // H8 — also fires a Sentry captureMessage and stamps billingFlaggedAt
    it('nulls stored auth code, flags for review, and alerts on decrypt failure (C4 + H8)', async () => {
      // Corrupt ciphertext — valid format (three colon-separated hex parts)
      // but won't decrypt under testEncryptionKey. This simulates either a
      // legacy plaintext row or tampered data.
      const corruptAuth = 'deadbeef:cafe:babe';
      const subscription = {
        id: 'sub-corrupt',
        paystackAuthorizationCode: corruptAuth,
        paymentMethod: 'CARD',
        autoRenew: true,
        nextBillingDate: new Date(),
        primaryMember: {
          id: 'u-corrupt',
          email: 'corrupt@test.com',
          firstName: 'Corrupt',
        },
        plan: { price: 2500, name: 'Monthly', billingInterval: 'MONTHLY' },
      };

      prisma.memberSubscription.findMany.mockResolvedValueOnce([
        subscription,
      ] as any);
      prisma.payment.count.mockResolvedValueOnce(0);

      // Should NOT throw — service swallows the decrypt error and nulls
      // the field so the member re-authorizes on the next cycle.
      await expect(service.processCardRenewals()).resolves.not.toThrow();

      // H8 — nulls auth code AND stamps billingFlaggedAt for admin review
      expect(prisma.memberSubscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-corrupt' },
        data: {
          paystackAuthorizationCode: null,
          billingFlaggedAt: expect.any(Date),
        },
      });

      // H8 — fires Sentry captureMessage at warning severity with identifying context
      expect(Sentry.captureMessage).toHaveBeenCalledWith(
        expect.stringContaining('decrypt failed'),
        expect.objectContaining({
          level: 'warning',
          extra: expect.objectContaining({
            subscriptionId: 'sub-corrupt',
            memberId: 'u-corrupt',
          }),
        }),
      );

      // Charge must not have been attempted with bogus data.
      expect(mockPaymentsService.chargeAuthorization).not.toHaveBeenCalled();
    });
  });

  describe('processMobileMoneyReminders', () => {
    it('should send reminder 3 days before billing date', async () => {
      const threeDaysFromNow = new Date();
      threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);

      const subscription = {
        id: 'sub-2',
        paymentMethod: 'MOBILE_MONEY',
        autoRenew: true,
        nextBillingDate: threeDaysFromNow,
        primaryMember: {
          id: 'u-2',
          email: 'mpesa@test.com',
          firstName: 'Jane',
        },
        plan: { price: 2500, name: 'Monthly', billingInterval: 'MONTHLY' },
      };

      prisma.memberSubscription.findMany.mockResolvedValueOnce([
        subscription,
      ] as any);

      await service.processMobileMoneyReminders();

      expect(
        mockEmailService.sendSubscriptionReminderEmail,
      ).toHaveBeenCalledWith(
        'mpesa@test.com',
        'Jane',
        'Monthly',
        2500,
        3,
        'powerbarnfitness://manage-subscription',
      );
    });
  });

  describe('expireOverdueSubscriptions', () => {
    it('should expire M-Pesa subscriptions past billing date with no payment', async () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      const subscription = {
        id: 'sub-3',
        paymentMethod: 'MOBILE_MONEY',
        autoRenew: true,
        nextBillingDate: yesterday,
        primaryMember: {
          id: 'u-3',
          email: 'expired@test.com',
          firstName: 'Bob',
        },
        plan: { price: 2500, name: 'Monthly', billingInterval: 'MONTHLY' },
      };

      prisma.memberSubscription.findMany.mockResolvedValueOnce([
        subscription,
      ] as any);

      await service.expireOverdueSubscriptions();

      expect(prisma.memberSubscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-3' },
        data: { status: 'EXPIRED', autoRenew: false },
      });
      expect(mockEmailService.sendSubscriptionExpiredEmail).toHaveBeenCalled();
    });
  });

  // M16 — advisory-lock contention should short-circuit the cron so a
  // second replica firing on the same schedule cannot double-charge.
  describe('handleCardRenewals (M16 advisory lock)', () => {
    it('skips processCardRenewals when another replica holds the lock', async () => {
      // Override the default $queryRaw mock so pg_try_advisory_lock
      // returns false (another replica already holds the lock).
      prisma.$queryRaw.mockImplementation((query: any) => {
        const sql = Array.isArray(query?.strings)
          ? query.strings.join('')
          : String(query);
        if (sql.includes('pg_try_advisory_lock')) {
          return Promise.resolve([{ acquired: false }]) as any;
        }
        if (sql.includes('pg_advisory_unlock')) {
          return Promise.resolve([{ pg_advisory_unlock: true }]) as any;
        }
        return Promise.resolve([]) as any;
      });

      await service.handleCardRenewals();

      // No DB scan for due subscriptions, no charge attempts — we bailed
      // out before any side effect.
      expect(prisma.memberSubscription.findMany).not.toHaveBeenCalled();
      expect(mockPaymentsService.chargeAuthorization).not.toHaveBeenCalled();
    });

    it('runs processCardRenewals and releases the lock on success', async () => {
      prisma.memberSubscription.findMany.mockResolvedValueOnce([]);

      await service.handleCardRenewals();

      // Scan happened — the lock was acquired.
      expect(prisma.memberSubscription.findMany).toHaveBeenCalled();

      // Lock was both acquired and released. The default mock matches both
      // `pg_try_advisory_lock` and `pg_advisory_unlock`; assert the
      // unlock raw query was issued.
      const rawCalls = prisma.$queryRaw.mock.calls;
      const unlockCalled = rawCalls.some((call) => {
        const arg = call[0] as any;
        const sql = Array.isArray(arg?.strings)
          ? arg.strings.join('')
          : String(arg);
        return sql.includes('pg_advisory_unlock');
      });
      expect(unlockCalled).toBe(true);
    });

    it('releases the lock even when the inner work throws', async () => {
      prisma.memberSubscription.findMany.mockRejectedValueOnce(
        new Error('DB down'),
      );

      await expect(service.handleCardRenewals()).rejects.toThrow('DB down');

      const rawCalls = prisma.$queryRaw.mock.calls;
      const unlockCalled = rawCalls.some((call) => {
        const arg = call[0] as any;
        const sql = Array.isArray(arg?.strings)
          ? arg.strings.join('')
          : String(arg);
        return sql.includes('pg_advisory_unlock');
      });
      expect(unlockCalled).toBe(true);
    });
  });
});
