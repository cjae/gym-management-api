import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { GymSettingsService } from '../gym-settings/gym-settings.service';
import { ConfigService } from '@nestjs/config';
import {
  PaymentConfig,
  getPaymentConfigName,
} from '../common/config/payment.config';
import { CreateShopItemDto } from './dto/create-shop-item.dto';
import { UpdateShopItemDto } from './dto/update-shop-item.dto';
import { CreateShopItemVariantDto } from './dto/create-shop-item-variant.dto';
import { UpdateShopItemVariantDto } from './dto/update-shop-item-variant.dto';
import { CreateShopOrderDto } from './dto/create-shop-order.dto';
import { AdminCreateShopOrderDto } from './dto/admin-create-shop-order.dto';
import { FilterShopOrdersDto } from './dto/filter-shop-orders.dto';
import { NotificationType } from '@prisma/client';
import axios from 'axios';

@Injectable()
export class ShopService {
  private readonly paystackBaseUrl = 'https://api.paystack.co';
  private readonly paystackSecretKey: string;
  private readonly paystackCallbackUrl: string;
  private readonly paystackCancelUrl: string;
  private readonly logger = new Logger(ShopService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly notificationsService: NotificationsService,
    private readonly gymSettingsService: GymSettingsService,
    private readonly configService: ConfigService,
  ) {
    const paymentConfig = this.configService.get<PaymentConfig>(
      getPaymentConfigName(),
    )!;
    this.paystackSecretKey = paymentConfig.paystackSecretKey;
    this.paystackCallbackUrl = paymentConfig.paystackCallbackUrl;
    this.paystackCancelUrl = paymentConfig.paystackCancelUrl;
  }

  async createItem(dto: CreateShopItemDto) {
    return this.prisma.shopItem.create({
      data: {
        name: dto.name,
        description: dto.description,
        price: dto.price,
        imageUrl: dto.imageUrl,
        stock: dto.stock ?? 0,
      },
      include: { variants: true },
    });
  }

