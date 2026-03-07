import { Controller, Post, Get, UseGuards } from '@nestjs/common';
import { QrService } from './qr.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('qr')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'SUPER_ADMIN')
export class QrController {
  constructor(private readonly qrService: QrService) {}

  @Post('generate')
  generate() {
    return this.qrService.generateCode();
  }

  @Get('active')
  getActive() {
    return this.qrService.getActiveCode();
  }
}
