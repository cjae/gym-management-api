import {
  Controller,
  Post,
  Get,
  Param,
  Query,
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

interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}
import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';

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
    return this.paymentsService.initializePayment(
      subscriptionId,
      email,
      userId,
    );
  }

  @Post('webhook')
  @Version(VERSION_NEUTRAL)
  @ApiHeader({
    name: 'x-paystack-signature',
    description: 'HMAC SHA512 signature from Paystack',
  })
  @ApiBadRequestResponse({ description: 'Invalid signature' })
  webhook(
    @Req() req: RawBodyRequest,
    @Headers('x-paystack-signature') signature: string,
  ) {
    return this.paymentsService.handleWebhook(req.rawBody as Buffer, signature);
  }

  @Get('history')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  history(
    @CurrentUser('id') memberId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.paymentsService.getPaymentHistory(
      memberId,
      query.page,
      query.limit,
    );
  }
}
