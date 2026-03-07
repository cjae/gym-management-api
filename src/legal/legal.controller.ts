import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';
import { LegalService } from './legal.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import { SignDocumentDto } from './dto/sign-document.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Request } from 'express';

@Controller('legal')
@UseGuards(JwtAuthGuard)
export class LegalController {
  constructor(private readonly legalService: LegalService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  create(@Body() dto: CreateDocumentDto) {
    return this.legalService.create(dto);
  }

  @Get()
  findAll() {
    return this.legalService.findAll();
  }

  @Get('unsigned')
  getUnsigned(@CurrentUser('id') memberId: string) {
    return this.legalService.getUnsignedDocuments(memberId);
  }

  @Post('sign')
  sign(
    @CurrentUser('id') memberId: string,
    @Body() dto: SignDocumentDto,
    @Req() req: Request,
  ) {
    return this.legalService.sign(memberId, dto, req.ip);
  }

  @Get(':id/signatures')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  getSigningStatus(@Param('id') documentId: string) {
    return this.legalService.getSigningStatus(documentId);
  }
}
