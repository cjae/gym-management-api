import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiConflictResponse,
} from '@nestjs/swagger';
import { LegalService } from './legal.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import { SignDocumentDto } from './dto/sign-document.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import type { Request } from 'express';

@ApiTags('Legal Documents')
@ApiBearerAuth()
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
  findAll(@Query() query: PaginationQueryDto) {
    return this.legalService.findAll(query.page, query.limit);
  }

  @Get('unsigned')
  getUnsigned(@CurrentUser('id') memberId: string) {
    return this.legalService.getUnsignedDocuments(memberId);
  }

  @Post('sign')
  @ApiNotFoundResponse({ description: 'Document not found' })
  @ApiConflictResponse({ description: 'Document already signed' })
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
