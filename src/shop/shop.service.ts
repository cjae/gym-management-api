import { Injectable, Logger, NotFoundException } from '@nestjs/common';
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
}
