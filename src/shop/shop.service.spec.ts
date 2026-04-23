import { Test, TestingModule } from '@nestjs/testing';
import { ShopService } from './shop.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { GymSettingsService } from '../gym-settings/gym-settings.service';
import { ConfigService } from '@nestjs/config';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
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

  const mockItem = {
    id: 'item-1',
    name: 'Protein Shake',
    description: null,
    price: 2500,
    imageUrl: null,
    stock: 10,
    isActive: true,
    variants: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  describe('createItem', () => {
    it('should create a shop item', async () => {
      prisma.shopItem.create.mockResolvedValue(mockItem as any);
      const result = await service.createItem({
        name: 'Protein Shake',
        price: 2500,
        stock: 10,
      });
      expect(prisma.shopItem.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ name: 'Protein Shake', price: 2500 }),
        }),
      );
      expect(result.id).toBe('item-1');
    });
  });

  describe('findAllItems', () => {
    it('should return paginated items (admin sees all)', async () => {
      prisma.shopItem.findMany.mockResolvedValue([mockItem] as any);
      prisma.shopItem.count.mockResolvedValue(1);
      const result = await service.findAllItems(1, 20, false);
      expect(result.total).toBe(1);
      expect(result.data).toHaveLength(1);
    });

    it('should filter active-only for members', async () => {
      prisma.shopItem.findMany.mockResolvedValue([] as any);
      prisma.shopItem.count.mockResolvedValue(0);
      await service.findAllItems(1, 20, true);
      expect(prisma.shopItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isActive: true }),
        }),
      );
    });
  });

  describe('findOneItem', () => {
    it('should throw NotFoundException when item not found', async () => {
      prisma.shopItem.findUnique.mockResolvedValue(null);
      await expect(service.findOneItem('item-1', false)).rejects.toThrow(
        'Shop item not found',
      );
    });

    it('should throw NotFoundException for inactive item when member', async () => {
      prisma.shopItem.findUnique.mockResolvedValue({
        ...mockItem,
        isActive: false,
      } as any);
      await expect(service.findOneItem('item-1', true)).rejects.toThrow(
        'Shop item not found',
      );
    });
  });
});
