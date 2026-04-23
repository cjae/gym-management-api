import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { GymSettingsService } from '../gym-settings/gym-settings.service';
import { ConfigService } from '@nestjs/config';
import {
  PaymentConfig,
  getPaymentConfigName,
} from '../common/config/payment.config';
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
}
