import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ShopService } from '../shop.service';

@Injectable()
export class ShopPaymentListener {
  private readonly logger = new Logger(ShopPaymentListener.name);

  constructor(private readonly shopService: ShopService) {}

  @OnEvent('shop.payment.success')
  async handle(payload: { orderId: string; reference: string }) {
    try {
      await this.shopService.handlePaymentSuccess(
        payload.orderId,
        payload.reference,
      );
    } catch (err) {
      this.logger.error(
        `Failed to process shop payment for order ${payload.orderId}: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
      );
      throw err;
    }
  }
}
