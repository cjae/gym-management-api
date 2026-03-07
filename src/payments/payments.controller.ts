import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Headers,
  UseGuards,
} from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('initialize/:subscriptionId')
  @UseGuards(JwtAuthGuard)
  initialize(
    @Param('subscriptionId') subscriptionId: string,
    @CurrentUser('email') email: string,
  ) {
    return this.paymentsService.initializePayment(subscriptionId, email);
  }

  @Post('webhook')
  webhook(
    @Body() body: any,
    @Headers('x-paystack-signature') signature: string,
  ) {
    return this.paymentsService.handleWebhook(body, signature);
  }

  @Get('history')
  @UseGuards(JwtAuthGuard)
  history(@CurrentUser('id') memberId: string) {
    return this.paymentsService.getPaymentHistory(memberId);
  }
}
