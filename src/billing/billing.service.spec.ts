import { Test, TestingModule } from '@nestjs/testing';
import { BillingService } from './billing.service';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsService } from '../payments/payments.service';
import { EmailService } from '../email/email.service';
import { ConfigService } from '@nestjs/config';
import { NotificationsService } from '../notifications/notifications.service';
import { UsersService } from '../users/users.service';

describe('BillingService', () => {
  let service: BillingService;

  const mockPrisma = {
    memberSubscription: {
      findMany: jest.fn(),
      update: jest.fn(),
    },
    payment: {
      count: jest.fn(),
    },
  };

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
        { provide: PrismaService, useValue: mockPrisma },
        { provide: PaymentsService, useValue: mockPaymentsService },
        { provide: EmailService, useValue: mockEmailService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: NotificationsService, useValue: mockNotificationsService },
        { provide: UsersService, useValue: mockUsersService },
      ],
    }).compile();

    service = module.get<BillingService>(BillingService);
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

      mockPrisma.memberSubscription.findMany.mockResolvedValueOnce([
        subscription,
      ]);
      mockPrisma.payment.count.mockResolvedValueOnce(0);
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

      mockPrisma.memberSubscription.findMany.mockResolvedValueOnce([
        subscription,
      ]);
      mockPrisma.payment.count.mockResolvedValueOnce(2);

      await service.processCardRenewals();

      expect(mockPrisma.memberSubscription.update).toHaveBeenCalledWith({
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

      mockPrisma.memberSubscription.findMany.mockResolvedValueOnce([
        subscription,
      ]);

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

      mockPrisma.memberSubscription.findMany.mockResolvedValueOnce([
        subscription,
      ]);

      await service.expireOverdueSubscriptions();

      expect(mockPrisma.memberSubscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-3' },
        data: { status: 'EXPIRED', autoRenew: false },
      });
      expect(mockEmailService.sendSubscriptionExpiredEmail).toHaveBeenCalled();
    });
  });
});
