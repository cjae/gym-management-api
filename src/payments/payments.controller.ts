import {
  Controller,
  Post,
  Get,
  Param,
  Headers,
  Req,
  UseGuards,
  Version,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiHeader,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('initialize/:subscriptionId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiBadRequestResponse({ description: 'Subscription not found' })
  initialize(
    @Param('subscriptionId') subscriptionId: string,
    @CurrentUser('email') email: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.paymentsService.initializePayment(subscriptionId, email, userId);
  }

  @Post('webhook')
  @Version(VERSION_NEUTRAL)
  @ApiHeader({
    name: 'x-paystack-signature',
    description: 'HMAC SHA512 signature from Paystack',
  })
  @ApiBadRequestResponse({ description: 'Invalid signature' })
  webhook(
    @Req() req: Request,
    @Headers('x-paystack-signature') signature: string,
  ) {
    return this.paymentsService.handleWebhook(
      (req as any).rawBody as Buffer,
      signature,
    );
  }

  @Get('history')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  history(@CurrentUser('id') memberId: string) {
    return this.paymentsService.getPaymentHistory(memberId);
  }
}
