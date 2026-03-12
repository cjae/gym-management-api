import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import * as crypto from 'crypto';

@Injectable()
export class QrService {
  private readonly logger = new Logger(QrService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async generateCode() {
    await this.prisma.gymQrCode.updateMany({
      where: { isActive: true },
      data: { isActive: false },
    });
    const code = crypto.randomBytes(32).toString('hex');
    return this.prisma.gymQrCode.create({ data: { code, isActive: true } });
  }

  async getActiveCode() {
    return this.prisma.gymQrCode.findFirst({ where: { isActive: true } });
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, { timeZone: 'Africa/Nairobi' })
  async rotateDailyCode() {
    this.logger.log('Rotating daily QR code...');
    const code = await this.generateCode();
    this.eventEmitter.emit('qr.rotated', {
      type: 'qr_rotated',
      timestamp: new Date().toISOString(),
    });
    this.logger.log(`Daily QR code rotated: ${code.id}`);
  }
}