  async findAllItems(page = 1, limit = 20, memberOnly = false) {
    const where = memberOnly ? { isActive: true } : {};
    const [data, total] = await Promise.all([
      this.prisma.shopItem.findMany({
        where,
        include: { variants: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.shopItem.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOneItem(id: string, memberOnly = false) {
    const item = await this.prisma.shopItem.findUnique({
      where: { id },
      include: { variants: true },
    });
    if (!item || (memberOnly && !item.isActive)) {
      throw new NotFoundException('Shop item not found');
    }
    return item;
  }

  async updateItem(id: string, dto: UpdateShopItemDto) {
    await this.findOneItem(id);
    return this.prisma.shopItem.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.price !== undefined && { price: dto.price }),
        ...(dto.imageUrl !== undefined && { imageUrl: dto.imageUrl }),
        ...(dto.stock !== undefined && { stock: dto.stock }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
      include: { variants: true },
    });
  }

  async removeItem(id: string) {
    await this.findOneItem(id);
    return this.prisma.shopItem.delete({ where: { id } });
  }

  async addVariant(itemId: string, dto: CreateShopItemVariantDto) {
    await this.findOneItem(itemId);
    return this.prisma.shopItemVariant.create({
      data: {
        shopItemId: itemId,
        name: dto.name,
        priceOverride: dto.priceOverride ?? null,
        stock: dto.stock,
      },
    });
  }

  async updateVariant(
    itemId: string,
    variantId: string,
    dto: UpdateShopItemVariantDto,
  ) {
    const variant = await this.prisma.shopItemVariant.findUnique({
      where: { id: variantId },
    });
    if (!variant || variant.shopItemId !== itemId) {
      throw new NotFoundException('Variant not found');
    }
    return this.prisma.shopItemVariant.update({
      where: { id: variantId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.priceOverride !== undefined && {
          priceOverride: dto.priceOverride,
        }),
        ...(dto.stock !== undefined && { stock: dto.stock }),
      },
    });
  }

  async removeVariant(itemId: string, variantId: string) {
    const variant = await this.prisma.shopItemVariant.findUnique({
      where: { id: variantId },
    });
    if (!variant || variant.shopItemId !== itemId) {
      throw new NotFoundException('Variant not found');
    }
    return this.prisma.shopItemVariant.delete({ where: { id: variantId } });
  }

  async createOrder(memberId: string, email: string, dto: CreateShopOrderDto) {
    const settings = await this.gymSettingsService.getCachedSettings();
    const currency = settings?.currency ?? 'KES';

    const lineItems: Array<{
      shopItemId: string;
      variantId?: string;
      quantity: number;
      unitPrice: number;
      hasVariant: boolean;
    }> = [];

    for (const line of dto.items) {
      const item = await this.prisma.shopItem.findUnique({
        where: { id: line.shopItemId },
        include: { variants: true },
      });
      if (!item || !item.isActive) {
        throw new BadRequestException(`Shop item ${line.shopItemId} not found`);
      }

      if (line.variantId) {
        const variant = item.variants.find((v) => v.id === line.variantId);
        if (!variant) {
          throw new BadRequestException(
            `Variant ${line.variantId} not found on item ${line.shopItemId}`,
          );
        }
        if (variant.stock < line.quantity) {
          throw new ConflictException(
            `Insufficient stock for variant ${variant.name}`,
          );
        }
        lineItems.push({
          shopItemId: line.shopItemId,
          variantId: line.variantId,
          quantity: line.quantity,
          unitPrice: variant.priceOverride ?? item.price,
          hasVariant: true,
        });
      } else {
        if (item.stock < line.quantity) {
          throw new ConflictException(
            `Insufficient stock for item ${item.name}`,
          );
        }
        lineItems.push({
          shopItemId: line.shopItemId,
          quantity: line.quantity,
          unitPrice: item.price,
          hasVariant: false,
        });
      }
    }

    const totalAmount = lineItems.reduce(
      (sum, l) => sum + l.unitPrice * l.quantity,
      0,
    );

    const order = await this.prisma.$transaction(async (tx) => {
      const created = await tx.shopOrder.create({
        data: {
          memberId,
          totalAmount,
          currency,
          paymentMethod: dto.paymentMethod,
          orderItems: {
            create: lineItems.map((l) => ({
              shopItemId: l.shopItemId,
              variantId: l.variantId ?? null,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
            })),
          },
        },
        include: { orderItems: true },
      });

      for (const l of lineItems) {
        if (l.hasVariant && l.variantId) {
          const result = await tx.shopItemVariant.updateMany({
            where: { id: l.variantId, stock: { gte: l.quantity } },
            data: { stock: { decrement: l.quantity } },
          });
          if (result.count === 0) {
            throw new ConflictException(
              'Insufficient stock (concurrent order)',
            );
          }
        } else {
          const result = await tx.shopItem.updateMany({
            where: { id: l.shopItemId, stock: { gte: l.quantity } },
            data: { stock: { decrement: l.quantity } },
          });
          if (result.count === 0) {
            throw new ConflictException(
              'Insufficient stock (concurrent order)',
            );
          }
        }
      }

      return created;
    });

    const reference = `shop_${order.id}_${Date.now()}`;
    const channelMap: Record<string, string> = {
      CARD: 'card',
      MOBILE_MONEY: 'mobile_money',
      BANK_TRANSFER: 'bank_transfer',
    };
    const channel = channelMap[dto.paymentMethod] ?? 'card';

    const payload = {
      email,
      amount: Math.round(totalAmount * 100),
      currency,
      channels: [channel],
      reference,
      ...(this.paystackCallbackUrl && {
        callback_url: this.paystackCallbackUrl,
      }),
      metadata: {
        type: 'shop',
        orderId: order.id,
        ...(this.paystackCancelUrl && {
          cancel_action: this.paystackCancelUrl,
        }),
      },
    };

    try {
      const response = await axios.post<{
        data: {
          authorization_url: string;
          access_code: string;
          reference: string;
        };
      }>(`${this.paystackBaseUrl}/transaction/initialize`, payload, {
        headers: {
          Authorization: `Bearer ${this.paystackSecretKey}`,
          'Content-Type': 'application/json',
        },
      });

      await this.prisma.shopOrder.update({
        where: { id: order.id },
        data: { paystackReference: reference },
      });

      return { order, checkout: response.data.data };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        this.logger.error('Paystack shop initialization failed', {
          status: error.response?.status,
          body: error.response?.data,
        });
      }
      throw new BadRequestException('Payment initialization failed');
    }
  }

  async handlePaymentSuccess(orderId: string, reference: string) {
    const updated = await this.prisma.shopOrder.updateMany({
      where: { id: orderId, status: 'PENDING' },
      data: { status: 'PAID', paystackReference: reference },
    });

    if (updated.count === 0) {
      this.logger.warn(
        `shop.payment.success: order ${orderId} not PENDING or already processed`,
      );
      return;
    }

    const order = await this.prisma.shopOrder.findUnique({
      where: { id: orderId },
      include: { orderItems: true },
    });
    if (order) {
      await this.checkAndNotifyLowStock(order.orderItems);
    }
  }

  async createAdminOrder(dto: AdminCreateShopOrderDto) {
    const settings = await this.gymSettingsService.getCachedSettings();
    const currency = settings?.currency ?? 'KES';

    const lineItems: Array<{
      shopItemId: string;
      variantId?: string;
      quantity: number;
      unitPrice: number;
      hasVariant: boolean;
    }> = [];

    for (const line of dto.items) {
      const item = await this.prisma.shopItem.findUnique({
        where: { id: line.shopItemId },
        include: { variants: true },
      });
      if (!item || !item.isActive) {
        throw new BadRequestException(`Shop item ${line.shopItemId} not found`);
      }

      if (line.variantId) {
        const variant = item.variants.find((v) => v.id === line.variantId);
        if (!variant) {
          throw new BadRequestException(`Variant ${line.variantId} not found`);
        }
        if (variant.stock < line.quantity) {
          throw new ConflictException(
            `Insufficient stock for variant ${variant.name}`,
          );
        }
        lineItems.push({
          shopItemId: line.shopItemId,
          variantId: line.variantId,
          quantity: line.quantity,
          unitPrice: variant.priceOverride ?? item.price,
          hasVariant: true,
        });
      } else {
        if (item.stock < line.quantity) {
          throw new ConflictException(
            `Insufficient stock for item ${item.name}`,
          );
        }
        lineItems.push({
          shopItemId: line.shopItemId,
          quantity: line.quantity,
          unitPrice: item.price,
          hasVariant: false,
        });
      }
    }

    const totalAmount = lineItems.reduce(
      (sum, l) => sum + l.unitPrice * l.quantity,
      0,
    );

    const order = await this.prisma.$transaction(async (tx) => {
      const created = await tx.shopOrder.create({
        data: {
          memberId: dto.memberId,
          status: 'COLLECTED',
          totalAmount,
          currency,
          paymentMethod: dto.paymentMethod,
          orderItems: {
            create: lineItems.map((l) => ({
              shopItemId: l.shopItemId,
              variantId: l.variantId ?? null,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
            })),
          },
        },
        include: { orderItems: true },
      });

      for (const l of lineItems) {
        if (l.hasVariant && l.variantId) {
          const result = await tx.shopItemVariant.updateMany({
            where: { id: l.variantId, stock: { gte: l.quantity } },
            data: { stock: { decrement: l.quantity } },
          });
          if (result.count === 0) {
            throw new ConflictException(
              'Insufficient stock (concurrent order)',
            );
          }
        } else {
          const result = await tx.shopItem.updateMany({
            where: { id: l.shopItemId, stock: { gte: l.quantity } },
            data: { stock: { decrement: l.quantity } },
          });
          if (result.count === 0) {
            throw new ConflictException(
              'Insufficient stock (concurrent order)',
            );
          }
        }
      }

      return created;
    });

    await this.checkAndNotifyLowStock(order.orderItems);
    return order;
  }

  async findAllOrders(dto: FilterShopOrdersDto) {
    const where: Record<string, unknown> = {};
    if (dto.status) where.status = dto.status;
    if (dto.memberId) where.memberId = dto.memberId;
    if (dto.from || dto.to) {
      const createdAt: Record<string, Date> = {};
      if (dto.from) createdAt.gte = new Date(dto.from);
      if (dto.to) createdAt.lte = new Date(dto.to);
      where.createdAt = createdAt;
    }

    const [data, total] = await Promise.all([
      this.prisma.shopOrder.findMany({
        where,
        include: {
          orderItems: true,
          member: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: ((dto.page ?? 1) - 1) * (dto.limit ?? 20),
        take: dto.limit ?? 20,
      }),
      this.prisma.shopOrder.count({ where }),
    ]);

    return { data, total, page: dto.page ?? 1, limit: dto.limit ?? 20 };
  }

  async collectOrder(orderId: string) {
    const order = await this.prisma.shopOrder.findUnique({
      where: { id: orderId },
      include: {
        member: { select: { id: true, firstName: true } },
      },
    });

    if (!order) throw new NotFoundException('Order not found');
    if (order.status !== 'PAID') {
      throw new BadRequestException('Order is not ready for collection');
    }

    const updated = await this.prisma.shopOrder.update({
      where: { id: orderId },
      data: { status: 'COLLECTED' },
      include: {
        orderItems: true,
        member: { select: { id: true, firstName: true } },
      },
    });

    this.notificationsService
      .create({
        userId: order.member.id,
        title: 'Order Ready for Pickup',
        body: 'Your order is ready for collection at the gym entrance.',
        type: NotificationType.SHOP_ORDER_COLLECTED,
        metadata: { orderId },
      })
      .catch((err: Error) =>
        this.logger.error(
          `Failed to send order collected notification: ${err.message}`,
        ),
      );

    return updated;
  }

  private async checkAndNotifyLowStock(
    _orderItems: Array<{
      shopItemId: string;
      variantId: string | null;
      quantity: number;
    }>,
  ) {
    // implemented in Task 12
  }
}
