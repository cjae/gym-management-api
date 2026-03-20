import { Test, TestingModule } from '@nestjs/testing';
import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaClient } from '@prisma/client';
import { BillingService } from './billing.service';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsService } from '../payments/payments.service';
import { EmailService } from '../email/email.service';
import { ConfigService } from '@nestjs/config';
import { NotificationsService } from '../notifications/notifications.service';
import { UsersService } from '../users/users.service';

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
  };

  const mockConfigService = {
    get: jest.fn().mockImplementation((key: string) => {
      if (key === 'app') return { adminUrl: 'http://localhost:3001' };
      if (key === 'payment')
        return { paystackSecretKey: 'sk_test', encryptionKey: '' };
      return {};
    }),
  };

  const mockNotificationsService = {
    create: jest.fn().mockResolvedValue({}),
  };

  const mockUsersService = {
    findBirthdays: jest.fn().mockResolvedValue([]),
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
      ],
    }).compile();

    service = module.get<BillingService>(BillingService);
    prisma = module.get(PrismaService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('processCardRenewals', () => {
    it('should charge card subscriptions due today', async () => {
      const subscription = {
        id: 'sub-1',
        paystackAuthorizationCode: 'AUTH_abc123',
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
      const subscription = {
        id: 'sub-1',
        paystackAuthorizationCode: 'AUTH_abc123',
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

      // Should charge plan.price (2500), not discounted price (2000)
      expect(mockPaymentsService.chargeAuthorization).toHaveBeenCalledWith(
        'sub-1',
        'AUTH_abc123',
        'test@test.com',
        2500,
      );
    });

    it('should expire subscription after 2 consecutive card failures', async () => {
      const subscription = {
        id: 'sub-1',
        paystackAuthorizationCode: 'AUTH_abc123',
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
  });

  describe('processMpesaReminders', () => {
    it('should send reminder 3 days before billing date', async () => {
      const threeDaysFromNow = new Date();
      threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);

      const subscription = {
        id: 'sub-2',
        paymentMethod: 'MPESA',
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

      await service.processMpesaReminders();

      expect(
        mockEmailService.sendSubscriptionReminderEmail,
      ).toHaveBeenCalledWith(
        'mpesa@test.com',
        'Jane',
        'Monthly',
        2500,
        3,
        expect.stringContaining('/subscriptions'),
      );
    });
  });

  describe('expireOverdueSubscriptions', () => {
    it('should expire M-Pesa subscriptions past billing date with no payment', async () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      const subscription = {
        id: 'sub-3',
        paymentMethod: 'MPESA',
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
});
