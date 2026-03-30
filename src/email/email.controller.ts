import {
  Controller,
  Post,
  Body,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOkResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
} from '@nestjs/swagger';
import { EmailService } from './email.service';
import { PrismaService } from '../prisma/prisma.service';
import { SendEmailDto } from './dto/send-email.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { MessageResponseDto } from '../common/dto/message-response.dto';

@ApiTags('Email')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid JWT' })
@ApiForbiddenResponse({ description: 'Requires ADMIN or SUPER_ADMIN role' })
@Controller('email')
@UseGuards(JwtAuthGuard, RolesGuard)
export class EmailController {
  constructor(
    private readonly emailService: EmailService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('send')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOkResponse({
    description: 'Email sent successfully',
    type: MessageResponseDto,
  })
  @ApiNotFoundResponse({ description: 'User not found' })
  async send(@Body() dto: SendEmailDto): Promise<MessageResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: dto.userId },
      select: { email: true, firstName: true },
    });

    if (!user) {
      throw new NotFoundException(`User with id ${dto.userId} not found`);
    }

    await this.emailService.sendAdminMessageEmail(
      user.email,
      user.firstName,
      dto.subject,
      dto.body,
    );

    return { message: 'Email sent successfully' };
  }
}
