import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PaymentResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  subscriptionId: string;

  @ApiProperty({ example: 5000 })
  amount: number;

  @ApiProperty({ example: 'KES' })
  currency: string;

  @ApiProperty({ enum: ['PENDING', 'PAID', 'FAILED', 'EXPIRED'] })
  status: string;

  @ApiProperty({
    enum: ['CARD', 'MOBILE_MONEY', 'OFFLINE', 'BANK_TRANSFER', 'COMPLIMENTARY'],
  })
  paymentMethod: string;

  @ApiPropertyOptional({ example: 'ref_abc123' })
  paystackReference?: string;

  @ApiPropertyOptional({ example: 'Insufficient funds' })
  failureReason?: string;

  @ApiPropertyOptional({ example: 'M-Pesa confirmation code ABC123' })
  paymentNote?: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
