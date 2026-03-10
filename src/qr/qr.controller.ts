import { Controller, Post, Get, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
} from '@nestjs/swagger';
import { QrService } from './qr.service';
import { QrCodeResponseDto } from './dto/qr-code-response.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('QR Codes')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid JWT' })
@ApiForbiddenResponse({ description: 'Requires ADMIN or SUPER_ADMIN role' })
@Controller('qr')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'SUPER_ADMIN')
export class QrController {
  constructor(private readonly qrService: QrService) {}

  @Post('generate')
  @ApiCreatedResponse({ type: QrCodeResponseDto })
  generate() {
    return this.qrService.generateCode();
  }

  @Get('active')
  @ApiOkResponse({ type: QrCodeResponseDto })
  getActive() {
    return this.qrService.getActiveCode();
  }
}
