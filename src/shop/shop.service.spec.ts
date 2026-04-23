import { Test, TestingModule } from '@nestjs/testing';
import { ShopService } from './shop.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { GymSettingsService } from '../gym-settings/gym-settings.service';
import { ConfigService } from '@nestjs/config';
import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaClient } from '@prisma/client';

describe('ShopService', () => {
  let service: ShopService;
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShopService,
        { provide: PrismaService, useValue: mockDeep<PrismaClient>() },
        { provide: EmailService, useValue: mockDeep<EmailService>() },
        {
          provide: NotificationsService,
          useValue: mockDeep<NotificationsService>(),
        },
        {
          provide: GymSettingsService,
          useValue: mockDeep<GymSettingsService>(),
        },
        {
          provide: ConfigService,
          useValue: {
            get: () => ({
              paystackSecretKey: 'test-key',
              paystackCallbackUrl: '',
              paystackCancelUrl: '',
            }),
          },
        },
      ],
    }).compile();

    service = module.get<ShopService>(ShopService);
    prisma = module.get(PrismaService);
    prisma.$transaction.mockImplementation((cb: any) => cb(prisma));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
