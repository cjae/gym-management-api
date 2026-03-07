import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as crypto from 'crypto';

@Injectable()
export class QrService {
  constructor(private prisma: PrismaService) {}

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
}
