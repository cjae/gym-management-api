import { Test, TestingModule } from '@nestjs/testing';
import { ShopService } from './shop.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { GymSettingsService } from '../gym-settings/gym-settings.service';
import { ConfigService } from '@nestjs/config';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { NotificationType, PrismaClient } from '@prisma/client';
import axios from 'axios';

describe('ShopService', () => {
  let service: ShopService;
  let prisma: DeepMockProxy<PrismaClient>;
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
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

  const mockVariant = {
    id: 'variant-1',
    shopItemId: 'item-1',
    name: 'Large',
    priceOverride: null,
    stock: 5,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  describe('removeItem', () => {
    it('should throw ConflictException when item has existing orders', async () => {
      prisma.shopItem.findUnique.mockResolvedValue(mockItem as any);
      prisma.shopOrderItem.count.mockResolvedValue(1);
      await expect(service.removeItem('item-1')).rejects.toThrow(
        'Cannot delete item that has existing orders',
      );
    });
  });

  describe('addVariant', () => {
    it('should add a variant to an item', async () => {
      prisma.shopItem.findUnique.mockResolvedValue(mockItem as any);
      prisma.shopItemVariant.create.mockResolvedValue(mockVariant as any);
      const result = await service.addVariant('item-1', {
        name: 'Large',
        stock: 5,
      });
      expect(result.name).toBe('Large');
    });

    it('should throw NotFoundException if item not found', async () => {
      prisma.shopItem.findUnique.mockResolvedValue(null);
      await expect(
        service.addVariant('item-1', { name: 'Large', stock: 5 }),
      ).rejects.toThrow('Shop item not found');
    });
  });

  describe('removeVariant', () => {
    it('should throw NotFoundException if variant not found', async () => {
      prisma.shopItemVariant.findUnique.mockResolvedValue(null);
      await expect(
        service.removeVariant('item-1', 'variant-1'),
      ).rejects.toThrow('Variant not found');
    });
  });

  describe('createOrder', () => {
    let gymSettingsServiceMock: DeepMockProxy<GymSettingsService>;

    beforeEach(() => {
      gymSettingsServiceMock = module.get(GymSettingsService);
      gymSettingsServiceMock.getCachedSettings.mockResolvedValue({
        currency: 'KES',
      } as any);
    });

    it('should throw BadRequestException when item not found', async () => {
      prisma.shopItem.findUnique.mockResolvedValue(null);
      await expect(
        service.createOrder('member-1', 'member@test.com', {
          items: [{ shopItemId: 'item-1', quantity: 1 }],
          paymentMethod: 'CARD' as any,
        }),
      ).rejects.toThrow('Shop item item-1 not found');
    });

    it('should throw ConflictException when stock insufficient', async () => {
      prisma.shopItem.findUnique.mockResolvedValue({
        ...mockItem,
        stock: 0,
        variants: [],
      } as any);
      await expect(
        service.createOrder('member-1', 'member@test.com', {
          items: [{ shopItemId: 'item-1', quantity: 1 }],
          paymentMethod: 'CARD' as any,
        }),
      ).rejects.toThrow('Insufficient stock');
    });

    it('should create order with variant and return paystackReference', async () => {
      const mockVariantItem = {
        ...mockItem,
        stock: 0,
        variants: [
          { id: 'variant-1', name: 'Large', priceOverride: 3000, stock: 5 },
        ],
      };
      const mockOrder = {
        id: 'order-1',
        memberId: 'member-1',
        status: 'PENDING',
        totalAmount: 3000,
        currency: 'KES',
        paymentMethod: 'CARD',
        paystackReference: 'shop_order-1_123',
        orderItems: [
          {
            shopItemId: 'item-1',
            variantId: 'variant-1',
            quantity: 1,
            unitPrice: 3000,
          },
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      prisma.shopItem.findUnique.mockResolvedValue(mockVariantItem as any);
      prisma.shopOrder.create.mockResolvedValue({
        ...mockOrder,
        paystackReference: null,
      } as any);
      prisma.shopItemVariant.updateMany.mockResolvedValue({ count: 1 });
      prisma.shopOrder.update.mockResolvedValue(mockOrder as any);
      prisma.$transaction.mockImplementation((cb: any) => cb(prisma));

      const axiosMock = jest.spyOn(axios, 'post').mockResolvedValueOnce({
        data: {
          data: {
            authorization_url: 'https://paystack.com/pay/abc',
            access_code: 'abc',
            reference: 'shop_order-1_123',
          },
        },
      });

      const result = await service.createOrder('member-1', 'member@test.com', {
        items: [{ shopItemId: 'item-1', variantId: 'variant-1', quantity: 1 }],
        paymentMethod: 'CARD' as any,
      });

      expect(result.order.paystackReference).toBe('shop_order-1_123');
      expect(result.checkout.authorization_url).toBeDefined();
      axiosMock.mockRestore();
    });

    it('should throw ConflictException when concurrent order exhausts stock', async () => {
      prisma.shopItem.findUnique.mockResolvedValue({
        ...mockItem,
        stock: 1,
        variants: [],
      } as any);
      prisma.shopOrder.create.mockResolvedValue({
        id: 'order-1',
        orderItems: [],
      } as any);
      // updateMany returns 0 — stock was grabbed by another request
      prisma.shopItem.updateMany.mockResolvedValue({ count: 0 });
      prisma.$transaction.mockImplementation((cb: any) => cb(prisma));

      await expect(
        service.createOrder('member-1', 'member@test.com', {
          items: [{ shopItemId: 'item-1', quantity: 1 }],
          paymentMethod: 'CARD' as any,
        }),
      ).rejects.toThrow('Insufficient stock (concurrent order)');
    });

    it('should cancel order and restore stock when Paystack init fails', async () => {
      prisma.shopItem.findUnique.mockResolvedValue({
        ...mockItem,
        stock: 5,
        variants: [],
      } as any);
      prisma.shopOrder.create.mockResolvedValue({
        id: 'order-1',
        orderItems: [],
      } as any);
      prisma.shopItem.updateMany.mockResolvedValue({ count: 1 });
      prisma.$transaction.mockImplementation((cb: any) => cb(prisma));
      prisma.shopOrder.update.mockResolvedValue({} as any);
      prisma.shopItem.update.mockResolvedValue({} as any);

      // Force axios to throw
      const axiosMock = jest
        .spyOn(axios, 'post')
        .mockRejectedValueOnce(new Error('Network error'));

      await expect(
        service.createOrder('member-1', 'member@test.com', {
          items: [{ shopItemId: 'item-1', quantity: 1 }],
          paymentMethod: 'CARD' as any,
        }),
      ).rejects.toThrow('Payment initialization failed');

      // Order should be cancelled
      expect(prisma.shopOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'order-1' },
          data: { status: 'CANCELLED' },
        }),
      );
      // Stock should be restored
      expect(prisma.shopItem.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'item-1' },
          data: { stock: { increment: 1 } },
        }),
      );

      axiosMock.mockRestore();
    });

    it('should throw BadRequestException when item has variants but no variantId given', async () => {
      prisma.shopItem.findUnique.mockResolvedValue({
        ...mockItem,
        stock: 0,
        variants: [
          { id: 'variant-1', name: 'Large', priceOverride: null, stock: 5 },
        ],
      } as any);

      await expect(
        service.createOrder('member-1', 'member@test.com', {
          items: [{ shopItemId: 'item-1', quantity: 1 }],
          paymentMethod: 'CARD' as any,
        }),
      ).rejects.toThrow('has variants');
    });
  });

  describe('createAdminOrder', () => {
    it('should create order with COLLECTED status', async () => {
      prisma.user.findFirst.mockResolvedValue({
        id: 'member-1',
        role: 'MEMBER',
        deletedAt: null,
      } as any);
      prisma.shopItem.findUnique.mockResolvedValue({
        ...mockItem,
        variants: [],
      } as any);
      prisma.shopOrder.create.mockResolvedValue({
        id: 'order-1',
        status: 'COLLECTED',
        orderItems: [],
      } as any);
      prisma.shopItem.updateMany.mockResolvedValue({ count: 1 });
      prisma.$transaction.mockImplementation((cb: any) => cb(prisma));

      const gymSettingsServiceMock =
        module.get<DeepMockProxy<GymSettingsService>>(GymSettingsService);
      gymSettingsServiceMock.getCachedSettings.mockResolvedValue({
        currency: 'KES',
      } as any);

      const result = await service.createAdminOrder({
        memberId: 'member-1',
        items: [{ shopItemId: 'item-1', quantity: 1 }],
        paymentMethod: 'MOBILE_MONEY_IN_PERSON' as any,
      });

      expect(result.status).toBe('COLLECTED');
    });

    it('should throw NotFoundException when memberId is not a valid MEMBER', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      const gymSettingsServiceMock =
        module.get<DeepMockProxy<GymSettingsService>>(GymSettingsService);
      gymSettingsServiceMock.getCachedSettings.mockResolvedValue({
        currency: 'KES',
      } as any);

      await expect(
        service.createAdminOrder({
          memberId: 'bad-id',
          items: [{ shopItemId: 'item-1', quantity: 1 }],
          paymentMethod: 'MOBILE_MONEY_IN_PERSON' as any,
        }),
      ).rejects.toThrow('Member not found');
    });
  });

  describe('collectOrder', () => {
    it('should throw NotFoundException if order not found', async () => {
      prisma.shopOrder.findUnique.mockResolvedValue(null);
      await expect(service.collectOrder('order-1')).rejects.toThrow(
        'Order not found',
      );
    });

    it('should throw BadRequestException if order is not PAID', async () => {
      prisma.shopOrder.findUnique.mockResolvedValue({
        id: 'order-1',
        status: 'PENDING',
        member: { id: 'member-1', firstName: 'Jane' },
      } as any);
      await expect(service.collectOrder('order-1')).rejects.toThrow(
        'Order is not ready for collection',
      );
    });
  });

  describe('cancelOrder', () => {
    it('should throw NotFoundException when order not found', async () => {
      prisma.shopOrder.findUnique.mockResolvedValue(null);
      await expect(service.cancelOrder('order-1', 'member-1')).rejects.toThrow(
        'Order not found',
      );
    });

    it('should throw NotFoundException when order belongs to another member', async () => {
      prisma.shopOrder.findUnique.mockResolvedValue({
        id: 'order-1',
        memberId: 'other-member',
        status: 'PENDING',
        orderItems: [],
      } as any);
      await expect(service.cancelOrder('order-1', 'member-1')).rejects.toThrow(
        'Order not found',
      );
    });

    it('should throw BadRequestException when order is not PENDING', async () => {
      prisma.shopOrder.findUnique.mockResolvedValue({
        id: 'order-1',
        memberId: 'member-1',
        status: 'PAID',
        orderItems: [],
      } as any);
      await expect(service.cancelOrder('order-1', 'member-1')).rejects.toThrow(
        'Order cannot be cancelled',
      );
    });

    it('should throw BadRequestException when order is already CANCELLED', async () => {
      prisma.shopOrder.findUnique.mockResolvedValue({
        id: 'order-1',
        memberId: 'member-1',
        status: 'CANCELLED',
        orderItems: [],
      } as any);
      await expect(service.cancelOrder('order-1', 'member-1')).rejects.toThrow(
        'Order cannot be cancelled',
      );
    });

    it('should cancel order and restore variant stock', async () => {
      prisma.shopOrder.findUnique.mockResolvedValue({
        id: 'order-1',
        memberId: 'member-1',
        status: 'PENDING',
        orderItems: [
          { shopItemId: 'item-1', variantId: 'variant-1', quantity: 2 },
        ],
      } as any);
      prisma.shopOrder.updateMany.mockResolvedValue({ count: 1 });
      prisma.shopItemVariant.updateMany.mockResolvedValue({ count: 1 });

      await service.cancelOrder('order-1', 'member-1');

      expect(prisma.shopOrder.updateMany).toHaveBeenCalledWith({
        where: { id: 'order-1', status: 'PENDING' },
        data: { status: 'CANCELLED' },
      });
      expect(prisma.shopItemVariant.updateMany).toHaveBeenCalledWith({
        where: { id: 'variant-1' },
        data: { stock: { increment: 2 } },
      });
    });

    it('should cancel order and restore item stock when no variant', async () => {
      prisma.shopOrder.findUnique.mockResolvedValue({
        id: 'order-1',
        memberId: 'member-1',
        status: 'PENDING',
        orderItems: [{ shopItemId: 'item-1', variantId: null, quantity: 3 }],
      } as any);
      prisma.shopOrder.updateMany.mockResolvedValue({ count: 1 });
      prisma.shopItem.updateMany.mockResolvedValue({ count: 1 });

      await service.cancelOrder('order-1', 'member-1');

      expect(prisma.shopItem.updateMany).toHaveBeenCalledWith({
        where: { id: 'item-1' },
        data: { stock: { increment: 3 } },
      });
    });

    it('should throw BadRequestException when cron races and cancels first', async () => {
      prisma.shopOrder.findUnique.mockResolvedValue({
        id: 'order-1',
        memberId: 'member-1',
        status: 'PENDING',
        orderItems: [],
      } as any);
      prisma.shopOrder.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.cancelOrder('order-1', 'member-1')).rejects.toThrow(
        'Order cannot be cancelled',
      );
    });
  });

  describe('findMyOrders', () => {
    it('should return paginated orders for member', async () => {
      prisma.shopOrder.findMany.mockResolvedValue([]);
      prisma.shopOrder.count.mockResolvedValue(0);
      const result = await service.findMyOrders('member-1', 1, 20);
      expect(prisma.shopOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { memberId: 'member-1' },
        }),
      );
      expect(result.total).toBe(0);
    });
  });

  describe('findMyOrder', () => {
    it('should throw NotFoundException when order belongs to another member', async () => {
      prisma.shopOrder.findUnique.mockResolvedValue({
        id: 'order-1',
        memberId: 'other-member',
        orderItems: [],
      } as any);
      await expect(service.findMyOrder('order-1', 'member-1')).rejects.toThrow(
        'Order not found',
      );
    });
  });

  describe('cleanupPendingOrders', () => {
    it('should cancel PENDING orders older than 1 hour and restore stock', async () => {
      const staleOrder = {
        id: 'order-1',
        status: 'PENDING',
        createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2h ago
        orderItems: [{ shopItemId: 'item-1', variantId: null, quantity: 2 }],
      };
      prisma.shopOrder.findMany.mockResolvedValue([staleOrder] as any);
      prisma.shopOrder.updateMany.mockResolvedValue({ count: 1 });
      prisma.shopItem.updateMany.mockResolvedValue({ count: 1 });

      await service.cleanupPendingOrders();

      expect(prisma.shopOrder.updateMany).toHaveBeenCalledWith({
        where: { id: 'order-1', status: 'PENDING' },
        data: { status: 'CANCELLED' },
      });
      expect(prisma.shopItem.updateMany).toHaveBeenCalledWith({
        where: { id: 'item-1' },
        data: { stock: { increment: 2 } },
      });
    });
  });

  describe('checkAndNotifyLowStock', () => {
    it('should email admins when item stock reaches zero', async () => {
      prisma.shopItem.findUnique.mockResolvedValue({
        ...mockItem,
        stock: 0,
        variants: [],
      } as any);
      prisma.user.findMany.mockResolvedValue([
        { id: 'admin-1', email: 'admin@gym.com', firstName: 'Admin' },
      ] as any);

      const emailService: DeepMockProxy<EmailService> =
        module.get(EmailService);
      emailService.sendEmail.mockResolvedValue(undefined as any);

      await (service as any).checkAndNotifyLowStock([
        { shopItemId: 'item-1', variantId: null, quantity: 1 },
      ]);

      expect(emailService.sendEmail).toHaveBeenCalledWith(
        'admin@gym.com',
        expect.stringContaining('Out of Stock'),
        'shop-low-stock',
        expect.objectContaining({ itemName: 'Protein Shake' }),
      );
    });
  });

  describe('handlePaymentSuccess', () => {
    it('should update order to PAID', async () => {
      const notificationsService =
        module.get<DeepMockProxy<NotificationsService>>(NotificationsService);
      notificationsService.create.mockResolvedValue(undefined as any);
      prisma.shopOrder.updateMany.mockResolvedValue({ count: 1 });
      prisma.shopOrder.findUnique.mockResolvedValue({
        id: 'order-1',
        orderItems: [],
      } as any);

      await service.handlePaymentSuccess('order-1', 'ref_123');

      expect(prisma.shopOrder.updateMany).toHaveBeenCalledWith({
        where: { id: 'order-1', status: 'PENDING' },
        data: { status: 'PAID', paystackReference: 'ref_123' },
      });
    });

    it('should log warn when order not PENDING', async () => {
      const notificationsService =
        module.get<DeepMockProxy<NotificationsService>>(NotificationsService);
      prisma.shopOrder.updateMany.mockResolvedValue({ count: 0 });
      const logSpy = jest.spyOn((service as any).logger, 'warn');

      await service.handlePaymentSuccess('order-1', 'ref_123');

      expect(logSpy).toHaveBeenCalled();
      expect(notificationsService.create).not.toHaveBeenCalled();
    });

    it('should send SHOP_ORDER_PAID push notification when order transitions to PAID', async () => {
      const notificationsService =
        module.get<DeepMockProxy<NotificationsService>>(NotificationsService);
      notificationsService.create.mockResolvedValue(undefined as any);
      prisma.shopOrder.updateMany.mockResolvedValue({ count: 1 });
      prisma.shopOrder.findUnique.mockResolvedValue({
        id: 'order-1',
        memberId: 'member-1',
        orderItems: [],
      } as any);

      await service.handlePaymentSuccess('order-1', 'ref_123');

      expect(notificationsService.create).toHaveBeenCalledWith({
        userId: 'member-1',
        title: 'Payment Confirmed',
        body: 'Your shop order has been received and is being prepared.',
        type: NotificationType.SHOP_ORDER_PAID,
        metadata: { orderId: 'order-1' },
      });
    });
  });
});
